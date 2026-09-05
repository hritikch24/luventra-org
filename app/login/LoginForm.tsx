'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/app/lib/supabase/client';
import { hasSupabaseEnv } from '@/app/lib/supabase/env';

type Status = 'idle' | 'sending' | 'sent' | 'error';

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next');
  const linkError = params.get('error');

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
      const callback = new URL('/auth/callback', window.location.origin);
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
      setMessage(`Check ${email} for a sign-in link.`);
    } catch (cause) {
      setStatus('error');
      setMessage(cause instanceof Error ? cause.message : 'Could not send the link.');
    }
  }

  if (!configured) {
    return (
      <p className="border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[0.6875rem] leading-relaxed text-amber-400">
        Supabase is not configured. Copy <code className="font-mono">.env.example</code> to{' '}
        <code className="font-mono">.env.local</code> and set the project URL and anon key.
      </p>
    );
  }

  return (
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
        className="w-full border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-700 transition-colors duration-150 hover:border-zinc-700 focus:border-accent focus:outline-none disabled:opacity-60"
      />

      <button
        type="submit"
        disabled={status === 'sending' || status === 'sent'}
        className="flex w-full items-center justify-center gap-2 bg-accent px-3 py-2 text-xs font-medium text-white transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {status === 'sending' ? (
          <>
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Sending…
          </>
        ) : status === 'sent' ? (
          'Link sent'
        ) : (
          'Email me a link'
        )}
      </button>

      {(message ?? linkError) ? (
        <p
          role={status === 'error' || linkError ? 'alert' : 'status'}
          className={`text-[0.6875rem] leading-relaxed ${
            status === 'error' || linkError ? 'text-red-400' : 'text-zinc-500'
          }`}
        >
          {message ?? linkError}
        </p>
      ) : null}
    </form>
  );
}
