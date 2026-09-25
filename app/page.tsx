import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Lock, ShieldCheck, Zap } from 'lucide-react';
import { SEO_BANKS } from '@/app/lib/seo-banks-data';
import { StatementWorkbench } from '@/app/dashboard/StatementWorkbench';
import { AuthLink } from '@/app/components/AuthLink';
import { Mark } from '@/app/components/Mark';
import { PageViewTracker } from '@/app/components/PageViewTracker';

/*
 * The homepage.
 *
 * This route used to 307 to /dashboard, which spent the strongest URL on the
 * domain on a redirect: no content, nothing to index, and a visitor landing
 * straight inside a dense three-column workspace with no explanation of what
 * the site does or where to begin.
 *
 * The page is built as a scrolling document rather than a viewport-locked app
 * surface. A bookkeeper arriving from a search result needs, in this order:
 * what this is, somewhere obvious to drop a file, proof it is safe, and
 * answers to the questions that stop them. The converter itself sits high —
 * second section, above the fold on a laptop — because the fastest way to
 * explain the product is to let someone use it.
 *
 * Surfaces are layered (zinc-950 base, zinc-900 bands, zinc-900/40 cards)
 * rather than one flat black, so sections read as distinct regions instead of
 * a void with text floating in it.
 */

/**
 * `SoftwareApplication` description of the converter.
 *
 * It lives on / rather than /dashboard because this is now the page a crawler
 * and a person both meet the product on. Schema describing the application
 * belongs on the application's public page, not on an app surface that is
 * noindex.
 *
 * `applicationCategory` is an enumeration, so the two valid values are emitted
 * as an array rather than one slash-joined string, and the finance one is
 * spelled `FinanceApplication` in the vocabulary. No `offers` or
 * `aggregateRating`: both need real commercial data, and inventing either to
 * unlock a rich-result badge would be fabricating a claim about the product.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Luventra Automated Client-Side Statement Transcoder',
  url: siteUrl,
  applicationCategory: ['BusinessApplication', 'FinanceApplication'],
  operatingSystem: 'All modern web browsers (Windows, macOS, Linux)',
  browserRequirements: 'Requires JavaScript and Web Worker support.',
  featureList: [
    'Local Web Worker processing',
    '100% data privacy sandbox',
    'Byte-exact QBO/OFX file generation',
  ],
  description:
    'Format irregular banking statement rows into specification-compliant bookkeeping entries. ' +
    'Statements are parsed in an isolated client-side thread and never leave the device.',
};

export const metadata: Metadata = {
  title: 'Convert Bank CSV Statements to QBO, OFX and QFX',
  description:
    'Convert any bank CSV export into QuickBooks QBO, OFX or QFX. Runs entirely in your browser — the statement is never uploaded. Free, no account needed.',
  alternates: { canonical: '/' },
};

const STEPS = [
  {
    n: '01',
    title: 'Export CSV from your bank',
    body: 'Download your transactions in the date range you need. Any delimiter, any column order, header row or not.',
  },
  {
    n: '02',
    title: 'Drop it in',
    body: 'Columns are detected automatically and shown for confirmation. Nothing is uploaded — the file is read inside your browser.',
  },
  {
    n: '03',
    title: 'Download and import',
    body: 'Generate a spec-compliant QBO, OFX or QFX file and import it into QuickBooks, Xero or Quicken.',
  },
] as const;

export default function HomePage() {
  const banks = SEO_BANKS;

  return (
    <main className="min-h-dvh">
      <script
        type="application/ld+json"
        // Values are static literals from this file, never user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      {/*
        'other', not a new 'home' value: telemetry_events carries a CHECK
        constraint pinned to ('dashboard','bank','other') in supabase/schema.sql,
        so a fourth value would be rejected by Postgres on every insert until
        that constraint is migrated. Coarse data beats silently dropped data.
        To split the homepage out later, run:
          alter table public.telemetry_events drop constraint telemetry_events_surface_check;
          alter table public.telemetry_events add constraint telemetry_events_surface_check
            check (surface in ('home','dashboard','bank','other'));
      */}
      <PageViewTracker surface="other" />

      {/* Nav ------------------------------------------------------------- */}
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex max-w-[80rem] items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-2 text-zinc-900">
            <Mark className="size-4 shrink-0" />
            <span className="font-mono text-[0.6875rem] font-medium tracking-wider">LUVENTRA</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-5">
            <Link
              href="/banks"
              className="hidden font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors duration-150 hover:text-zinc-900 sm:inline"
            >
              Supported banks
            </Link>
            <Link
              href="#how"
              className="hidden font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors duration-150 hover:text-zinc-900 sm:inline"
            >
              How it works
            </Link>
            <AuthLink />
          </nav>
        </div>
      </header>

      {/* Hero ------------------------------------------------------------- */}
      <section className="border-b border-zinc-200">
        <div className="mx-auto max-w-[80rem] px-6 pb-20 pt-20 sm:pb-28 sm:pt-28">
          <p className="font-mono text-[0.6875rem] uppercase tracking-widest text-emerald-600">
            Free · No account required
          </p>
          <h1 className="mt-5 max-w-3xl text-balance text-4xl font-medium leading-[1.12] tracking-tight text-zinc-900 sm:text-[3.25rem]">
            Convert a bank CSV statement into QuickBooks QBO, OFX or QFX
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-600">
            Drop your bank&rsquo;s CSV export below. The columns are detected, the rows are checked
            for the problems that break imports, and a spec-compliant file is generated on this
            page. Your statement is parsed inside your own browser and never leaves your device.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a
              href="#convert"
              className="inline-flex items-center gap-2 bg-zinc-900 px-5 py-2.5 text-sm font-semibold tracking-tight text-white transition-[colors,box-shadow] duration-150 hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            >
              Convert a statement
              <ArrowRight className="size-4" aria-hidden />
            </a>
            <Link
              href="/banks"
              className="inline-flex items-center gap-2 border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-900 transition-colors duration-150 hover:border-zinc-400 hover:bg-white focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
            >
              Find your bank
            </Link>
          </div>

          <ul className="mt-12 flex flex-wrap gap-x-10 gap-y-4">
            {[
              { icon: Lock, text: 'Never uploaded — parsed on your device' },
              { icon: Zap, text: 'Columns detected automatically' },
              { icon: ShieldCheck, text: 'OFX SGML 1.0.2 compliant output' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2 text-sm text-zinc-500">
                <Icon className="size-4 shrink-0 text-emerald-600" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* The converter ---------------------------------------------------- */}
      <section id="convert" className="scroll-mt-4 border-b border-zinc-200 bg-zinc-50">
        <div className="mx-auto max-w-[80rem] px-6 py-20">
          <h2 className="text-[1.75rem] font-medium tracking-tight text-zinc-900">
            Drop your statement here
          </h2>
          <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-zinc-600">
            Accepts CSV, TSV and delimited TXT exports from any bank. Nothing is sent anywhere —
            close the tab and the file is gone.
          </p>
          <div className="mt-8 overflow-hidden border border-zinc-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <StatementWorkbench embedded />
          </div>
        </div>
      </section>

      {/* How it works ----------------------------------------------------- */}
      <section id="how" className="scroll-mt-4 border-b border-zinc-200">
        <div className="mx-auto max-w-[80rem] px-6 py-20 sm:py-24">
          <h2 className="text-[1.75rem] font-medium tracking-tight text-zinc-900">How it works</h2>
          <ol className="mt-10 grid gap-10 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="border-t border-zinc-200 pt-5">
                <span className="font-mono text-[0.6875rem] tracking-widest text-emerald-600">
                  {step.n}
                </span>
                <h3 className="mt-3 text-base font-medium tracking-tight text-zinc-900">
                  {step.title}
                </h3>
                <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-zinc-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Privacy ---------------------------------------------------------- */}
      <section className="border-b border-zinc-200 bg-zinc-50">
        <div className="mx-auto max-w-[80rem] px-6 py-20 sm:py-24">
          <h2 className="max-w-3xl text-[1.75rem] font-medium tracking-tight text-zinc-900">
            Your statement never leaves this browser
          </h2>
          <div className="mt-8 grid max-w-5xl gap-10 text-[0.9375rem] leading-relaxed text-zinc-600 md:grid-cols-3">
            <p>
              Parsing and file generation both run inside an isolated Web Worker on your own
              machine. No transaction text, amount, payee, account number or filename is
              transmitted anywhere.
            </p>
            <p>
              There is no upload step to opt out of, because there is no upload. That is why no
              account is required to convert a file, and why closing the tab discards it.
            </p>
            <p>
              We count anonymous usage only: that a conversion happened, the output format, and a
              coarse row band such as &ldquo;51&ndash;200 rows&rdquo;. Never the statement itself.
            </p>
          </div>
        </div>
      </section>

      {/* Banks ------------------------------------------------------------ */}
      {banks.length > 0 ? (
        <section className="border-b border-zinc-200">
          <div className="mx-auto max-w-[80rem] px-6 py-20 sm:py-24">
            <h2 className="text-[1.75rem] font-medium tracking-tight text-zinc-900">
              Pre-configured for your bank
            </h2>
            <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-zinc-600">
              These pages open the converter with the column mapping already set for that
              bank&rsquo;s export layout, and explain the quirks that break a naive import.
            </p>
            <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {banks.map((bank) => (
                <li key={bank.slug}>
                  <Link
                    href={`/banks/${bank.slug}`}
                    className="flex items-center justify-between gap-3 border border-zinc-200 bg-zinc-50 px-4 py-3 transition-colors duration-150 hover:border-zinc-300 hover:bg-white"
                  >
                    <span className="text-sm text-zinc-900">{bank.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                      {bank.region}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* Closing CTA ------------------------------------------------------ */}
      <section className="bg-zinc-50">
        <div className="mx-auto max-w-[80rem] px-6 py-20 sm:py-24">
          <h2 className="max-w-2xl text-[1.75rem] font-medium tracking-tight text-zinc-900">
            Convert your first statement now
          </h2>
          <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-zinc-600">
            No account, no upload, no card. Create a free account only if you want unlimited
            conversions.
          </p>
          <a
            href="#convert"
            className="mt-6 inline-flex items-center gap-2 bg-zinc-900 px-5 py-2.5 text-sm font-semibold tracking-tight text-white transition-[colors,box-shadow] duration-150 hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            Convert a statement
            <ArrowRight className="size-4" aria-hidden />
          </a>
        </div>
      </section>
    </main>
  );
}
