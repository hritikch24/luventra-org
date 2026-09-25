'use client';

import { Sparkle } from 'lucide-react';
import { PANEL, PANEL_HEADER, CONFIG_LABEL } from './surface';
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
    <section className={`shrink-0 ${PANEL}`}>
      <header className={PANEL_HEADER}>
        <h3 className={CONFIG_LABEL}>
          Mapping rules
        </h3>
        <div className="flex items-center gap-1">
          {required.map(([label, satisfied]) => (
            <span
              key={label}
              title={satisfied ? `${label} mapped` : `${label} not mapped`}
              className={`font-mono text-[0.625rem] px-1.5 py-0.5 transition-colors duration-150 ${
                satisfied
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : 'bg-red-500/10 text-red-600'
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      </header>

      <ul className="divide-y divide-zinc-200">
        {columns.map((column) => {
          const assigned = column.role !== 'ignored';
          return (
            <li
              key={column.index}
              className="group grid grid-cols-[1fr_7.5rem] items-center gap-2 px-3 py-1.5 transition-colors duration-150 hover:bg-zinc-100"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span
                    className="truncate font-mono text-xs text-zinc-700"
                    title={column.header || `column ${column.index + 1}`}
                  >
                    {column.header || (
                      <span className="text-zinc-500">col{column.index + 1}</span>
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
                  className="block truncate font-mono text-[0.625rem] text-zinc-500"
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
                    ? 'border-zinc-300 bg-zinc-200 text-zinc-900'
                    : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300'
                }`}
              >
                {ASSIGNABLE_ROLES.map((role) => (
                  <option key={role} value={role} className="bg-white">
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>

      <footer className="flex items-center justify-between border-t border-zinc-200 px-3 py-1.5">
        <span className={CONFIG_LABEL}>convention</span>
        <span className="font-mono text-[0.625rem] text-zinc-500">{convention}</span>
      </footer>
    </section>
  );
}
