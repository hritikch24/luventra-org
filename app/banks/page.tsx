import type { Metadata } from 'next';
import Link from 'next/link';
import { SEO_BANKS } from '@/app/lib/seo-banks-data';

export const metadata: Metadata = {
  title: 'Convert Bank CSV Statements to QBO, OFX and QFX',
  description:
    'Per-bank CSV to QuickBooks converters. Every conversion runs in your browser — the statement is never uploaded.',
  alternates: { canonical: '/banks' },
};

/**
 * Index for the per-bank pages. Exists so those pages are reachable by a
 * crawler rather than being orphans, and so the detail page's "all banks"
 * link resolves.
 */
export default function BanksIndexPage() {
  const banks = SEO_BANKS;

  return (
    <main className="min-h-dvh">
      <div className="mx-auto max-w-[80rem] px-6 py-12">
        <h1 className="text-2xl font-medium tracking-tight text-zinc-100">
          Convert bank CSV statements to QBO, OFX and QFX
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Each page below embeds the converter pre-configured for that bank&rsquo;s export layout.
          Files are parsed by a Web Worker in your browser and never uploaded.
        </p>

        {banks.length === 0 ? (
          <div className="mt-8 max-w-2xl border-l border-amber-500/40 bg-amber-500/5 px-4 py-3">
            <p className="text-sm leading-relaxed text-amber-400/90">
              No bank pages are published yet. Each profile describes a named company&rsquo;s export
              format, so it stays unpublished until a person has checked it against a real download.
            </p>
            <p className="mt-2 text-[0.6875rem] leading-relaxed text-zinc-500">
              To publish one: verify its headers, date order and sign convention against a real
              export, then set <code className="font-mono text-zinc-400">confidence: &lsquo;verified&rsquo;</code>{' '}
              and stamp <code className="font-mono text-zinc-400">lastVerified</code> in{' '}
              <code className="font-mono text-zinc-400">app/lib/seo-banks-data.ts</code>.
            </p>
          </div>
        ) : (
          <ul className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {banks.map((bank) => (
              <li key={bank.slug}>
                <Link
                  href={`/banks/${bank.slug}`}
                  className="block border border-zinc-800/60 bg-zinc-900 px-4 py-3 transition-colors duration-150 hover:border-zinc-700"
                >
                  <span className="block text-sm font-medium text-zinc-100">{bank.name}</span>
                  <span className="mt-0.5 block font-mono text-[0.625rem] text-zinc-600">
                    {bank.accountKind} · {bank.region} · {bank.dateFormat}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-xs text-zinc-600">
          Your bank not listed?{' '}
          <Link
            href="/dashboard"
            className="text-zinc-400 underline underline-offset-2 transition-colors duration-150 hover:text-zinc-100"
          >
            The general converter
          </Link>{' '}
          infers the layout from any CSV.
        </p>
      </div>
    </main>
  );
}
