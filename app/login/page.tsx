import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './LoginForm';
import { AuthHeading } from './AuthHeading';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-[20rem]">
        {/*
          The heading lives inside LoginForm because it varies with `?intent`,
          and only a client component may read search params without opting
          this route into dynamic rendering. The fallback repeats the default
          heading so the prerendered HTML still ships an h1 rather than a gap.
        */}
        <Suspense fallback={<AuthHeading intent="signin" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
