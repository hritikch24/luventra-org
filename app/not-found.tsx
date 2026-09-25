import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/app/components/SiteHeader';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

/**
 * 404.
 *
 * The default Next not-found page ships no navigation at all, which made a
 * mistyped URL a terminal state — the footer's legal links were the only way
 * out of the site. A 404 is the page a visitor is most likely to hit by
 * accident and least likely to forgive, so it carries the header and offers
 * the three routes anyone actually wants from here.
 */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[80rem] px-6 py-24">
        <p className="font-mono text-[0.6875rem] uppercase tracking-widest text-zinc-500">
          Error 404
        </p>
        <h1 className="mt-4 max-w-2xl text-3xl font-medium tracking-tight text-zinc-900">
          That page doesn&rsquo;t exist
        </h1>
        <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-zinc-600">
          The link may be out of date, or the address may have a typo. The converter and everything
          else is still here.
        </p>

        <ul className="mt-8 flex flex-wrap gap-3">
          <li>
            <Link href="/" className="inline-flex items-center bg-zinc-900 px-5 py-2.5 text-sm font-semibold tracking-tight text-white transition-[colors,box-shadow] duration-150 hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-400">
              Convert a statement
            </Link>
          </li>
          <li>
            <Link href="/banks" className="inline-flex items-center border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-900 transition-colors duration-150 hover:border-zinc-400 hover:bg-white focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500">
              Browse supported banks
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="inline-flex items-center border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-900 transition-colors duration-150 hover:border-zinc-400 hover:bg-white focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500">
              Privacy policy
            </Link>
          </li>
        </ul>
      </main>
    </>
  );
}
