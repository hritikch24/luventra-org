import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './LoginForm';
import { AuthHeading } from './AuthHeading';
import { SiteHeader } from '@/app/components/SiteHeader';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex min-h-[calc(100dvh-8rem)] items-center justify-center px-4 py-16">
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
    </>
  );
}
