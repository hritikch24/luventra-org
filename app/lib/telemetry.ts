'use client';

/**
 * Client side of the counter pipeline.
 *
 * Nothing derived from a statement is ever passed to these functions. The
 * signatures only accept an event name, one of our own page slugs, a format
 * choice and a coarse size band — there is deliberately no parameter that
 * could carry a filename, an amount or a payee.
 *
 * Sending is fire-and-forget and failure is silent: a blocked request, an
 * offline tab or a missing table must never interrupt a conversion.
 */

export type TelemetryEvent =
  | 'visitor_landed'
  | 'file_loaded'
  | 'preflight_pass'
  | 'conversion_success'
  | 'conversion_failed'
  | 'user_logged_in';
export type Surface = 'dashboard' | 'bank' | 'other';
export type RowBucket = '1-50' | '51-200' | '201-1000' | '1000+';

const SESSION_KEY = 'luventra.session.v1';

/** Coarse band, so an exact count cannot fingerprint a specific statement. */
export function rowBucket(rows: number): RowBucket {
  if (rows <= 50) return '1-50';
  if (rows <= 200) return '51-200';
  if (rows <= 1000) return '201-1000';
  return '1000+';
}

/**
 * Per-tab random id. Held in sessionStorage, so it dies with the tab and
 * cannot follow a visitor across visits or be correlated with an account.
 */
function sessionId(): string | null {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}

const REFERRER_ALLOW = new Set([
  'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'ecosia.org',
  'brave.com', 'reddit.com', 'news.ycombinator.com', 'x.com', 'twitter.com',
  'linkedin.com', 'facebook.com', 'youtube.com',
]);

/** Registrable host only, and only if recognised. Never a full URL. */
function referrerHost(): string {
  try {
    if (!document.referrer) return 'direct';
    const host = new URL(document.referrer).hostname.replace(/^www\./, '');
    if (host === window.location.hostname) return 'internal';
    const match = [...REFERRER_ALLOW].find((allowed) => host === allowed || host.endsWith(`.${allowed}`));
    return match ?? 'direct';
  } catch {
    return 'direct';
  }
}

export interface TelemetryPayload {
  readonly event: TelemetryEvent;
  /** Engine failure code, for `conversion_failed`. Mapped server-side. */
  readonly errorCode?: string;
  readonly surface?: Surface;
  /** One of our own bank page slugs, never a user-supplied path. */
  readonly bankSlug?: string;
  readonly dialect?: string;
  readonly rowBucket?: RowBucket;
}

export function track(payload: TelemetryPayload): void {
  if (typeof window === 'undefined') return;

  const id = sessionId();
  if (!id) return;

  const body = JSON.stringify({
    ...payload,
    sessionId: id,
    referrerHost: payload.event === 'visitor_landed' ? referrerHost() : undefined,
  });

  try {
    // sendBeacon survives the page being closed mid-navigation, which a plain
    // fetch does not. Falls back to a keepalive fetch where unsupported.
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/telemetry', new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Never surfaced.
  }
}
