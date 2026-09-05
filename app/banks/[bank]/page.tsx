import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Lock, ShieldCheck, Zap } from 'lucide-react';
import { SEO_BANKS, bankBySlug } from '@/app/lib/seo-banks-data';
import { resolvePresetRoles } from '@/app/lib/preset-resolve';
import { copyFor } from '@/app/lib/market-context';
import { StatementWorkbench } from '@/app/dashboard/StatementWorkbench';

interface PageProps {
  /** `params` is a promise in this version of Next and must be awaited. */
  readonly params: Promise<{ bank: string }>;
}

/**
 * Every configured profile is emitted as static HTML at build time.
 *
 * Each entry makes specific factual claims about a named company's export
 * format, so an unverified profile renders a visible caveat rather than being
 * hidden — the accuracy policy `seo-banks-data.ts` documents. Nothing here
 * affects a conversion: the worker reads the real schema from the file.
 */
export function generateStaticParams(): Array<{ bank: string }> {
  return SEO_BANKS.map((bank) => ({ bank: bank.slug }));
}

/** An unknown slug 404s rather than being rendered on demand. */
export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { bank: slug } = await params;
  const profile = bankBySlug(slug);
  if (!profile) return {};

  const title = `Convert ${profile.name} CSV Statements to QuickBooks QBO/OFX Format`;
  const description = `Convert ${profile.legalName} ${profile.accountKind} CSV exports to QBO, OFX or QFX for QuickBooks, Quicken and Xero. Runs entirely in your browser — the file is never uploaded.`;

  return {
    title,
    description,
    alternates: { canonical: `/banks/${profile.slug}` },
    openGraph: { title, description, type: 'website', url: `/banks/${profile.slug}` },
    twitter: { card: 'summary', title, description },
  };
}

