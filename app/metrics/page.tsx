import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/app/lib/supabase/server';
import { hasSupabaseEnv } from '@/app/lib/supabase/env';
import { SEO_BANKS } from '@/app/lib/seo-banks-data';

/**
 * Internal metrics.
 *
 * ── ACCESS CONTROL: READ THIS ────────────────────────────────────────────────
 * The gate is a query-string key, which is obscurity, not authentication:
 *   - the default value is literally "admin" and is guessable in one attempt;
 *   - query strings land in server logs, proxy logs, browser history and the
 *     Referer header of any outbound link;
 *   - anyone holding the key reads every subscriber row, since this page uses
 *     the service-role client to bypass RLS.
 *
 * Two mitigations are in place and neither makes this real auth:
 *   1. `METRICS_KEY` (server-only, no NEXT_PUBLIC prefix) overrides the
 *      default, so production can use a long random value instead of "admin".
 *   2. The Google Ads tag is suppressed on this route, so the key is not sent
 *      to a third party as `page_location`.
 *
 * Before this holds anything sensitive, move it behind the Supabase session
 * that already exists and check an `is_admin` claim.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Metrics',
  // Must never be indexed or followed, whatever the key is set to.
  robots: { index: false, follow: false, nocache: true },
};

/** Defaults to the specified "admin"; override in production. */
const METRICS_KEY = process.env.METRICS_KEY ?? 'admin';

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface SubscriptionRow {
  readonly status: string | null;
  readonly cancel_at_period_end: boolean | null;
  readonly updated_at: string | null;
  readonly stripe_price_id: string | null;
}

function Tile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'muted';
}) {
  const valueTone =
    tone === 'good'
      ? 'text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-400'
        : tone === 'muted'
          ? 'text-zinc-600'
          : 'text-zinc-100';

  return (
    <div className="border border-zinc-800/60 bg-zinc-900 px-3 py-2.5">
      <p className="text-[0.625rem] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 font-mono text-xl tnum ${valueTone}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[0.625rem] leading-relaxed text-zinc-600">{hint}</p> : null}
    </div>
  );
}

