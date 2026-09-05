import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/app/lib/supabase/server';

/**
 * Magic-link landing route. Supabase redirects here with a one-time `code`,
 * which is exchanged for a session cookie. No password flow exists, so there
 * is nothing else to handle.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next');

  // Only accept same-origin relative paths, so the link cannot be used as an
  // open redirect onto another host.
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}${destination}`);
}
