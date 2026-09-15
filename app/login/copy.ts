/**
 * Intake copy, keyed by `?intent`.
 *
 * Registration and sign-in are the same magic-link round trip — there is no
 * separate signup call — so the only thing that varies is what the visitor is
 * told they are doing. Arriving from [ Register free ] and being shown "sign
 * in" reads as the wrong page and costs the conversion, which is the entire
 * reason this switch exists.
 */

export type AuthIntent = 'signin' | 'register';

export interface AuthCopy {
  readonly heading: string;
  readonly tagline: string;
  readonly submit: string;
  readonly pending: string;
}

export const AUTH_COPY: Readonly<Record<AuthIntent, AuthCopy>> = {
  signin: {
    heading: 'Sign in to your workbench',
    tagline: 'sign in with a one-time link',
    submit: 'Send sign-in link',
    pending: 'Sending',
  },
  register: {
    heading: 'Create your free production account',
    tagline: 'no password — we mail you a one-time link',
    submit: 'Create free account',
    pending: 'Creating',
  },
};

/** Anything other than an exact `register` falls back to sign-in. */
export function readIntent(raw: string | null): AuthIntent {
  return raw === 'register' ? 'register' : 'signin';
}
