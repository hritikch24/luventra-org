'use client';

import type { ColumnRole, DetectedColumn } from '@/app/worker/types';
import {
  PREVIEW_ROW_LIMIT,
  cellAt,
  columnIndexFor,
  dateColumnIndex,
  type CsvPreview,
} from '@/app/lib/preview';
import { readNumber } from '@/app/lib/numeric';

interface PreviewGridProps {
  readonly preview: CsvPreview;
  readonly columns: readonly DetectedColumn[];
}

interface Field {
  readonly key: string;
  readonly label: string;
  readonly numeric: boolean;
  /** Column width hint; the grid is fixed-layout for a stable matrix. */
  readonly width: string;
}

/**
 * The preview is a canonical view, not a raw dump: a debit/credit pair
 * collapses into one signed Amount so the user sees what will actually be
 * written, which is the whole point of previewing before conversion.
 */
export function PreviewGrid({ preview, columns }: PreviewGridProps) {
  const dateIndex = dateColumnIndex(columns);
  const descIndex = columnIndexFor(columns, 'description');
  const amountIndex = columnIndexFor(columns, 'amount');
  const debitIndex = columnIndexFor(columns, 'debit');
  const creditIndex = columnIndexFor(columns, 'credit');
  const balanceIndex = columnIndexFor(columns, 'balance');
  const refIndex = columnIndexFor(columns, 'referenceNumber');
  const hasPair = debitIndex !== -1 && creditIndex !== -1;

  const fields: Field[] = [
    { key: 'date', label: 'Date', numeric: false, width: 'w-[7.5rem]' },
    { key: 'description', label: 'Description', numeric: false, width: 'w-auto' },
  ];
  if (refIndex !== -1) {
    fields.push({ key: 'ref', label: 'Ref', numeric: false, width: 'w-[7rem]' });
  }
  fields.push({ key: 'amount', label: 'Amount', numeric: true, width: 'w-[8rem]' });
  if (balanceIndex !== -1) {
    fields.push({ key: 'balance', label: 'Balance', numeric: true, width: 'w-[8rem]' });
  }

  const rows = preview.rows.slice(0, PREVIEW_ROW_LIMIT);
  const remaining = Math.max(0, preview.rows.length - rows.length);

  /** Signed amount for one row, honouring the debit/credit convention. */
  function amountOf(row: readonly string[]): { text: string; value: number | null } {
    if (amountIndex !== -1) {
      const raw = cellAt(row, amountIndex);
      return { text: raw, value: readNumber(raw)?.value ?? null };
    }
    if (hasPair) {
      const debit = readNumber(cellAt(row, debitIndex));
      const credit = readNumber(cellAt(row, creditIndex));
      if (debit === null && credit === null) return { text: '', value: null };
      const value = (credit?.value ?? 0) - Math.abs(debit?.value ?? 0);
      return { text: value.toFixed(2), value };
    }
    return { text: '', value: null };
  }

  function unmapped(role: ColumnRole): boolean {
    if (role === 'date') return dateIndex === -1;
    if (role === 'description') return descIndex === -1;
    return amountIndex === -1 && !hasPair;
  }

  return (
    <section className="flex flex-col border border-zinc-800/60 bg-zinc-900 lg:min-h-0">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800/60 px-3 py-2">
        <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider text-zinc-400">
          Live preview
        </h2>
        <span className="font-mono text-[0.625rem] text-zinc-400 tnum">
          {rows.length} of {preview.rows.length.toLocaleString()} rows
          {remaining > 0 ? ` · +${remaining.toLocaleString()}` : ''}
        </span>
      </header>

      <div className="scroll-thin overflow-x-auto lg:min-h-0 lg:flex-1 lg:overflow-auto">
        <table className="w-full table-fixed border-collapse">
          <thead className="sticky top-0 z-10 bg-zinc-900">
            <tr className="border-b border-zinc-800/60">
              <th scope="col" className="w-9 px-2 py-1.5 text-right text-[0.625rem] font-medium uppercase tracking-wider text-zinc-400">
                #
              </th>
              {fields.map((field) => (
                <th
                  key={field.key}
                  scope="col"
                  className={`${field.width} px-2 py-1.5 text-[0.625rem] font-medium uppercase tracking-wider text-zinc-400 ${
                    field.numeric ? 'text-right' : 'text-left'
                  }`}
                >
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={fields.length + 1}
                  className="px-3 py-12 text-center font-mono text-xs text-zinc-400"
                >
                  no rows
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => {
                const amount = amountOf(row);
                const date = cellAt(row, dateIndex);
                const description = cellAt(row, descIndex);
                const reference = cellAt(row, refIndex);
                const balance = cellAt(row, balanceIndex);

                return (
                  <tr
                    key={rowIndex}
                    className="border-b border-zinc-800/40 transition-colors duration-150 last:border-b-0 hover:bg-zinc-800/30"
                  >
                    <td className="px-2 py-1.5 text-right font-mono text-[0.625rem] text-zinc-400 tnum">
                      {rowIndex + 1}
                    </td>

                    <td className="truncate px-2 py-1.5 font-mono text-xs text-zinc-300 tnum" title={date}>
                      {unmapped('date') ? (
                        <span className="text-zinc-400">—</span>
                      ) : date === '' ? (
                        <span className="text-amber-500/70">empty</span>
                      ) : (
                        date
                      )}
                    </td>

                    <td className="truncate px-2 py-1.5 font-mono text-xs text-zinc-100" title={description}>
                      {unmapped('description') ? (
                        <span className="text-zinc-400">—</span>
                      ) : description === '' ? (
                        <span className="text-amber-500/70">empty</span>
                      ) : (
                        description
                      )}
                    </td>

                    {refIndex !== -1 ? (
                      <td className="truncate px-2 py-1.5 font-mono text-[0.6875rem] text-zinc-400" title={reference}>
                        {reference === '' ? <span className="text-zinc-400">—</span> : reference}
                      </td>
                    ) : null}

                    <td
                      className={`px-2 py-1.5 text-right font-mono text-xs tnum ${
                        amount.value === null
                          ? 'text-zinc-400'
                          : amount.value < 0
                            ? 'text-red-400'
                            : 'text-emerald-400'
                      }`}
                      title={amount.text}
                    >
                      {unmapped('amount') ? (
                        <span className="text-zinc-400">—</span>
                      ) : amount.value === null ? (
                        <span className="text-amber-500/70">{amount.text || 'empty'}</span>
                      ) : (
                        amount.text
                      )}
                    </td>

                    {balanceIndex !== -1 ? (
                      <td className="px-2 py-1.5 text-right font-mono text-xs text-zinc-400 tnum" title={balance}>
                        {balance === '' ? <span className="text-zinc-400">—</span> : balance}
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-zinc-800/60 px-3 py-1.5">
        <span className="font-mono text-[0.625rem] text-zinc-400">
          {fields.map((field) => field.label.toLowerCase()).join(' · ')}
        </span>
        <span className="font-mono text-[0.625rem] text-zinc-400">
          {hasPair ? 'debit/credit → signed' : amountIndex !== -1 ? 'signed amount' : 'no amount'}
        </span>
      </footer>
    </section>
  );
}
