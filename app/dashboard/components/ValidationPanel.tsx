'use client';

import { Check, Loader2, Minus, TriangleAlert, X } from 'lucide-react';
import type { CheckStatus, PreflightReport } from '@/app/lib/preflight';
import type { OfxDialect } from '@/app/worker/types';
import { PANEL, PANEL_HEADER, CONFIG_LABEL } from './surface';

const STATUS: Readonly<
  Record<CheckStatus, { icon: typeof Check; tone: string; dot: string; sr: string }>
> = {
  pass: {
    icon: Check,
    tone: 'text-emerald-600',
    dot: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]',
    sr: 'passed',
  },
  warn: {
    icon: TriangleAlert,
    tone: 'text-amber-600',
    dot: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]',
    sr: 'warning',
  },
  fail: {
    icon: X,
    tone: 'text-red-600',
    dot: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.45)]',
    sr: 'failed',
  },
  // Unchecked stays matte: a glow here would read as a result.
  skip: { icon: Minus, tone: 'text-zinc-500', dot: 'bg-zinc-300', sr: 'not checked' },
};

const DIALECTS: readonly OfxDialect[] = ['ofx', 'qbo', 'qfx'];

export type ExportState = 'idle' | 'working' | 'done' | 'error';

interface ValidationPanelProps {
  readonly report: PreflightReport | null;
  readonly dialect: OfxDialect;
  readonly onDialectChange: (dialect: OfxDialect) => void;
  readonly accountId: string;
  readonly onAccountIdChange: (accountId: string) => void;
  readonly exportState: ExportState;
  readonly exportMessage: string | null;
  readonly onExport: () => void;
}

export function ValidationPanel({
  report,
  dialect,
  onDialectChange,
  accountId,
  onAccountIdChange,
  exportState,
  exportMessage,
  onExport,
}: ValidationPanelProps) {
  const working = exportState === 'working';
  const gateOpen = report !== null && report.ready && !working;

  return (
    <div data-tour="validation" className="flex flex-col gap-3 lg:min-h-0">
      {/*
        The export control sits above the checks, not below them.

        With pre-flight first, a seven-row check list pushed Generate to the
        bottom of a tall column: on a 809px viewport it measured at y=776, the
        last 33 pixels, and below the fold on any shorter laptop. A visitor
        uploaded, saw a column of green ticks telling them the file was good,
        and never saw the control that produces the download. Putting the
        action first makes that structural rather than dependent on scroll
        position, which is what an earlier attempt using scrollIntoView tried
        and failed to guarantee.
      */}
      <section data-tour="export" className={`shrink-0 p-3 ${PANEL}`}>
        <label htmlFor="acctid" className={`mb-1 block ${CONFIG_LABEL}`}>
          Account ID
        </label>
        <input
          id="acctid"
          value={accountId}
          onChange={(event) => onAccountIdChange(event.target.value)}
          placeholder="from filename"
          spellCheck={false}
          className="mb-2 w-full border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[0.6875rem] text-zinc-900 placeholder:text-zinc-400 transition-colors duration-150 hover:border-zinc-300 focus:border-accent focus:outline-none"
        />

        <div
          className="mb-2 grid grid-cols-3 gap-px border border-zinc-200 bg-zinc-200"
          role="radiogroup"
          aria-label="Output format"
        >
          {DIALECTS.map((option) => {
            const active = option === dialect;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onDialectChange(option)}
                // Selected reads as white on the vivid accent rather than as
                // one grey on another, so the target format is unmistakable
                // before the user commits to Generate.
                className={`py-1 font-mono text-[0.6875rem] font-semibold uppercase transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                  active
                    ? 'bg-zinc-900 text-white'
                    : 'bg-white text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onExport}
          disabled={!gateOpen}
          // Solid white on the matte canvas: the one element in the workspace with
          // no transparency and no border, so it reads as the single committed
          // action. The emerald halo is spent only on hover — at rest the block
          // is flush and silent. Disabled keeps the standard dim treatment.
          className="flex w-full items-center justify-center gap-2 bg-zinc-900 px-3 py-2 text-xs font-semibold tracking-tight text-white transition-[colors,box-shadow] duration-150 hover:bg-zinc-800 hover:shadow-[0_0_15px_rgba(16,185,129,0.5)] active:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        >
          {working ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Generating…
            </>
          ) : (
            `Generate ${dialect.toUpperCase()}`
          )}
        </button>

        {exportMessage ? (
          <p
            role={exportState === 'error' ? 'alert' : undefined}
            className={`mt-2 text-[0.6875rem] leading-relaxed ${
              exportState === 'error'
                ? 'text-red-600'
                : exportState === 'done'
                  ? 'text-emerald-600'
                  : 'text-zinc-500'
            }`}
          >
            {exportMessage}
          </p>
        ) : report !== null && !report.ready ? (
          <p className="mt-2 text-[0.6875rem] leading-relaxed text-zinc-500">
            Export is gated until every failing check below is cleared.
          </p>
        ) : null}
      </section>
      <section className={`flex flex-col lg:min-h-0 ${PANEL}`}>
        <header className={PANEL_HEADER}>
          <h3 className={CONFIG_LABEL}>
            Pre-flight
          </h3>
          {report ? (
            <span className="font-mono text-[0.625rem] tnum">
              <span className={report.failures > 0 ? 'text-red-600' : 'text-zinc-500'}>
                {report.failures} fail
              </span>
              <span className="text-zinc-500"> / </span>
              <span className={report.warnings > 0 ? 'text-amber-600' : 'text-zinc-500'}>
                {report.warnings} warn
              </span>
            </span>
          ) : null}
        </header>

        <div className="scroll-thin lg:min-h-0 lg:flex-1 lg:overflow-y-auto" aria-live="polite">
          {report === null ? (
            <p className="px-3 py-8 text-center font-mono text-xs text-zinc-500">
              awaiting file
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200">
              {report.checks.map((check) => {
                const style = STATUS[check.status];
                const Icon = style.icon;
                return (
                  <li
                    key={check.id}
                    className="px-3 py-2 transition-colors duration-150 hover:bg-zinc-100"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${style.dot}`}
                        aria-hidden
                      />
                      <Icon className={`size-3 shrink-0 ${style.tone}`} aria-hidden />
                      <span className="text-xs font-medium text-zinc-700">{check.label}</span>
                      <span className="sr-only">{style.sr}</span>
                    </div>
                    <p className="mt-1 pl-[1.875rem] text-[0.6875rem] leading-relaxed text-zinc-500">
                      {check.detail}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

    </div>
  );
}
