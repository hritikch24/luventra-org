import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/app/lib/supabase/server';
import { hasSupabaseEnv } from '@/app/lib/supabase/env';
import { SEO_BANKS } from '@/app/lib/seo-banks-data';

/**
 * Internal metrics.
 *
 * Layout follows the Urban Shopfronts metrics dashboard: a stat-card row over
 * a two-column split, with a drop-off funnel on the left and a dense source
 * table on the right. Rendered in this product's zinc palette rather than that
 * project's gold/navy one.
 *
 * ── ACCESS CONTROL ──────────────────────────────────────────────────────────
 * The gate is a query-string key, which is obscurity rather than
 * authentication: the default is guessable, query strings reach server and
 * proxy logs, and whoever holds it reads the whole table through the
 * service-role client. `METRICS_KEY` overrides the default, and the ad tag is
 * suppressed on this route so the key is never sent to Google. Move this
 * behind the Supabase session before it holds anything sensitive.
 *
 * ── WHAT THIS CAN SHOW ──────────────────────────────────────────────────────
 * Everything here comes from `telemetry_events`, which can only hold counters:
 * an event name, a random per-tab id, one of our own page slugs, a format
 * choice and a coarse size band. There is no column capable of holding a
 * filename, an amount or an account number, so no chart below can accidentally
 * surface statement content.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Metrics',
  robots: { index: false, follow: false, nocache: true },
};

const METRICS_KEY = process.env.METRICS_KEY ?? 'admin';
const WINDOW_DAYS = 30;

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface EventRow {
  readonly event: string;
  readonly session_id: string;
  readonly surface: string | null;
  readonly bank_slug: string | null;
  readonly dialect: string | null;
  readonly referrer_host: string | null;
}

/* -------------------------------------------------------------------------- */
/* Presentation primitives                                                    */
/* -------------------------------------------------------------------------- */

function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">{label}</p>
      <p
        className={`mt-2 text-3xl font-bold tracking-tight tnum ${
          accent ? 'text-emerald-400' : 'text-zinc-100'
        }`}
      >
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-xs text-zinc-400">{sub}</p> : null}
    </div>
  );
}

