'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/app/lib/supabase/client';
import { hasSupabaseEnv } from '@/app/lib/supabase/env';

/**
 * Optional sign-in affordance for the top-right of a surface.
 *
 * Guest flow is the product: a bookkeeper arriving from an ad must be able to
 * drop a file and download a result without ever seeing an account prompt. So
 * this component only ever *offers* a link — it renders no modal, blocks no
 * interaction, and never redirects. Nothing below it depends on its result.
 *
 * The session is read on the client rather than on the server on purpose: the
 * dashboard and the bank pages are statically prerendered, and reading cookies
 * during render would opt every one of them into dynamic rendering, which is
 * exactly what the SSG landing pages must not do.
 *
 * Renders nothing when Supabase is unconfigured, so local development does not
 * show a link that leads to a setup notice.
 */

type Session = { readonly kind: 'guest' } | { readonly kind: 'user'; readonly email: string };

/** Local part of an address, trimmed so the header cannot be pushed around. */
function accountTag(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.length > 14 ? `${local.slice(0, 13)}…` : local;
}

export function AuthLink() {
  // Starts as `guest`: most visitors are, so the common case paints correctly
  // on first frame and the element never changes width after hydration.
  const [session, setSession] = useState<Session>({ kind: 'guest' });

  useEffect(() => {
    if (!hasSupabaseEnv()) return;

    let cancelled = false;
    const supabase = createClient();

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        const email = data.user?.email;
        setSession(email ? { kind: 'user', email } : { kind: 'guest' });
      })
      .catch(() => {
        // A failed session read is not the visitor's problem: stay a guest.
        if (!cancelled) setSession({ kind: 'guest' });
      });

    // Keeps the label honest if the user signs in or out in another tab.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      const email = next?.user?.email;
      setSession(email ? { kind: 'user', email } : { kind: 'guest' });
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (!hasSupabaseEnv()) return null;

  if (session.kind === 'user') {
    return (
      <Link
        href="/dashboard"
        title={session.email}
        className="flex items-center gap-1.5 border border-zinc-800/60 px-2 py-1 font-mono text-[0.625rem] text-zinc-400 transition-colors duration-150 hover:border-zinc-700 hover:text-zinc-100 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
      >
        <span
          className="size-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
          aria-hidden
        />
        <span className="sr-only">Signed in as </span>
        {accountTag(session.email)}
      </Link>
    );
  }

  return (
    <Link
      href="/login"
      className="border border-zinc-800/60 px-2 py-1 font-mono text-[0.625rem] text-zinc-400 transition-colors duration-150 hover:border-zinc-700 hover:text-zinc-100 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
    >
      Sign in
    </Link>
  );
}
