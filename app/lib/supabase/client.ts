'use client';

import { createBrowserClient } from '@supabase/ssr';
import { requireEnv } from './env';

/** Browser-side client. Anon key only — never the service role. */
export function createClient() {
  return createBrowserClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}
