/**
 * Shared vocabulary for the mapping UI.
 *
 * Parsing itself belongs to the worker: encoding sniffing, delimiter and date
 * inference and the canonical transaction build all happen there. What is left
 * here is the presentation layer's view of a parsed file plus the role labels
 * the mapping selectors offer.
 */

import type { ColumnRole, DetectedColumn } from '@/app/worker/types';

/** Rows shown in the live preview grid. */
export const PREVIEW_ROW_LIMIT = 5;

export interface CsvPreview {
  readonly fileName: string;
  readonly byteSize: number;
  /** Delimiter the worker settled on, for display only. */
  readonly delimiter: string;
  /** Header text per column index, taken from the inferred schema. */
  readonly headers: readonly string[];
  /** The worker's sample rows, header and preamble already removed. */
  readonly rows: readonly (readonly string[])[];
}

/** Roles the user picks between in the mapping table, in menu order. */
export const ASSIGNABLE_ROLES: readonly ColumnRole[] = [
  'ignored',
  'date',
  'description',
  'amount',
  'debit',
  'credit',
  'postedDate',
  'payee',
  'memo',
  'balance',
  'checkNumber',
  'referenceNumber',
  'currency',
  'category',
  'type',
];

export const ROLE_LABELS: Readonly<Record<ColumnRole, string>> = {
  ignored: 'Ignore',
  date: 'Date',
  postedDate: 'Posted date',
  description: 'Description',
  memo: 'Memo',
  payee: 'Payee',
  checkNumber: 'Check number',
  referenceNumber: 'Reference',
  amount: 'Amount',
  debit: 'Debit',
  credit: 'Credit',
  balance: 'Balance',
  currency: 'Currency',
  category: 'Category',
  type: 'Type',
};

/** The three roles a statement cannot be converted without. */
export const REQUIRED_ROLES: readonly ColumnRole[] = ['date', 'description', 'amount'];

/** Index of the column holding `role`, or -1. */
export function columnIndexFor(columns: readonly DetectedColumn[], role: ColumnRole): number {
  return columns.find((column) => column.role === role)?.index ?? -1;
}

/**
 * Index of the column the engine will read as the posting date.
 *
 * `parseTransactions` takes the `date` column and falls back to `postedDate`
 * (parser.ts), so a file mapped only to "Value Date" converts fine. The UI
 * must mirror that or it gates exports the engine would happily accept.
 */
export function dateColumnIndex(columns: readonly DetectedColumn[]): number {
  const primary = columnIndexFor(columns, 'date');
  return primary !== -1 ? primary : columnIndexFor(columns, 'postedDate');
}

/** Cell value at `index`, tolerating short rows. */
export function cellAt(row: readonly string[], index: number): string {
  if (index < 0) return '';
  return (row[index] ?? '').trim();
}
