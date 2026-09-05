/*
 * ============================================================================
 * DEVELOPER / SITE-MANAGER NOTE — GOOGLE ADS LANDING TARGETS
 * ============================================================================
 *
 * Point paid traffic at a FINAL URL. Every redirect between the ad click and
 * the rendered page costs latency on mobile and measurably increases bounce,
 * and a bounced click is billed exactly the same as a converting one.
 *
 * DO NOT use these as ad target URLs:
 *
 *   /            -> 307 redirect to /dashboard. One wasted hop, always.
 *
 *   /dashboard   -> AUTH-GATED. Read this carefully: once the Supabase env
 *                   vars are set in production, the proxy below redirects any
 *                   signed-out visitor from /dashboard to /login. Paid traffic
 *                   is signed out by definition, so an ad pointed here does
 *                   not land on the converter at all — it lands on a sign-in
 *                   form. Sent via `/` that is two hops to a page that cannot
 *                   convert. This is the expensive mistake, not the hop.
 *
 * USE these as ad target URLs:
 *
 *   /banks/<slug>  -> Public, statically prerendered (SSG), no auth check, no
 *                     redirect. Each embeds the working converter already
 *                     mapped for that bank, and carries the keyword-matched
 *                     H1. This is the correct landing page for a bank-intent
 *                     campaign. Slugs come from SEO_BANKS in
 *                     app/lib/seo-banks-data.ts, e.g.
 *                     /banks/chase-to-quickbooks
 *
 *   /banks         -> Public index, if a campaign is not bank-specific.
 *
 * If /dashboard must become an ad target, either drop it from `isProtected`
 * below so signed-out visitors can use the converter, or add its slug to a
 * public allowlist. Do not "fix" this by removing the auth check without
 * checking what else depends on it.
 * ============================================================================
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Session refresh on every request.
 *
 * This file was called `middleware.ts` before Next 16; the convention is now
 * `proxy.ts` exporting `proxy`. Note that `runtime` cannot be set here.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without credentials there is no session to refresh; let the request pass
  // so the app still renders its setup notice rather than 500ing.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touching getUser() is what triggers the refresh and the Set-Cookie writes.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = pathname.startsWith('/dashboard');

  if (isProtected && !user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('next', pathname);
    return NextResponse.redirect(redirect);
  }

  if (pathname === '/login' && user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/dashboard';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
