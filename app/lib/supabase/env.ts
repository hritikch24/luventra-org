/**
 * Env access that fails loudly at the point of use.
 *
 * `NEXT_PUBLIC_*` names must be written out literally rather than looked up
 * dynamically, because the bundler inlines them at build time.
 */
const PUBLIC: Readonly<Record<string, string | undefined>> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

export function requireEnv(name: string): string {
  const value = PUBLIC[name] ?? process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/** Non-throwing check, for rendering a setup notice instead of crashing. */
export function hasSupabaseEnv(): boolean {
  return Boolean(PUBLIC.NEXT_PUBLIC_SUPABASE_URL && PUBLIC.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
