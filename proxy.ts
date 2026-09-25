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
 *   /            -> Now a real landing page, not a redirect. Safe as an ad
 *                   target, though a bank page still converts better for a
 *                   query that names a bank.
 *
 *   /dashboard   -> Reachable by guests, but still one hop behind `/`, and it
 *                   is not a keyword-matched landing page. It is no longer
 *                   auth-gated: the redirect to /login was removed once the
 *                   Supabase env vars went live in production, because it made
 *                   the converter unreachable for signed-out traffic. Prefer a
 *                   bank page for any campaign that has a bank in its intent.
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
 * The auth gate that used to sit on /dashboard is gone; see the comment above
 * the remaining redirect below for what replaced it and what to check before
 * gating any path at this layer again.
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
/*
 * Paths retired with the previous site on this domain.
 *
 * luventra.co served an India travel guide before it served this converter.
 * Search Console still lists several hundred of those URLs as indexed and they
 * all 404, which is the worst of both states: Google keeps them in the index,
 * keeps spending crawl budget re-checking them, and reads the domain as a site
 * that broke rather than one that changed hands.
 *
 * 410 says the resource is intentionally gone and is not coming back, and
 * Google drops a 410 faster than a 404. There is nothing to redirect these to
 * — the travel content does not exist any more, and pointing them at the
 * converter would be a deceptive soft-404 for anyone who followed a link about
 * hostels in Goa.
 *
 * None of these prefixes collide with a route in app/; verified before adding.
 */
const RETIRED_PREFIXES = ['/blog', '/city', '/state', '/travel-guide', '/travel-partner'] as const;

function isRetired(pathname: string): boolean {
  return RETIRED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  // Answered before any Supabase work: a gone URL needs no session refresh.
  if (isRetired(request.nextUrl.pathname)) {
    /*
     * HTML, not bare text. The status code is for crawlers, but a person can
     * still follow an old link here from a bookmark or an external site, and a
     * plain-text body leaves them with no way into the product — the same dead
     * end the rest of the site was just audited for. Inlined rather than
     * rendered through a route so the response stays inside the proxy.
     */
    return new NextResponse(
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<meta name="robots" content="noindex">` +
        `<title>Page removed</title></head>` +
        `<body style="margin:0;background:#fafafa;color:#18181b;` +
        `font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
        `<main style="max-width:34rem;margin:0 auto;padding:6rem 1.5rem">` +
        `<p style="margin:0;font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;` +
        `letter-spacing:.18em;text-transform:uppercase;color:#71717a">Error 410</p>` +
        `<h1 style="margin:1rem 0 0;font-size:1.75rem;font-weight:500;letter-spacing:-.02em">` +
        `This page was removed</h1>` +
        `<p style="margin:1rem 0 0;color:#52525b">It belonged to a previous site on this domain ` +
        `and is not coming back. Luventra converts bank CSV statements into QBO, OFX and QFX.</p>` +
        `<p style="margin:2rem 0 0"><a href="/" style="display:inline-block;background:#18181b;` +
        `color:#fff;text-decoration:none;padding:.7rem 1.25rem;font-size:.875rem;font-weight:600">` +
        `Go to the converter</a></p></main></body></html>`,
      { status: 410, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }

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

  /*
   * No route is auth-gated here, deliberately.
   *
   * /dashboard used to redirect signed-out visitors to /login. That made the
   * converter unreachable for exactly the audience it is built for: a guest
   * arriving from an ad or a search result is signed out by definition, and
   * conversion runs entirely client-side, so there is nothing an account is
   * needed to do. The gate also took the dashboard's SoftwareApplication
   * schema and its sitemap entry offline, since a crawler is never signed in.
   *
   * Authentication is still enforced where it actually protects something, and
   * in the place that cannot be bypassed — the route handler itself.
   * /api/checkout returns 401 without a user, /api/subscription reports
   * `signedIn: false`, and the dashboard renders a guest state from that. This
   * proxy's remaining job is to refresh the session cookie on every request.
   *
   * Before gating a path here again: a redirect at this layer applies to
   * crawlers and paid traffic too, so anything listed must be a page that has
   * no reason to be indexed or landed on.
   */

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
