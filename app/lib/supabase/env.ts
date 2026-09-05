/**
 * Environment resolution for Supabase and Postgres.
 *
 * Two naming schemes are in play and both must work:
 *
 *   - Vercel's Supabase integration injects server-only `SUPABASE_URL`,
 *     `SUPABASE_SECRET_KEY` and `POSTGRES_URL`.
 *   - The browser bundle can only ever read `NEXT_PUBLIC_*`, because those are
 *     the only names Next inlines at build time.
 *
 * So server code prefers the Vercel names and falls back to the public pair,
 * while browser code has no choice but the public pair. Getting this wrong is
 * what made telemetry silently log to the console in production instead of
 * writing rows: the old check only looked at `NEXT_PUBLIC_*`, which Vercel
 * does not set for the secret key.
 *
 * `NEXT_PUBLIC_*` must be written as full literal member expressions — a
 * computed `process.env[name]` lookup is not substituted by the bundler and
 * resolves to undefined in the browser.
 */

const PUBLIC: Readonly<Record<string, string | undefined>> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

function firstSet(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Resolvers                                                                  */
/* -------------------------------------------------------------------------- */

/** Project URL. Vercel's server-only name wins; public is the fallback. */
export function supabaseUrl(): string | undefined {
  return firstSet(process.env.SUPABASE_URL, PUBLIC.NEXT_PUBLIC_SUPABASE_URL);
}

/** Anon/publishable key — the identity the browser and cookie clients use. */
export function supabaseAnonKey(): string | undefined {
  return firstSet(
    PUBLIC.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
  );
}

/**
 * Service-role key. Bypasses row level security, so it must never be resolved
 * from a `NEXT_PUBLIC_*` name — that would ship it to every browser.
 */
export function supabaseSecretKey(): string | undefined {
  return firstSet(process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Direct Postgres connection string, as injected by Vercel.
 *
 * Nothing reads it today: this app talks to Supabase over HTTPS through
 * supabase-js (PostgREST), not the Postgres wire protocol, and there is no
 * `pg`, Prisma or Drizzle client in the dependency tree. It is resolved here
 * so the variable is accounted for rather than silently ignored, and so a
 * future direct client has one obvious place to read it from.
 */
export function postgresUrl(): string | undefined {
  return firstSet(process.env.POSTGRES_URL, process.env.POSTGRES_URL_NON_POOLING);
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Browser-safe check: can a client component build an anon client?
 *
 * Deliberately reads only the public pair. Calling this from server code to
 * decide whether a *write* can happen is the bug described above — use
 * `hasServerSupabaseEnv()` for that.
 */
export function hasSupabaseEnv(): boolean {
  return Boolean(PUBLIC.NEXT_PUBLIC_SUPABASE_URL && PUBLIC.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Server-side check: can privileged reads and writes happen? */
export function hasServerSupabaseEnv(): boolean {
  return Boolean(supabaseUrl() && supabaseSecretKey());
}

/** Which names actually resolved, for a setup notice. Never returns values. */
export function describeSupabaseEnv(): string {
  const parts = [
    process.env.SUPABASE_URL ? 'SUPABASE_URL' : PUBLIC.NEXT_PUBLIC_SUPABASE_URL ? 'NEXT_PUBLIC_SUPABASE_URL' : null,
    process.env.SUPABASE_SECRET_KEY
      ? 'SUPABASE_SECRET_KEY'
      : process.env.SUPABASE_SERVICE_ROLE_KEY
        ? 'SUPABASE_SERVICE_ROLE_KEY'
        : null,
  ].filter((name): name is string => name !== null);
  return parts.length > 0 ? parts.join(' + ') : 'none';
}

/* -------------------------------------------------------------------------- */
/* Strict accessors                                                           */
/* -------------------------------------------------------------------------- */

function required(value: string | undefined, names: string): string {
  if (!value) {
    throw new Error(
      `Missing environment variable: set one of ${names}. Copy .env.example to .env.local for local development.`,
    );
  }
  return value;
}

export function requireSupabaseUrl(): string {
  return required(supabaseUrl(), 'SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
}

export function requireSupabaseAnonKey(): string {
  return required(supabaseAnonKey(), 'NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY');
}

export function requireSupabaseSecretKey(): string {
  return required(supabaseSecretKey(), 'SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY');
}
