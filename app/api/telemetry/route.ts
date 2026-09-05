import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/app/lib/supabase/server';
import { hasSupabaseEnv } from '@/app/lib/supabase/env';
import { SEO_BANKS } from '@/app/lib/seo-banks-data';

/**
 * Telemetry ingest. Counters only.
 *
 * Every field is validated against a closed set before it reaches the
 * database. Nothing free-form is accepted — no path, no filename, no numbers
 * from the statement. If a caller sends an unknown value the field is dropped
 * rather than stored, so a future client bug cannot start leaking content into
 * an analytics table.
 *
 * The route always answers 204. Telemetry must never surface an error into a
 * user's conversion flow, and a caller cannot learn anything from the
 * response about whether the write happened.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EVENTS = new Set(['page_view', 'file_loaded', 'preflight_pass', 'export']);
const SURFACES = new Set(['dashboard', 'bank', 'other']);
const DIALECTS = new Set(['ofx', 'qbo', 'qfx']);
const BUCKETS = new Set(['1-50', '51-200', '201-1000', '1000+']);

/** Slugs of our own pages. A slug outside this set is not stored. */
const SLUGS = new Set(SEO_BANKS.map((bank) => bank.slug));

/** Referrer hosts we are willing to record, to avoid storing arbitrary text. */
const REFERRER_ALLOW = new Set([
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'yahoo.com',
  'ecosia.org',
  'brave.com',
  'reddit.com',
  'news.ycombinator.com',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'facebook.com',
  'youtube.com',
  'direct',
  'internal',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pick<T>(value: unknown, allowed: Set<string>): T | null {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : null;
}

export async function POST(request: NextRequest) {
  // 204 on every path below: the client is fire-and-forget and must not retry.
  const ok = new NextResponse(null, { status: 204 });

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return ok;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return ok;
  }
  if (typeof body !== 'object' || body === null) return ok;

  const input = body as Record<string, unknown>;

  const event = pick<string>(input.event, EVENTS);
  const sessionId = typeof input.sessionId === 'string' && UUID.test(input.sessionId)
    ? input.sessionId
    : null;
  if (!event || !sessionId) return ok;

  const surface = pick<string>(input.surface, SURFACES) ?? 'other';
  const bankSlug = pick<string>(input.bankSlug, SLUGS);
  const dialect = pick<string>(input.dialect, DIALECTS);
  const rowBucket = pick<string>(input.rowBucket, BUCKETS);
  const referrerHost = pick<string>(input.referrerHost, REFERRER_ALLOW);

  try {
    await createAdminClient()
      .from('telemetry_events')
      .insert({
        event,
        session_id: sessionId,
        surface,
        bank_slug: bankSlug,
        dialect,
        row_bucket: rowBucket,
        referrer_host: referrerHost,
      });
  } catch {
    // Swallowed on purpose. A missing table or an outage must not be visible
    // to the visitor, and there is nothing useful for them to do about it.
  }

  return ok;
}
