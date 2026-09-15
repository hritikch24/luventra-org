/**
 * Anonymous daily conversion allowance.
 *
 * WHAT THIS IS NOT: a security boundary. Conversion runs entirely inside the
 * browser's Web Worker — there is no server round trip to gate, so there is no
 * place to enforce anything. The counter lives in the visitor's own storage and
 * is cleared by a private window, a different browser, or three seconds in
 * devtools. Signing the token would change nothing: the code that verifies the
 * signature is also the code the visitor controls.
 *
 * It is therefore a prompt, deliberately: it asks a returning guest to create
 * an account at the point they have already had value twice. Treat a bypass as
 * expected, not as an incident. The same reasoning is recorded against
 * `PAYWALL_DISABLED` in StatementWorkbench — nothing client-side may ever be
 * relied on as an entitlement boundary, and if server-side entitlement is ever
 * introduced it must not read this module.
 *
 * Storage shape, under `pulse_anon_token`:
 *   { "id": "<uuid>", "windowStart": <epoch ms>, "used": <int> }
 *
 * The window is a rolling 24h from the first conversion of a run, not a
 * calendar day: a visitor converting at 23:50 would otherwise get a second
 * full allowance ten minutes later.
 */

export const ANON_TOKEN_KEY = 'pulse_anon_token';
export const ANON_DAILY_LIMIT = 2;
const WINDOW_MS = 24 * 60 * 60 * 1000;

interface AnonToken {
  readonly id: string;
  readonly windowStart: number;
  readonly used: number;
}

export interface AnonAllowance {
  /** False once the daily allowance is spent. */
  readonly allowed: boolean;
  readonly used: number;
  readonly remaining: number;
  /** Epoch ms at which the current window expires, or null when unused. */
  readonly resetsAt: number | null;
}

function newId(): string {
  // `randomUUID` is unavailable on insecure origins; the fallback only has to
  // be unique enough to key one browser's own counter.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Reads the token, discarding anything unparseable or stale.
 *
 * Every storage access is wrapped: Safari in private mode throws on write, and
 * some embedded webviews throw on read. A visitor whose storage is unavailable
 * is treated as having a fresh allowance rather than being blocked — failing
 * open is correct here, because the counter is a prompt and the conversion
 * itself costs us nothing.
 */
function read(now: number): AnonToken | null {
  try {
    const raw = window.localStorage.getItem(ANON_TOKEN_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const { id, windowStart, used } = parsed as Partial<AnonToken>;
    if (typeof id !== 'string' || typeof windowStart !== 'number' || typeof used !== 'number') {
      return null;
    }
    // A clock moved backwards, or a window that has elapsed, both reset.
    if (!Number.isFinite(windowStart) || windowStart > now || now - windowStart >= WINDOW_MS) {
      return null;
    }
    return { id, windowStart, used: Math.max(0, Math.floor(used)) };
  } catch {
    return null;
  }
}

function write(token: AnonToken): void {
  try {
    window.localStorage.setItem(ANON_TOKEN_KEY, JSON.stringify(token));
  } catch {
    // Storage denied. The visitor keeps converting; the count simply does not
    // persist, which is the failure mode we want.
  }
}

/**
 * Describes a token's state.
 *
 * `allowed` here answers "may a further conversion start", which is the
 * question `peek` asks. `consume` answers a different question — "did this
 * attempt succeed" — and overrides the field accordingly. Conflating the two
 * rejected the last conversion of every window.
 */
function toAllowance(token: AnonToken | null): AnonAllowance {
  const used = token?.used ?? 0;
  return {
    allowed: used < ANON_DAILY_LIMIT,
    used,
    remaining: Math.max(0, ANON_DAILY_LIMIT - used),
    resetsAt: token ? token.windowStart + WINDOW_MS : null,
  };
}

/** Current allowance without consuming any of it. Safe during render. */
export function peekAnonAllowance(now: number = Date.now()): AnonAllowance {
  if (typeof window === 'undefined') return toAllowance(null);
  return toAllowance(read(now));
}

/**
 * Consumes one conversion if any remain.
 *
 * Returns the allowance *after* the attempt, so a caller can both decide
 * whether to proceed (`allowed`) and report what is left. Call this only when a
 * conversion is actually about to happen — never on page load.
 */
export function consumeAnonConversion(now: number = Date.now()): AnonAllowance {
  if (typeof window === 'undefined') return toAllowance(null);

  const current = read(now);
  if (!current) {
    const fresh: AnonToken = { id: newId(), windowStart: now, used: 1 };
    write(fresh);
    // `allowed: true` — this attempt was granted, even if it was the only one.
    return { ...toAllowance(fresh), allowed: true };
  }

  if (current.used >= ANON_DAILY_LIMIT) {
    return { ...toAllowance(current), allowed: false };
  }

  const next: AnonToken = { ...current, used: current.used + 1 };
  write(next);
  return { ...toAllowance(next), allowed: true };
}

/** Stable per-browser id, minted on demand. Identifies nobody by itself. */
export function anonTokenId(now: number = Date.now()): string | null {
  if (typeof window === 'undefined') return null;
  return read(now)?.id ?? null;
}

/** Test and sign-out helper. */
export function resetAnonAllowance(): void {
  try {
    window.localStorage.removeItem(ANON_TOKEN_KEY);
  } catch {
    /* storage denied; nothing to clear */
  }
}
