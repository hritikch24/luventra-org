import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/app/lib/supabase/server';
import { hasSupabaseEnv } from '@/app/lib/supabase/env';

/**
 * Internal analytics console.
 *
 * Layout mirrors the Urban Shopfronts metrics dashboard — stat-card row, then a
 * two-column split with a drop-off funnel on the left and a dense event matrix
 * on the right — rendered in this product's zinc palette.
 *
 * The range filter is a link rather than client state. Every chip is a real
 * re-query, the route is already `force-dynamic`, and keeping it server-side
 * means the access key never has to be handed to client JavaScript in order to
 * authenticate a second fetch. Shareable URLs come free.
 *
 * ── ACCESS CONTROL ─────────────────────────────────────────────────────────
 * `?key=` is obscurity, not authentication: the default is guessable and query
 * strings reach server and proxy logs. It now guards a table holding visitor
 * IP addresses, which raises the stakes considerably — move this behind the
 * Supabase session and an admin claim before production. `METRICS_KEY`
 * overrides the default meanwhile, and the ad tag is suppressed on this route
 * so the key is never sent to Google.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Metrics',
  robots: { index: false, follow: false, nocache: true },
};

const METRICS_KEY = process.env.METRICS_KEY ?? 'admin';

const RANGES = [
  { hours: 24, label: 'Last 24 Hours' },
  { hours: 48, label: 'Last 2 Days' },
  { hours: 24 * 7, label: 'Last 7 Days' },
  { hours: 24 * 30, label: 'Last 30 Days' },
] as const;

const DEFAULT_HOURS = 24 * 7;

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface EventRow {
  readonly event: string;
  readonly session_id: string;
  readonly bank_slug: string | null;
  readonly dialect: string | null;
  readonly country: string | null;
  readonly ip: string | null;
  readonly error_code: string | null;
  readonly created_at: string;
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
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
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'good' | 'bad';
}) {
  const valueTone =
    tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : 'text-zinc-100';
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold tracking-tight tnum ${valueTone}`}>{value}</p>
      {sub ? <p className="mt-1.5 text-xs text-zinc-400">{sub}</p> : null}
    </div>
  );
}

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
                  <p className="text-[11px] text-zinc-400 tnum">{ofTotal.toFixed(0)}% of landings</p>
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

const EVENT_STYLE: Readonly<Record<string, string>> = {
  visitor_landed: 'bg-zinc-800 text-zinc-200',
  file_loaded: 'bg-zinc-800 text-zinc-200',
  preflight_pass: 'bg-zinc-800 text-zinc-200',
  conversion_success: 'bg-emerald-500/15 text-emerald-300',
  conversion_failed: 'bg-red-500/15 text-red-300',
  user_logged_in: 'bg-blue-500/15 text-blue-300',
};

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

  const requested = Number(typeof params.hours === 'string' ? params.hours : '');
  const hours = RANGES.some((range) => range.hours === requested) ? requested : DEFAULT_HOURS;
  const activeRange = RANGES.find((range) => range.hours === hours) ?? RANGES[2];
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  let rows: EventRow[] | null = null;
  let dbError: string | null = null;

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    dbError =
      'Supabase is not configured, so nothing can be read back. Events are still being captured — they are printed to the server terminal instead of the database.';
  } else {
    try {
      const { data, error } = await createAdminClient()
        .from('telemetry_events')
        .select('event, session_id, bank_slug, dialect, country, ip, error_code, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20_000);
      if (error) throw new Error(error.message);
      rows = (data ?? []) as EventRow[];
    } catch (cause) {
      dbError =
        cause instanceof Error
          ? `${cause.message} — if this mentions a missing relation or column, apply supabase/schema.sql.`
          : 'Could not read telemetry.';
    }
  }

  const all = rows ?? [];
  const of = (event: string) => all.filter((row) => row.event === event);

  /* -- headline numbers -------------------------------------------------- */

  // Unique visitors count by IP where one was captured, falling back to the
  // session id. Behind a proxy that strips forwarding headers every IP is
  // null, and counting IPs alone would silently report zero visitors.
  const visitorKeys = new Set(
    of('visitor_landed').map((row) => row.ip ?? `session:${row.session_id}`),
  );
  const successes = of('conversion_success').length;
  const failures = of('conversion_failed').length;
  const logins = of('user_logged_in').length;

  const sessionsWith = (event: string) => new Set(of(event).map((row) => row.session_id));
  const landed = sessionsWith('visitor_landed');
  const loaded = sessionsWith('file_loaded');
  const passed = sessionsWith('preflight_pass');
  const converted = sessionsWith('conversion_success');

  const stages = [
    { label: 'Landed', note: 'Opened the dashboard or a bank page', value: landed.size },
    { label: 'Loaded CSV', note: 'A statement was parsed in the browser', value: loaded.size },
    { label: 'Passed checks', note: 'Every blocking pre-flight check cleared', value: passed.size },
    { label: 'Downloaded file', note: 'OFX, QBO or QFX saved', value: converted.size },
  ];

  const failureCounts = [
    ...of('conversion_failed').reduce((acc, row) => {
      const code = row.error_code ?? 'UNKNOWN';
      acc.set(code, (acc.get(code) ?? 0) + 1);
      return acc;
    }, new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1]);

  const topFailure = failureCounts[0];
  const recent = all.slice(0, 40);

  return (
    <main className="min-h-dvh bg-zinc-950">
      <div className="mx-auto max-w-[84rem] px-6 py-8">
        <header className="border-b border-zinc-800 pb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h1 className="text-lg font-bold tracking-tight text-zinc-100">Analytics console</h1>
              <span className="font-mono text-[0.6875rem] text-zinc-400">not indexed</span>
            </div>
            <span className="font-mono text-[0.6875rem] text-zinc-400">
              {new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC
            </span>
          </div>

          {/* Range filter — each chip is a real re-query. */}
          <nav aria-label="Time range" className="mt-4 flex flex-wrap gap-2">
            {RANGES.map((range) => {
              const active = range.hours === hours;
              return (
                <Link
                  key={range.hours}
                  href={{ pathname: '/metrics', query: { key, hours: range.hours } }}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                    active
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100'
                  }`}
                >
                  {range.label}
                </Link>
              );
            })}
          </nav>
        </header>

        {dbError ? (
          <p className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm leading-relaxed text-amber-300">
            {dbError}
          </p>
        ) : null}

        {/* Headline cards --------------------------------------------------- */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total visitors"
            value={visitorKeys.size.toLocaleString()}
            sub={`Unique IPs · ${activeRange.label.toLowerCase()}`}
          />
          <StatCard
            label="Successful conversions"
            value={successes.toLocaleString()}
            tone={successes > 0 ? 'good' : 'default'}
            sub="Files downloaded"
          />
          <StatCard
            label="Failed conversions"
            value={failures.toLocaleString()}
            tone={failures > 0 ? 'bad' : 'default'}
            sub={topFailure ? `Top: ${topFailure[0]} (${topFailure[1]})` : 'No rejections'}
          />
          <StatCard
            label="Logged in users"
            value={logins.toLocaleString()}
            sub="Magic-link sign-ins completed"
          />
        </div>

        {/* Funnel + event matrix -------------------------------------------- */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Panel
            title="Conversion funnel"
            right={<span className="font-mono text-[0.6875rem] text-zinc-400">by session</span>}
          >
            {landed.size === 0 ? (
              <EmptyNote>No landings recorded in this range.</EmptyNote>
            ) : (
              <Funnel stages={stages} />
            )}

            {failureCounts.length > 0 ? (
              <div className="mt-4 border-t border-zinc-800 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                  Failure reasons
                </p>
                <div className="mt-2 space-y-1.5">
                  {failureCounts.map(([code, count]) => (
                    <div key={code} className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-mono text-xs text-red-300">{code}</span>
                      <span className="shrink-0 text-sm font-semibold text-zinc-100 tnum">
                        {count.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Recent events"
            right={
              <span className="font-mono text-[0.6875rem] text-zinc-400">
                latest {Math.min(recent.length, 40)}
              </span>
            }
          >
            {recent.length === 0 ? (
              <EmptyNote>No events recorded in this range.</EmptyNote>
            ) : (
              <div className="scroll-thin max-h-[28rem] overflow-auto">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-zinc-900">
                    <tr className="border-b border-zinc-800">
                      <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        Time
                      </th>
                      <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        Event
                      </th>
                      <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        Country
                      </th>
                      <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((row, index) => (
                      <tr
                        key={`${row.created_at}-${index}`}
                        className="border-b border-zinc-800/60 last:border-b-0"
                      >
                        <td className="py-1.5 pr-3 font-mono text-[0.6875rem] text-zinc-300 tnum">
                          {row.created_at.replace('T', ' ').slice(5, 19)}
                        </td>
                        <td className="py-1.5 pr-3">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 font-mono text-[0.625rem] ${
                              EVENT_STYLE[row.event] ?? 'bg-zinc-800 text-zinc-200'
                            }`}
                          >
                            {row.event}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-xs text-zinc-200">
                          {row.country ?? '—'}
                        </td>
                        <td className="py-1.5 font-mono text-[0.6875rem]">
                          {row.error_code ? (
                            <span className="text-red-300">{row.error_code}</span>
                          ) : row.event === 'conversion_success' ? (
                            <span className="text-emerald-300">{row.dialect ?? 'ok'}</span>
                          ) : (
                            <span className="text-zinc-400">
                              {row.bank_slug ? row.bank_slug.replace('-to-quickbooks', '') : 'ok'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <p className="mt-6 text-xs leading-relaxed text-zinc-400">
          Counters plus visitor origin. The table has no column able to hold a filename, an amount,
          an account number or a payee, and row counts are stored as coarse bands. IP addresses are
          personal data: they are kept only to count unique visitors, are never rendered on this
          page, and are purged after 90 days by{' '}
          <code className="font-mono text-zinc-300">purge_old_telemetry()</code>.
        </p>
      </div>
    </main>
  );
}
