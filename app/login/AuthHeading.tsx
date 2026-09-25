import { AUTH_COPY, type AuthIntent } from './copy';

/** Shared by the form and by its Suspense fallback, so the two cannot drift. */
export function AuthHeading({ intent }: { readonly intent: AuthIntent }) {
  const copy = AUTH_COPY[intent];
  return (
    <div className="mb-6">
      <h1 className="text-sm font-medium tracking-tight text-zinc-900">{copy.heading}</h1>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-zinc-500">
        {copy.tagline}
      </p>
    </div>
  );
}
