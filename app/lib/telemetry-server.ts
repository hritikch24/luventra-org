import { createAdminClient } from '@/app/lib/supabase/server';
import { hasSupabaseEnv } from '@/app/lib/supabase/env';
import { SEO_BANKS } from '@/app/lib/seo-banks-data';

/**
 * Server-side telemetry writer.
 *
 * Shared by the ingest route and the auth callback so both produce identical
 * rows and there is exactly one place that decides what may be persisted.
 *
 * Every field is validated against a closed set. Anything unrecognised is
 * dropped rather than stored, so a client bug cannot start writing statement
 * content into an analytics table.
 */

export const TELEMETRY_EVENTS = [
  'visitor_landed',
  'file_loaded',
  'preflight_pass',
  'conversion_success',
  'conversion_failed',
  'user_logged_in',
] as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];

const EVENTS = new Set<string>(TELEMETRY_EVENTS);
const SURFACES = new Set(['dashboard', 'bank', 'other']);
const DIALECTS = new Set(['ofx', 'qbo', 'qfx']);
const BUCKETS = new Set(['1-50', '51-200', '201-1000', '1000+']);
const SLUGS = new Set(SEO_BANKS.map((bank) => bank.slug));

const REFERRER_ALLOW = new Set([
  'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'ecosia.org',
  'brave.com', 'reddit.com', 'news.ycombinator.com', 'x.com', 'twitter.com',
  'linkedin.com', 'facebook.com', 'youtube.com', 'direct', 'internal',
]);

/**
 * Structural failure reasons.
 *
 * The engine emits lowercase kebab codes; the dashboard wants stable
 * uppercase names. Mapping here rather than in the client keeps the taxonomy
 * server-owned, so a stale browser tab cannot invent a new one.
 */
const ERROR_CODES = new Map<string, string>([
  ['system-timeout', 'TIMEOUT_EXCEEDED'],
  ['multi-currency', 'MULTI_CURRENCY_COLLISION'],
  ['file-too-large', 'FILE_TOO_LARGE'],
  ['no-date-column', 'NO_DATE_COLUMN'],
  ['no-amount-column', 'NO_AMOUNT_COLUMN'],
  ['no-header', 'NO_HEADER'],
  ['no-rows', 'NO_TRANSACTIONS'],
  ['no-transactions', 'NO_TRANSACTIONS'],
  ['ragged-rows', 'RAGGED_ROWS'],
  ['bad-date', 'BAD_DATE'],
  ['bad-amount', 'BAD_AMOUNT'],
  ['unparsed-dates', 'UNPARSED_DATES'],
  ['bad-request', 'MALFORMED_BINARY'],
  ['unknown-kind', 'MALFORMED_BINARY'],
  ['worker-exception', 'MALFORMED_BINARY'],
  ['unhandled-rejection', 'MALFORMED_BINARY'],
]);

/** Already-canonical names the client may send directly. */
const CANONICAL = new Set(ERROR_CODES.values());

export function normaliseErrorCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (CANONICAL.has(trimmed)) return trimmed;
  return ERROR_CODES.get(trimmed.toLowerCase()) ?? 'UNKNOWN';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNTRY = /^[A-Z]{2}$/;

function pick(value: unknown, allowed: Set<string>): string | null {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

export interface TelemetryInput {
  readonly event: unknown;
  readonly sessionId: unknown;
  readonly surface?: unknown;
  readonly bankSlug?: unknown;
  readonly dialect?: unknown;
  readonly rowBucket?: unknown;
  readonly referrerHost?: unknown;
  readonly errorCode?: unknown;
}

export interface TelemetryRow {
  event: string;
  session_id: string;
  surface: string;
  bank_slug: string | null;
  dialect: string | null;
  row_bucket: string | null;
  referrer_host: string | null;
  country: string | null;
  ip: string | null;
  error_code: string | null;
}

/** ISO country from the edge. Vercel sets the first; others are fallbacks. */
export function countryFrom(headers: Headers): string | null {
  const raw =
    headers.get('x-vercel-ip-country') ??
    headers.get('cf-ipcountry') ??
    headers.get('x-country-code');
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return COUNTRY.test(upper) ? upper : null;
}

/**
 * Client IP. `x-forwarded-for` is a comma-separated chain appended to by each
 * proxy, so the originating client is the leftmost entry.
 */
export function ipFrom(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  const candidate =
    forwarded?.split(',')[0]?.trim() ??
    headers.get('x-real-ip')?.trim() ??
    headers.get('x-vercel-forwarded-for')?.trim() ??
    null;
  if (!candidate) return null;
  // Loose shape check only; Postgres `inet` rejects anything malformed, and a
  // rejected insert would take the whole row with it.
  const looksIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(candidate);
  const looksIpv6 = /^[0-9a-f:]+$/i.test(candidate) && candidate.includes(':');
  return looksIpv4 || looksIpv6 ? candidate : null;
}

export function buildRow(input: TelemetryInput, headers: Headers): TelemetryRow | null {
  const event = pick(input.event, EVENTS);
  const sessionId =
    typeof input.sessionId === 'string' && UUID.test(input.sessionId) ? input.sessionId : null;
  if (!event || !sessionId) return null;

  return {
    event,
    session_id: sessionId,
    surface: pick(input.surface, SURFACES) ?? 'other',
    bank_slug: pick(input.bankSlug, SLUGS),
    dialect: pick(input.dialect, DIALECTS),
    row_bucket: pick(input.rowBucket, BUCKETS),
    referrer_host: pick(input.referrerHost, REFERRER_ALLOW),
    country: countryFrom(headers),
    ip: ipFrom(headers),
    error_code: event === 'conversion_failed' ? normaliseErrorCode(input.errorCode) : null,
  };
}

/**
 * Persists a row, or logs it when the database is not configured.
 *
 * Local development has no Supabase project, and silently writing nothing
 * makes the pipeline impossible to debug — so the row is printed to the server
 * terminal instead. Never throws: telemetry must not break a user's flow.
 */
export async function recordEvent(input: TelemetryInput, headers: Headers): Promise<void> {
  const row = buildRow(input, headers);
  if (!row) return;

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // eslint-disable-next-line no-console
    console.log('[telemetry:local]', JSON.stringify(row));
    return;
  }

  try {
    const { error } = await createAdminClient().from('telemetry_events').insert(row);
    if (error) {
      // eslint-disable-next-line no-console
      console.log('[telemetry:insert-failed]', error.message, JSON.stringify(row));
    }
  } catch (cause) {
    // eslint-disable-next-line no-console
    console.log(
      '[telemetry:threw]',
      cause instanceof Error ? cause.message : String(cause),
      JSON.stringify(row),
    );
  }
}
