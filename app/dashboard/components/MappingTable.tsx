'use client';

import { Sparkle } from 'lucide-react';
import type { ColumnRole, DetectedColumn } from '@/app/worker/types';
import {
  ASSIGNABLE_ROLES,
  cellAt,
  columnIndexFor,
  dateColumnIndex,
  ROLE_LABELS,
  type CsvPreview,
} from '@/app/lib/preview';

interface MappingTableProps {
  readonly preview: CsvPreview;
  readonly columns: readonly DetectedColumn[];
  readonly onAssign: (index: number, role: ColumnRole) => void;
}

/** First non-empty value in a column, so the user can map by content. */
function sampleValue(preview: CsvPreview, index: number): string {
  for (const row of preview.rows) {
    const value = cellAt(row, index);
    if (value !== '') return value;
  }
  return '—';
}

export function MappingTable({ preview, columns, onAssign }: MappingTableProps) {
  const debitIndex = columnIndexFor(columns, 'debit');
  const creditIndex = columnIndexFor(columns, 'credit');
  const amountIndex = columnIndexFor(columns, 'amount');
  const hasPair = debitIndex !== -1 && creditIndex !== -1;

  const convention = hasPair
    ? 'debit / credit pair'
    : amountIndex !== -1
      ? 'signed amount'
      : 'unset';

  const required: ReadonlyArray<readonly [string, boolean]> = [
    ['date', dateColumnIndex(columns) !== -1],
    ['desc', columnIndexFor(columns, 'description') !== -1],
    ['amount', amountIndex !== -1 || hasPair],
  ];

  return (
    <section className="shrink-0 border border-zinc-800/60 bg-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2">
        <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider text-zinc-400">
          Mapping rules
        </h2>
        <div className="flex items-center gap-1">
          {required.map(([label, satisfied]) => (
            <span
              key={label}
              title={satisfied ? `${label} mapped` : `${label} not mapped`}
              className={`font-mono text-[0.625rem] px-1.5 py-0.5 transition-colors duration-150 ${
                satisfied
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-red-500/10 text-red-400'
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      </header>

      <ul className="divide-y divide-zinc-800/40">
        {columns.map((column) => {
          const assigned = column.role !== 'ignored';
          return (
            <li
              key={column.index}
              className="group grid grid-cols-[1fr_7.5rem] items-center gap-2 px-3 py-1.5 transition-colors duration-150 hover:bg-zinc-800/30"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span
                    className="truncate font-mono text-xs text-zinc-300"
                    title={column.header || `column ${column.index + 1}`}
                  >
                    {column.header || (
                      <span className="text-zinc-400">col{column.index + 1}</span>
                    )}
                  </span>
                  {!column.userAssigned && column.confidence >= 0.9 && assigned ? (
                    <Sparkle
                      className="size-2.5 shrink-0 text-accent"
                      aria-label="matched automatically"
                    />
                  ) : null}
                </div>
                <span
                  className="block truncate font-mono text-[0.625rem] text-zinc-400"
                  title={sampleValue(preview, column.index)}
                >
                  {sampleValue(preview, column.index)}
                </span>
              </div>

              <label className="sr-only" htmlFor={`role-${column.index}`}>
                Role for {column.header || `column ${column.index + 1}`}
              </label>
              <select
                id={`role-${column.index}`}
                value={column.role}
                onChange={(event) => onAssign(column.index, event.target.value as ColumnRole)}
                className={`w-full border px-1.5 py-1 font-mono text-[0.6875rem] transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                  assigned
                    ? 'border-zinc-700 bg-zinc-800 text-zinc-100'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                {ASSIGNABLE_ROLES.map((role) => (
                  <option key={role} value={role} className="bg-zinc-900">
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>

      <footer className="flex items-center justify-between border-t border-zinc-800/60 px-3 py-1.5">
        <span className="text-[0.625rem] uppercase tracking-wider text-zinc-400">convention</span>
        <span className="font-mono text-[0.625rem] text-zinc-400">{convention}</span>
      </footer>
    </section>
  );
}
