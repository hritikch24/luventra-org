/*
 * Root entry point: 307-redirects to /dashboard.
 *
 * NOTE FOR AD CAMPAIGNS: do not use `/` as a Google Ads final URL — it costs a
 * redirect hop, and /dashboard is auth-gated once Supabase is configured, so
 * signed-out paid traffic ends up on /login instead of the converter. Point
 * ads at the public static /banks/<slug> pages. Full explanation at the top of
 * proxy.ts.
 */

import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/dashboard');
}
