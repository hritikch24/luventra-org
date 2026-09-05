import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import {
  requireSupabaseAnonKey,
  requireSupabaseSecretKey,
  requireSupabaseUrl,
} from './env';

/**
 * Server-side client bound to the request's cookie jar.
 *
 * `cookies()` is async in this version of Next, and writes are rejected when
 * called from a Server Component render — hence the try/catch, which is the
 * documented pattern: the session refresh still happens in `proxy.ts`.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireSupabaseUrl(),
    requireSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component; proxy.ts owns the refresh.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses row level security, so it is only ever built
 * inside trusted server code (the Stripe webhook) and never given a cookie jar
 * or exposed to a request's session.
 */
export function createAdminClient() {
  return createSupabaseClient(
    requireSupabaseUrl(),
    requireSupabaseSecretKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