export default async function MetricsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const key = params.key;

  // Exact match on a single value; an array (?key=a&key=b) is not a match.
  if (typeof key !== 'string' || key !== METRICS_KEY) {
    notFound();
  }

  /* -- subscriptions: the only data this application actually records ------ */

  let rows: SubscriptionRow[] | null = null;
  let dbError: string | null = null;

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    dbError = 'Supabase is not configured, so no subscription data can be read.';
  } else {
    try {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from('subscriptions')
        .select('status, cancel_at_period_end, updated_at, stripe_price_id');
      if (error) throw new Error(error.message);
      rows = (data ?? []) as SubscriptionRow[];
    } catch (cause) {
      dbError = cause instanceof Error ? cause.message : 'Could not read subscriptions.';
    }
  }

  const total = rows?.length ?? 0;
  const byStatus = new Map<string, number>();
  for (const row of rows ?? []) {
    const status = row.status ?? 'unknown';
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
  }
  const active = (byStatus.get('active') ?? 0) + (byStatus.get('trialing') ?? 0);
  const churning = rows?.filter((row) => row.cancel_at_period_end === true).length ?? 0;
  const lastUpdated = (rows ?? [])
    .map((row) => row.updated_at)
    .filter((value): value is string => typeof value === 'string')
    .sort()
    .at(-1);

  return (
    <main className="min-h-dvh">
      <div className="mx-auto max-w-[80rem] px-6 py-8">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-zinc-800/60 pb-3">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-sm font-medium tracking-tight text-zinc-100">Internal metrics</h1>
            <span className="font-mono text-[0.625rem] text-zinc-600">not indexed</span>
          </div>
          <span className="font-mono text-[0.625rem] text-zinc-600">
            {new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC
          </span>
        </header>

        {/* -- Billing: real numbers ------------------------------------- */}
        <section className="mt-6">
          <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider text-zinc-400">
            Subscriptions
          </h2>
          {dbError ? (
            <p className="mt-3 border-l border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[0.6875rem] leading-relaxed text-amber-400/90">
              {dbError}
            </p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Subscriber rows" value={total.toLocaleString()} hint="rows in public.subscriptions" />
              <Tile
                label="Active or trialing"
                value={active.toLocaleString()}
                tone={active > 0 ? 'good' : 'muted'}
                hint="entitled to the paid tier"
              />
              <Tile
                label="Cancelling at period end"
                value={churning.toLocaleString()}
                tone={churning > 0 ? 'warn' : 'muted'}
              />
              <Tile
                label="Last webhook write"
                value={lastUpdated ? lastUpdated.slice(0, 10) : '—'}
                tone={lastUpdated ? 'default' : 'muted'}
                hint="max(updated_at)"
              />
            </div>
          )}

          {rows && rows.length > 0 ? (
            <div className="mt-2 border border-zinc-800/60 bg-zinc-900">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-zinc-800/60">
                    <th className="px-3 py-2 text-[0.625rem] font-medium uppercase tracking-wider text-zinc-500">
                      Status
                    </th>
                    <th className="px-3 py-2 text-right text-[0.625rem] font-medium uppercase tracking-wider text-zinc-500">
                      Rows
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...byStatus.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([status, count]) => (
                      <tr key={status} className="border-b border-zinc-800/40 last:border-b-0">
                        <td className="px-3 py-1.5 font-mono text-xs text-zinc-300">{status}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-xs text-zinc-100 tnum">
                          {count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        {/* -- Conversions and referrals: not recorded anywhere ------------ */}
        <section className="mt-8">
          <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider text-zinc-400">
            Conversions, downloads and referrals
          </h2>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Tile label="Files generated" value="not recorded" tone="muted" />
            <Tile label="Download hits" value="not recorded" tone="muted" />
            <Tile label="Referral sources" value="not recorded" tone="muted" />
          </div>

          <div className="mt-3 max-w-3xl border-l border-zinc-800 bg-zinc-900/40 px-4 py-3">
            <p className="text-xs leading-relaxed text-zinc-400">
              These are shown as empty rather than as numbers because{' '}
              <strong className="text-zinc-200">the application does not record them</strong>.
              Conversion runs entirely in the browser&rsquo;s Web Worker and the download is a local
              object URL, so no request reaches the server when a file is produced —{' '}
              <code className="font-mono text-zinc-300">public.subscriptions</code> is the only
              table that exists, and it is written solely by the Stripe webhook. Inventing figures
              here would be worse than showing none.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              Today these counts live in Google Ads, from the{' '}
              <code className="font-mono text-zinc-300">file_converted</code> event the export
              handler fires. To surface them here instead, add a{' '}
              <code className="font-mono text-zinc-300">conversion_events</code> table and post to
              it on a successful export.
            </p>
            <p className="mt-2 text-[0.6875rem] leading-relaxed text-zinc-500">
              Note the trade before doing so: the bank pages state that nothing but a subscription
              check and an ad event leaves the browser. Logging exports server-side makes that copy
              false unless the row is strictly non-identifying — a timestamp, dialect and a
              row-count bucket, never a filename, account number or payee.
            </p>
          </div>
        </section>

        {/* -- Static surface inventory: derivable, so it is real ---------- */}
        <section className="mt-8">
          <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider text-zinc-400">
            Landing surface
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Bank pages built"
              value={SEO_BANKS.length.toLocaleString()}
              hint="prerendered /banks/<slug>"
            />
            <Tile
              label="Layouts verified"
              value={SEO_BANKS.filter((bank) => bank.verified).length.toLocaleString()}
              tone={SEO_BANKS.some((bank) => bank.verified) ? 'good' : 'warn'}
              hint="checked against a real export"
            />
            <Tile
              label="Awaiting verification"
              value={SEO_BANKS.filter((bank) => !bank.verified).length.toLocaleString()}
              tone="warn"
              hint="publishing unverified claims"
            />
            <Tile
              label="UK / EU pages"
              value={SEO_BANKS.filter((bank) => bank.region === 'UK' || bank.region === 'EU').length.toLocaleString()}
              hint="localised copy"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
