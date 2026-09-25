'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/app/lib/supabase/client';
import { hasSupabaseEnv } from '@/app/lib/supabase/env';
import { AUTH_COPY, readIntent } from './copy';
import { AuthHeading } from './AuthHeading';

type Status = 'idle' | 'sending' | 'sent' | 'error';

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next');
  const linkError = params.get('error');
  const intent = readIntent(params.get('intent'));
  const copy = AUTH_COPY[intent];

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const configured = hasSupabaseEnv();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;

    setStatus('sending');
    setMessage(null);

    try {
      const supabase = createClient();
      /*
       * The callback origin is the configured production host, not
       * `window.location.origin`. The origin of the tab is whichever host the
       * visitor happened to land on — apex or www, a Vercel preview URL, or
       * localhost — and whatever it is gets baked into a link that has to
       * still resolve when opened from an inbox on another device. Falling
       * back to the tab's origin only covers local development, where the
       * variable is unset.
       */
      const origin = process.env.NEXT_PUBLIC_SITE_URL?.trim() || window.location.origin;
      const callback = new URL('/auth/callback', origin);
      if (next && next.startsWith('/')) callback.searchParams.set('next', next);

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: callback.toString() },
      });

      if (error) {
        setStatus('error');
        setMessage(error.message);
        return;
      }
      setStatus('sent');
      setMessage(`Check ${email} for your ${intent === 'register' ? 'account' : 'sign-in'} link.`);
    } catch (cause) {
      setStatus('error');
      setMessage(cause instanceof Error ? cause.message : 'Could not send the link.');
    }
  }

  if (!configured) {
    return (
      <>
        <AuthHeading intent={intent} />
        <p className="border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[0.6875rem] leading-relaxed text-amber-600">
        Supabase is not configured. Copy <code className="font-mono">.env.example</code> to{' '}
          <code className="font-mono">.env.local</code> and set the project URL and anon key.
        </p>
      </>
    );
  }

  return (
    <>
      <AuthHeading intent={intent} />
      <form onSubmit={onSubmit} className="space-y-2">
      <label htmlFor="email" className="sr-only">
        Email address
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@company.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={status === 'sending' || status === 'sent'}
        className="w-full border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 transition-colors duration-150 hover:border-zinc-300 focus:border-accent focus:outline-none disabled:opacity-60"
      />

      <button
        type="submit"
        disabled={status === 'sending' || status === 'sent'}
        className="flex w-full items-center justify-center gap-2 bg-accent px-3 py-2 text-xs font-medium text-white transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {status === 'sending' ? (
          <>
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {copy.pending}…
          </>
        ) : status === 'sent' ? (
          'Link sent'
        ) : (
          copy.submit
        )}
      </button>

      {(message ?? linkError) ? (
        <p
          role={status === 'error' || linkError ? 'alert' : 'status'}
          className={`text-[0.6875rem] leading-relaxed ${
            status === 'error' || linkError ? 'text-red-600' : 'text-zinc-500'
          }`}
        >
          {message ?? linkError}
        </p>
      ) : null}
      </form>
    </>
  );
}