export default async function BankPage({ params }: PageProps) {
  const { bank: slug } = await params;
  const profile = bankBySlug(slug);
  if (!profile) notFound();

  const preset = { name: profile.name, headerMap: profile.headerMap };
  const others = SEO_BANKS.filter((entry) => entry.slug !== profile.slug);
  const hasHeaderRow = profile.headers.length > 0;
  const resolvedRoles = resolvePresetRoles(profile.headers, profile.headerMap);
  /**
   * Market copy is resolved here, on the server, from the profile's static
   * `region` — not in a client effect.
   *
   * A client-side override would defeat the point of these pages three times
   * over: the localised copy would be absent from the prerendered HTML that
   * Googlebot indexes, the swap would flash US wording before correcting on
   * hydration, and rendering different markup on client than server is a
   * hydration mismatch. The slug is known at build time, so the decision
   * belongs at build time.
   */
  const copy = copyFor(profile.region);
  // When a profile ships no explicit quirks the data layer synthesises one from
  // `commonGotcha`; rendering both would print the same paragraph twice.
  const quirks = profile.quirks.filter((quirk) => quirk.body !== profile.commonGotcha);

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: `Convert ${profile.name} CSV to QBO or OFX`,
    description: `Convert a ${profile.legalName} ${profile.accountKind} CSV export into QuickBooks QBO, OFX or QFX without uploading the file.`,
    step: [
      { '@type': 'HowToStep', name: 'Export CSV', text: `Download your ${profile.name} transactions as CSV.` },
      { '@type': 'HowToStep', name: 'Drop the file', text: 'Drop it into the converter. Parsing happens in your browser.' },
      { '@type': 'HowToStep', name: 'Confirm the mapping', text: 'Columns are pre-selected for this layout; adjust if your export differs.' },
      { '@type': 'HowToStep', name: 'Download', text: 'Generate QBO, OFX or QFX and import it into your accounting software.' },
    ],
  };

  return (
    <main className="min-h-dvh">
      <script
        type="application/ld+json"
        // Values come from the static table in this repo, never user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <header className="border-b border-zinc-800/60">
        <div className="mx-auto flex max-w-[80rem] items-center justify-between px-6 py-3">
          <Link
            href="/banks"
            className="flex items-center gap-1.5 font-mono text-[0.6875rem] text-zinc-500 transition-colors duration-150 hover:text-zinc-200"
          >
            <ArrowLeft className="size-3" aria-hidden />
            all banks
          </Link>
          <span className="font-mono text-[0.625rem] text-zinc-600">csv → ofx/qbo/qfx</span>
        </div>
      </header>

      {/* Hero ------------------------------------------------------------ */}
      <section className="mx-auto max-w-[80rem] px-6 pt-10 pb-6">
        <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-accent">
          {profile.legalName} · {profile.accountKind} · {profile.region}
        </p>
        <h1 className="mt-2 max-w-3xl text-balance text-3xl font-medium leading-tight tracking-tight text-zinc-100">
          Convert {profile.name} CSV Statements to QuickBooks QBO/OFX Format
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Drop a {profile.name} export below. The columns are pre-selected for this
          layout, the rows are checked for the problems that break imports, and the QBO, OFX or QFX
          file is generated on this page. Your statement is parsed by a Web Worker inside your own
          browser and never leaves the device.
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
          {copy.integrationLine}
        </p>

        <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          {[
            { icon: Lock, text: 'No upload — parsed locally' },
            { icon: Zap, text: 'Pre-mapped for this layout' },
            { icon: ShieldCheck, text: `Ready for ${copy.primaryIntegration}` },
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Icon className="size-3.5 text-zinc-600" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </section>

      {/* The real tool, pre-configured ------------------------------------ */}
      <section
        aria-label={`${profile.name} statement converter`}
        className="mx-auto max-w-[80rem] px-6 pb-12"
      >
        <div className="overflow-hidden border border-zinc-800/60">
          <StatementWorkbench preset={preset} embedded />
        </div>
      </section>

      {/* Layout schema ---------------------------------------------------- */}
      <section className="border-t border-zinc-800/60">
        <div className="mx-auto max-w-[80rem] px-6 py-12">
          <div className="grid gap-10 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <div>
              <h2 className="text-lg font-medium tracking-tight text-zinc-100">
                The {profile.name} CSV layout
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                What a {profile.name} export contains, and which field each column
                becomes in the converted file.
              </p>

              <dl className="mt-5 space-y-3 border-t border-zinc-800/60 pt-4">
                <div>
                  <dt className="text-[0.625rem] uppercase tracking-wider text-zinc-600">
                    Date format
                  </dt>
                  <dd className="mt-0.5 font-mono text-xs text-zinc-300">
                    {profile.dateFormat} ({profile.dateOrder})
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.625rem] uppercase tracking-wider text-zinc-600">
                    Amount convention
                  </dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-zinc-300">
                    {profile.amountConvention}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.625rem] uppercase tracking-wider text-zinc-600">
                    Header row
                  </dt>
                  <dd className="mt-0.5 font-mono text-xs text-zinc-300 tnum">
                    {hasHeaderRow ? `${profile.headers.length} columns` : 'none'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.625rem] uppercase tracking-wider text-zinc-600">
                    Currency
                  </dt>
                  <dd className="mt-0.5 font-mono text-xs text-zinc-300 tnum">
                    {copy.currencySymbol} {copy.currencyCode} · e.g. {copy.amountExample}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.625rem] uppercase tracking-wider text-zinc-600">
                    Layout checked
                  </dt>
                  <dd className="mt-0.5 font-mono text-xs text-zinc-300">
                    {profile.lastReviewed}
                  </dd>
                </div>
              </dl>

              {!profile.verified ? (
                <p className="mt-5 border-l border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[0.6875rem] leading-relaxed text-amber-400/90">
                  This layout is compiled from published export formats and has not yet been
                  diffed against a live {profile.name} download. Banks change their columns, and
                  the shape differs between account types. Your conversion is unaffected — the
                  converter reads the real schema from your file — so adjust the mapping above if
                  your export differs from the table.
                </p>
              ) : null}
            </div>

            <div className="min-w-0">
              {hasHeaderRow ? (
                <div className="scroll-thin overflow-x-auto border border-zinc-800/60 bg-zinc-900">
                  <table className="w-full min-w-[30rem] border-collapse text-left">
                    <caption className="sr-only">
                      {profile.name} CSV columns and the field each becomes
                    </caption>
                    <thead>
                      <tr className="border-b border-zinc-800/60">
                        <th
                          scope="col"
                          className="w-10 px-3 py-2 text-right text-[0.625rem] font-medium uppercase tracking-wider text-zinc-600"
                        >
                          #
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-[0.625rem] font-medium uppercase tracking-wider text-zinc-500"
                        >
                          Column in export
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-[0.625rem] font-medium uppercase tracking-wider text-zinc-500"
                        >
                          Pre-selected as
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.headers.map((header, index) => {
                        const role = resolvedRoles[index];
                        return (
                          <tr
                            key={header}
                            className="border-b border-zinc-800/40 transition-colors duration-150 last:border-b-0 hover:bg-zinc-800/30"
                          >
                            <td className="px-3 py-2 text-right font-mono text-[0.625rem] text-zinc-700 tnum">
                              {index + 1}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-zinc-200">{header}</td>
                            <td
                              className={`px-3 py-2 font-mono text-xs ${
                                role === undefined || role === 'ignored'
                                  ? 'text-zinc-600'
                                  : 'text-zinc-400'
                              }`}
                            >
                              {role ?? 'detected from content'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="border-l border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm leading-relaxed text-zinc-400">
                  This export ships <strong className="text-zinc-200">no header row</strong> — it
                  opens straight at the first transaction. There are no column names to pre-select
                  against, so every column is identified by its contents instead, and the mapping
                  table lets you reassign any of them by hand.
                </p>
              )}

              <h2 className="mt-10 text-lg font-medium tracking-tight text-zinc-100">
                Import errors this layout causes, and what happens instead
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">{profile.commonGotcha}</p>

              <div className="mt-6 space-y-5">
                {quirks.map((quirk) => (
                  <article key={quirk.title} className="border-l border-zinc-800 pl-4">
                    <h3 className="text-sm font-medium text-zinc-200">{quirk.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-400">{quirk.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Privacy model ---------------------------------------------------- */}
      <section className="border-t border-zinc-800/60">
        <div className="mx-auto max-w-[80rem] px-6 py-12">
          <h2 className="text-lg font-medium tracking-tight text-zinc-100">
            {copy.residencyTitle}
          </h2>
          <div className="mt-4 grid gap-6 text-sm leading-relaxed text-zinc-400 md:grid-cols-3">
            <p>
              {copy.residencyBody}
            </p>
            <p>
              Running off the main thread is also what keeps the page responsive. Encoding
              detection, a full parse and emitting a large document are heavy on a long statement;
              on the main thread that would freeze the interface. The worker carries a processing
              deadline, so a malformed file fails with a clear message rather than hanging.
            </p>
            <p>
              Two things do touch the network, and neither carries statement data: a subscription
              check when a file exceeds the free row limit, and an advertising tag that records
              that <em>a</em> conversion happened — an event name and nothing else. No filename,
              no row count, no amounts, no payee names. The file stays in the tab, and closing the
              tab discards it.
            </p>
          </div>
        </div>
      </section>

      {/* Internal links --------------------------------------------------- */}
      {others.length > 0 ? (
        <section className="border-t border-zinc-800/60">
          <div className="mx-auto max-w-[80rem] px-6 py-10">
            <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider text-zinc-400">
              Other banks
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {others.map((entry) => (
                <li key={entry.slug}>
                  <Link
                    href={`/banks/${entry.slug}`}
                    className="block border border-zinc-800/60 px-3 py-1.5 font-mono text-[0.6875rem] text-zinc-400 transition-colors duration-150 hover:border-zinc-700 hover:text-zinc-100"
                  >
                    {entry.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </main>
  );
}
