import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/app/lib/supabase/server';
import { describeSupabaseEnv, hasServerSupabaseEnv } from '@/app/lib/supabase/env';

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
  readonly browser: string | null;
  readonly os: string | null;
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
        <h2 className="text-sm font-semibold tracking-tight text-white">{title}</h2>
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
      <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-200">{label}</p>
      <p className={`mt-2 text-3xl font-bold tracking-tight tnum ${valueTone}`}>{value}</p>
      {sub ? <p className="mt-1.5 text-xs text-zinc-300">{sub}</p> : null}
    </div>
  );
}

/**
 * Waterfall funnel drawn as one SVG.
 *
 * Each stage is a band whose width is proportional to its value, joined to the
 * next by a filled taper so the loss between stages is the visible area rather
 * than a number to read. Laid out in a fixed 1000-unit viewBox and scaled with
 * `preserveAspectRatio="none"`, so it fills any panel width without needing a
 * measured container.
 */
function FunnelChart({
  stages,
}: {
  stages: readonly { label: string; note: string; value: number }[];
}) {
  const top = Math.max(stages[0]?.value ?? 0, 1);
  const W = 1000;
  const BAND = 54;
  const GAP = 30;
  const H = stages.length * BAND + (stages.length - 1) * GAP;

  const widthOf = (value: number) => Math.max((value / top) * W, 6);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[19rem] w-full"
        role="img"
        aria-label="Conversion funnel"
      >
        <defs>
          <linearGradient id="funnel-band" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0.22" />
          </linearGradient>
        </defs>

        {stages.map((stage, index) => {
          const y = index * (BAND + GAP);
          const w = widthOf(stage.value);
          const next = stages[index + 1];
          const nextW = next ? widthOf(next.value) : null;

          return (
            <g key={stage.label}>
              {/* Track, so an empty stage still reads as a slot. */}
              <rect x={0} y={y} width={W} height={BAND} rx={4} fill="rgb(9 9 11)" stroke="rgb(39 39 42)" />
              <rect x={0} y={y} width={w} height={BAND} rx={4} fill="url(#funnel-band)" />

              {/* Taper into the next stage: the gap is the drop-off. */}
              {nextW !== null ? (
                <polygon
                  points={`0,${y + BAND} ${w},${y + BAND} ${nextW},${y + BAND + GAP} 0,${y + BAND + GAP}`}
                  fill="rgb(16 185 129)"
                  fillOpacity="0.1"
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      {/* Labels sit outside the SVG so text is never distorted by the
          non-uniform scaling that makes the chart fill its container. */}
      <div className="-mt-[19rem] flex h-[19rem] flex-col">
        {stages.map((stage, index) => {
          const previous = index === 0 ? null : (stages[index - 1]?.value ?? 0);
          const lost = previous === null ? 0 : previous - stage.value;
          const dropPct = previous && previous > 0 ? (lost / previous) * 100 : 0;
          const severe = dropPct >= 50;
          const ofTotal = top > 0 ? (stage.value / top) * 100 : 0;

          return (
            <div key={stage.label} className="flex flex-1 flex-col justify-center">
              <div className="flex items-center justify-between gap-3 px-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{stage.label}</p>
                  <p className="truncate text-xs text-zinc-200">{stage.note}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-bold text-white tnum">
                    {stage.value.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-zinc-200 tnum">{ofTotal.toFixed(0)}%</p>
                </div>
              </div>
              {previous !== null ? (
                <p
                  className={`px-3 pt-0.5 text-[11px] font-semibold ${
                    severe ? 'text-red-400' : 'text-zinc-300'
                  }`}
                >
                  ↓ {lost.toLocaleString()} lost ({dropPct.toFixed(0)}%)
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Hourly activity grid: 24 columns of one hour each, most recent on the right.
 * Cell opacity scales with volume against the busiest hour, so peak trading
 * hours are visible at a glance without axes.
 */
function HourlyGrid({
  buckets,
}: {
  buckets: readonly { hour: string; landed: number; converted: number }[];
}) {
  const peak = Math.max(1, ...buckets.map((b) => b.landed));

  return (
    <div>
      <div className="flex items-end gap-[3px]">
        {buckets.map((bucket) => {
          const share = bucket.landed / peak;
          return (
            <div key={bucket.hour} className="group relative flex-1">
              <div className="flex h-24 items-end">
                <div className="w-full rounded-sm bg-zinc-800" style={{ height: '100%' }}>
                  <div className="flex h-full w-full flex-col justify-end">
                    <div
                      className="w-full rounded-sm bg-emerald-500/70"
                      style={{ height: `${Math.max(share * 100, bucket.landed > 0 ? 6 : 0)}%` }}
                    />
                  </div>
                </div>
              </div>
              {/* Conversions as a second, denser mark under each column. */}
              <div
                className={`mt-[3px] h-1 rounded-sm ${
                  bucket.converted > 0 ? 'bg-emerald-300' : 'bg-zinc-800'
                }`}
              />
              <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-100 group-hover:block">
                {bucket.hour} · {bucket.landed} in / {bucket.converted} conv
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-zinc-300">
        <span>{buckets[0]?.hour ?? ''}</span>
        <span>{buckets[buckets.length - 1]?.hour ?? ''}</span>
      </div>
      <div className="mt-2 flex items-center gap-4 text-[11px] text-zinc-200">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-emerald-500/70" /> landings
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-emerald-300" /> conversions
        </span>
      </div>
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

  if (!hasServerSupabaseEnv()) {
    dbError = `No server credentials resolved (found: ${describeSupabaseEnv()}). Set SUPABASE_URL and SUPABASE_SECRET_KEY. Events are still captured — they print to the server log instead of the database.`;
  } else {
    try {
      const { data, error } = await createAdminClient()
        .from('telemetry_events')
        .select('event, session_id, bank_slug, dialect, country, ip, browser, os, error_code, created_at')
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

  // 24 one-hour buckets ending at the current hour, oldest on the left.
  const nowMs = Date.now();
  const buckets = Array.from({ length: 24 }, (_, index) => {
    const slotEnd = nowMs - (23 - index) * 3_600_000;
    const start = new Date(slotEnd);
    start.setMinutes(0, 0, 0);
    const from = start.getTime();
    const to = from + 3_600_000;
    const inSlot = all.filter((row) => {
      const at = Date.parse(row.created_at);
      return at >= from && at < to;
    });
    return {
      hour: `${String(start.getUTCHours()).padStart(2, '0')}:00`,
      landed: inSlot.filter((row) => row.event === 'visitor_landed').length,
      converted: inSlot.filter((row) => row.event === 'conversion_success').length,
    };
  });

  const topFailure = failureCounts[0];
  const recent = all.slice(0, 40);

  return (
    <main className="min-h-dvh bg-zinc-950">
      <div className="mx-auto max-w-[110rem] px-6 py-8 xl:px-10">
        <header className="border-b border-zinc-800 pb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h1 className="text-lg font-bold tracking-tight text-white">Analytics console</h1>
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

        {/* Hourly activity ---------------------------------------------------- */}
        <div className="mt-3">
          <Panel
            title="Hourly activity"
            right={
              <span className="font-mono text-[0.6875rem] text-zinc-200">last 24h · UTC</span>
            }
          >
            <HourlyGrid buckets={buckets} />
          </Panel>
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
              <FunnelChart stages={stages} />
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
                      <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-200">
                        Time
                      </th>
                      <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-200">
                        Event
                      </th>
                      <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-200">
                        Country
                      </th>
                      <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-200">
                        Client engine
                      </th>
                      <th className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-200">
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
                        <td className="py-1.5 pr-3 font-mono text-xs text-zinc-100">
                          {row.country ?? '—'}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-[0.6875rem] text-zinc-200">
                          {row.browser ? `${row.browser} · ${row.os ?? '—'}` : '—'}
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