/** Stacked stages with proportional fill and an explicit drop-off between each. */
function Funnel({ stages }: { stages: readonly { label: string; note: string; value: number }[] }) {
  const top = Math.max(stages[0]?.value ?? 0, 1);

  return (
    <div className="space-y-1">
      {stages.map((stage, index) => {
        const previous = index === 0 ? null : (stages[index - 1]?.value ?? 0);
        const lost = previous === null ? 0 : previous - stage.value;
        const dropPct = previous && previous > 0 ? (lost / previous) * 100 : 0;
        const widthPct = (stage.value / top) * 100;
        const ofTotal = top > 0 ? (stage.value / top) * 100 : 0;
        // Shedding more than half the remaining visitors is the story.
        const severe = dropPct >= 50;

        return (
          <div key={stage.label}>
            {previous !== null ? (
              <div className="flex items-center gap-2 py-1 pl-1">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className={severe ? 'text-red-400' : 'text-zinc-400'}
                  aria-hidden
                >
                  <path d="M12 5v14M19 12l-7 7-7-7" />
                </svg>
                <span
                  className={`text-xs font-semibold ${severe ? 'text-red-400' : 'text-zinc-400'}`}
                >
                  {lost.toLocaleString()} lost here ({dropPct.toFixed(0)}%)
                </span>
              </div>
            ) : null}

            <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
              <div
                className="absolute inset-y-0 left-0 bg-emerald-500/15"
                style={{ width: `${Math.max(widthPct, 1.5)}%` }}
                aria-hidden
              />
              <div className="relative flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-100">{stage.label}</p>
                  <p className="truncate text-xs text-zinc-400">{stage.note}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-bold text-zinc-100 tnum">
                    {stage.value.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-zinc-400 tnum">{ofTotal.toFixed(0)}% of visits</p>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-6 text-center text-sm text-zinc-400">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default async function MetricsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const key = params.key;

  // Exact match on a single value; ?key=a&key=b is an array and is not a match.
  if (typeof key !== 'string' || key !== METRICS_KEY) {
    notFound();
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  let rows: EventRow[] | null = null;
  let dbError: string | null = null;

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    dbError = 'Supabase is not configured, so no telemetry can be read.';
  } else {
    try {
      const { data, error } = await createAdminClient()
        .from('telemetry_events')
        .select('event, session_id, surface, bank_slug, dialect, referrer_host')
        .gte('created_at', since)
        .limit(50_000);
      if (error) throw new Error(error.message);
      rows = (data ?? []) as EventRow[];
    } catch (cause) {
      dbError =
        cause instanceof Error
          ? `${cause.message} — if this mentions a missing relation, apply supabase/schema.sql.`
          : 'Could not read telemetry.';
    }
  }

  const all = rows ?? [];

  /* -- aggregates ------------------------------------------------------- */

  const sessionsOf = (event: string) =>
    new Set(all.filter((row) => row.event === event).map((row) => row.session_id));

  const viewSessions = sessionsOf('page_view');
  const loadedSessions = sessionsOf('file_loaded');
  const passSessions = sessionsOf('preflight_pass');
  const exportSessions = sessionsOf('export');

  const pageViews = all.filter((row) => row.event === 'page_view').length;
  const totalExports = all.filter((row) => row.event === 'export').length;
  const conversionRate =
    viewSessions.size > 0 ? (exportSessions.size / viewSessions.size) * 100 : 0;

  const stages = [
    { label: 'Visited a page', note: 'Any dashboard or bank landing page', value: viewSessions.size },
    { label: 'Loaded a statement', note: 'A CSV was parsed in the browser', value: loadedSessions.size },
    { label: 'Passed pre-flight', note: 'Every blocking check cleared', value: passSessions.size },
    { label: 'Exported a file', note: 'Downloaded OFX, QBO or QFX', value: exportSessions.size },
  ];

  // Per-bank-page attribution, ordered by exports then sessions.
  const bankName = new Map(SEO_BANKS.map((bank) => [bank.slug, bank.name]));
  const perBank = new Map<string, { sessions: Set<string>; exports: number }>();
  for (const row of all) {
    if (!row.bank_slug) continue;
    const entry = perBank.get(row.bank_slug) ?? { sessions: new Set<string>(), exports: 0 };
    if (row.event === 'page_view') entry.sessions.add(row.session_id);
    perBank.set(row.bank_slug, entry);
  }
  // An export carries no slug, so attribute it to the bank page that session saw.
  const sessionBank = new Map<string, string>();
  for (const row of all) {
    if (row.event === 'page_view' && row.bank_slug) sessionBank.set(row.session_id, row.bank_slug);
  }
  for (const row of all) {
    if (row.event !== 'export') continue;
    const slug = sessionBank.get(row.session_id);
    if (!slug) continue;
    const entry = perBank.get(slug);
    if (entry) entry.exports += 1;
  }

  const bankRows = [...perBank.entries()]
    .map(([slug, entry]) => ({
      slug,
      name: bankName.get(slug) ?? slug,
      sessions: entry.sessions.size,
      exports: entry.exports,
    }))
    .sort((a, b) => b.exports - a.exports || b.sessions - a.sessions)
    .slice(0, 12);

  const byDialect = ['ofx', 'qbo', 'qfx'].map((dialect) => ({
    dialect,
    count: all.filter((row) => row.event === 'export' && row.dialect === dialect).length,
  }));

  const byReferrer = [...all
    .filter((row) => row.event === 'page_view' && row.referrer_host)
    .reduce((acc, row) => {
      const host = row.referrer_host ?? 'direct';
      acc.set(host, (acc.get(host) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <main className="min-h-dvh bg-zinc-950">
      <div className="mx-auto max-w-[84rem] px-6 py-8">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-zinc-800 pb-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-bold tracking-tight text-zinc-100">Internal metrics</h1>
            <span className="font-mono text-[0.6875rem] text-zinc-400">
              last {WINDOW_DAYS} days · not indexed
            </span>
          </div>
          <span className="font-mono text-[0.6875rem] text-zinc-400">
            {new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC
          </span>
        </header>

        {dbError ? (
          <p className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm leading-relaxed text-amber-300">
            {dbError}
          </p>
        ) : null}

        {/* Stat row -------------------------------------------------------- */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Page views"
            value={pageViews.toLocaleString()}
            sub="Dashboard and bank pages"
          />
          <StatCard
            label="Sessions"
            value={viewSessions.size.toLocaleString()}
            sub="Distinct browser tabs"
          />
          <StatCard
            label="Conversion rate"
            value={`${conversionRate.toFixed(1)}%`}
            accent={conversionRate > 0}
            sub="Sessions that exported a file"
          />
          <StatCard
            label="Total exports"
            value={totalExports.toLocaleString()}
            sub="OFX, QBO and QFX combined"
          />
        </div>

        {/* Split: funnel left, sources right -------------------------------- */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Panel
            title="Conversion funnel"
            right={
              <span className="font-mono text-[0.6875rem] text-zinc-400">by session</span>
            }
          >
            {viewSessions.size === 0 ? (
              <EmptyNote>
                No sessions recorded yet. Counters begin once{' '}
                <code className="font-mono text-zinc-300">telemetry_events</code> exists and a
                visitor opens the dashboard or a bank page.
              </EmptyNote>
            ) : (
              <Funnel stages={stages} />
            )}
          </Panel>

          <Panel
            title="Bank landing pages"
            right={<span className="font-mono text-[0.6875rem] text-zinc-400">top 12</span>}
          >
            {bankRows.length === 0 ? (
              <EmptyNote>No bank page traffic recorded in this window.</EmptyNote>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        Page
                      </th>
                      <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        Sessions
                      </th>
                      <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        Exports
                      </th>
                      <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        Rate
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankRows.map((row) => {
                      const rate = row.sessions > 0 ? (row.exports / row.sessions) * 100 : 0;
                      const strong = rate >= 20 && row.sessions >= 5;
                      return (
                        <tr key={row.slug} className="border-b border-zinc-800/60 last:border-b-0">
                          <td className="py-2 pr-3 text-sm text-zinc-200">
                            <span className="block max-w-[16rem] truncate" title={row.slug}>
                              {row.name}
                            </span>
                          </td>
                          <td className="py-2 text-right text-sm text-zinc-300 tnum">
                            {row.sessions.toLocaleString()}
                          </td>
                          <td className="py-2 text-right text-sm font-semibold text-zinc-100 tnum">
                            {row.exports.toLocaleString()}
                          </td>
                          <td
                            className={`py-2 text-right text-sm font-semibold tnum ${
                              strong ? 'text-emerald-400' : 'text-zinc-400'
                            }`}
                          >
                            {rate.toFixed(0)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        {/* Secondary row ---------------------------------------------------- */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Panel title="Formats exported">
            {totalExports === 0 ? (
              <EmptyNote>No exports recorded in this window.</EmptyNote>
            ) : (
              <div className="space-y-2">
                {byDialect.map(({ dialect, count }) => {
                  const pct = totalExports > 0 ? (count / totalExports) * 100 : 0;
                  return (
                    <div key={dialect}>
                      <div className="flex items-baseline justify-between">
                        <span className="font-mono text-xs uppercase text-zinc-200">{dialect}</span>
                        <span className="text-xs text-zinc-300 tnum">
                          {count.toLocaleString()} · {pct.toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-emerald-500/70 transition-all duration-700"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="Referrers">
            {byReferrer.length === 0 ? (
              <EmptyNote>No referrer data in this window.</EmptyNote>
            ) : (
              <table className="w-full text-left">
                <tbody>
                  {byReferrer.map(([host, count]) => (
                    <tr key={host} className="border-b border-zinc-800/60 last:border-b-0">
                      <td className="py-1.5 font-mono text-xs text-zinc-200">{host}</td>
                      <td className="py-1.5 text-right text-sm text-zinc-100 tnum">
                        {count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        {/* Surface inventory ------------------------------------------------ */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Bank pages built" value={SEO_BANKS.length.toLocaleString()} sub="prerendered" />
          <StatCard
            label="Layouts verified"
            value={SEO_BANKS.filter((bank) => bank.verified).length.toLocaleString()}
            sub="checked against a real export"
          />
          <StatCard
            label="Awaiting verification"
            value={SEO_BANKS.filter((bank) => !bank.verified).length.toLocaleString()}
            sub="unverified public claims"
          />
          <StatCard
            label="UK / EU pages"
            value={SEO_BANKS.filter((b) => b.region === 'UK' || b.region === 'EU').length.toLocaleString()}
            sub="localised copy"
          />
        </div>

        <p className="mt-6 text-xs leading-relaxed text-zinc-400">
          Counters only. <code className="font-mono text-zinc-300">telemetry_events</code> has no
          column able to hold a filename, an amount, an account number or a payee, and row counts
          are stored as coarse bands rather than exact figures. Session ids are random per tab and
          are never joined to an account.
        </p>
      </div>
    </main>
  );
}
