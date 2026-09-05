'use client';

import { createBrowserClient } from '@supabase/ssr';
import { requireSupabaseAnonKey, requireSupabaseUrl } from './env';

/** Browser-side client. Anon key only — never the service role. */
export function createClient() {
  return createBrowserClient(
    requireSupabaseUrl(),
    requireSupabaseAnonKey(),
  );
}
