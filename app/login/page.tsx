import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-[20rem]">
        <div className="mb-6">
          <h1 className="text-sm font-medium tracking-tight text-zinc-100">Statement Converter</h1>
          <p className="mt-1 font-mono text-[0.6875rem] text-zinc-600">
            sign in with a one-time link
          </p>
        </div>
        <Suspense fallback={<div className="h-24" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
