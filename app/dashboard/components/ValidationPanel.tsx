'use client';

import { Check, Loader2, Minus, TriangleAlert, X } from 'lucide-react';
import type { CheckStatus, PreflightReport } from '@/app/lib/preflight';
import type { OfxDialect } from '@/app/worker/types';

const STATUS: Readonly<
  Record<CheckStatus, { icon: typeof Check; tone: string; dot: string; sr: string }>
> = {
  pass: { icon: Check, tone: 'text-emerald-400', dot: 'bg-emerald-400', sr: 'passed' },
  warn: { icon: TriangleAlert, tone: 'text-amber-400', dot: 'bg-amber-400', sr: 'warning' },
  fail: { icon: X, tone: 'text-red-400', dot: 'bg-red-400', sr: 'failed' },
  skip: { icon: Minus, tone: 'text-zinc-600', dot: 'bg-zinc-700', sr: 'not checked' },
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
    <div className="flex flex-col gap-3 lg:min-h-0">
      <section className="flex flex-col border border-zinc-800/60 bg-zinc-900 lg:min-h-0">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800/60 px-3 py-2">
          <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider text-zinc-400">
            Pre-flight
          </h2>
          {report ? (
            <span className="font-mono text-[0.625rem] tnum">
              <span className={report.failures > 0 ? 'text-red-400' : 'text-zinc-600'}>
                {report.failures} fail
              </span>
              <span className="text-zinc-700"> / </span>
              <span className={report.warnings > 0 ? 'text-amber-400' : 'text-zinc-600'}>
                {report.warnings} warn
              </span>
            </span>
          ) : null}
        </header>

        <div className="scroll-thin lg:min-h-0 lg:flex-1 lg:overflow-y-auto" aria-live="polite">
          {report === null ? (
            <p className="px-3 py-8 text-center font-mono text-xs text-zinc-700">
              awaiting file
            </p>
          ) : (
            <ul className="divide-y divide-zinc-800/40">
              {report.checks.map((check) => {
                const style = STATUS[check.status];
                const Icon = style.icon;
                return (
                  <li
                    key={check.id}
                    className="px-3 py-2 transition-colors duration-150 hover:bg-zinc-800/30"
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon className={`size-3 shrink-0 ${style.tone}`} aria-hidden />
                      <span className="text-xs font-medium text-zinc-200">{check.label}</span>
                      <span className="sr-only">{style.sr}</span>
                    </div>
                    <p className="mt-1 pl-[1.125rem] text-[0.6875rem] leading-relaxed text-zinc-500">
                      {check.detail}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="shrink-0 border border-zinc-800/60 bg-zinc-900 p-3">
        <label htmlFor="acctid" className="mb-1 block text-[0.625rem] uppercase tracking-wider text-zinc-600">
          Account ID
        </label>
        <input
          id="acctid"
          value={accountId}
          onChange={(event) => onAccountIdChange(event.target.value)}
          placeholder="from filename"
          spellCheck={false}
          className="mb-2 w-full border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[0.6875rem] text-zinc-100 placeholder:text-zinc-700 transition-colors duration-150 hover:border-zinc-700 focus:border-accent focus:outline-none"
        />

        <div
          className="mb-2 grid grid-cols-3 gap-px border border-zinc-800 bg-zinc-800"
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
                className={`py-1 font-mono text-[0.6875rem] uppercase transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                  active
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'bg-zinc-900 text-zinc-600 hover:text-zinc-300'
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
          className="flex w-full items-center justify-center gap-2 bg-accent px-3 py-2 text-xs font-medium text-white transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
                ? 'text-red-400'
                : exportState === 'done'
                  ? 'text-emerald-400'
                  : 'text-zinc-500'
            }`}
          >
            {exportMessage}
          </p>
        ) : report !== null && !report.ready ? (
          <p className="mt-2 text-[0.6875rem] leading-relaxed text-zinc-600">
            Export is gated until every failing check above is cleared.
          </p>
        ) : null}
      </section>
    </div>
  );
}
