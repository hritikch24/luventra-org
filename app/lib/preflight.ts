/**
 * Pre-flight checks, expressed as a fixed list of named gates so the sidebar
 * can show a stable row of indicators rather than a shifting pile of messages.
 *
 * Every check is computed from the file that was actually dropped. Where a
 * check cannot be decided at preview time — an ambiguous decimal separator, a
 * day/month order that needs the worker's full inference — it reports
 * `skip` ("not verified") instead of inventing a pass or a failure.
 */

import type { DetectedColumn, ParseIssue } from '@/app/worker/types';
import { cellAt, columnIndexFor, dateColumnIndex, ROLE_LABELS, type CsvPreview } from './preview';
import { readNumber, readUnambiguous, round2 } from './numeric';
import { inferOrder, looksLikeDate, toOrdinal } from './dates';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface PreflightCheck {
  readonly id: string;
  /** Short label for the indicator row. */
  readonly label: string;
  readonly status: CheckStatus;
  /** One plain-English sentence. */
  readonly detail: string;
}

export interface PreflightReport {
  readonly checks: readonly PreflightCheck[];
  /** True when nothing is at `fail`, i.e. the export gate is open. */
  readonly ready: boolean;
  readonly failures: number;
  readonly warnings: number;
}

const MAX_LISTED = 3;

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** Data row 0 is line 2 of the file, after the header. */
function lines(rows: readonly number[]): string {
  const shown = rows.slice(0, MAX_LISTED).map((row) => `line ${row + 2}`);
  const rest = rows.length - shown.length;
  if (rest > 0) shown.push(`+${rest} more`);
  return shown.join(', ');
}

export interface PreflightInput {
  /** The sample the worker returned, not necessarily the whole file. */
  readonly preview: CsvPreview;
  readonly columns: readonly DetectedColumn[];
  /** Total data rows in the file, from the inferred schema. */
  readonly totalRows: number;
  /** File-level findings from the worker, folded in so the gate sees them. */
  readonly workerIssues: readonly ParseIssue[];
}

export function runPreflight({
  preview,
  columns,
  totalRows,
  workerIssues,
}: PreflightInput): PreflightReport {
  const checks: PreflightCheck[] = [];
  const { rows } = preview;

  const dateIndex = dateColumnIndex(columns);
  const descIndex = columnIndexFor(columns, 'description');
  const amountIndex = columnIndexFor(columns, 'amount');
  const debitIndex = columnIndexFor(columns, 'debit');
  const creditIndex = columnIndexFor(columns, 'credit');
  const balanceIndex = columnIndexFor(columns, 'balance');
  const refIndex = columnIndexFor(columns, 'referenceNumber');

  const hasPair = debitIndex !== -1 && creditIndex !== -1;
  const hasAmount = amountIndex !== -1 || hasPair;

  /* -- 1. required mapping ---------------------------------------------- */

  const missing: string[] = [];
  if (dateIndex === -1) missing.push(`${ROLE_LABELS.date} (or ${ROLE_LABELS.postedDate})`);
  if (descIndex === -1) missing.push(ROLE_LABELS.description);
  if (!hasAmount) missing.push('Amount (or a Debit/Credit pair)');

  checks.push({
    id: 'mapping',
    label: 'Required fields mapped',
    status: missing.length === 0 ? 'pass' : 'fail',
    detail:
      missing.length === 0
        ? hasPair && amountIndex === -1
          ? 'Date, Description and a Debit/Credit pair are mapped.'
          : 'Date, Description and Amount are all mapped.'
        : `Still unmapped: ${missing.join(', ')}.`,
  });

  /* -- 3. dates ---------------------------------------------------------- */

  const dateValues = dateIndex === -1 ? [] : rows.map((row) => cellAt(row, dateIndex));
  const order = inferOrder(dateValues);
  const badDates = dateValues.flatMap((value, index) => (looksLikeDate(value) ? [] : [index]));

  checks.push({
    id: 'date-parse',
    label: 'Dates readable',
    status:
      dateIndex === -1
        ? 'skip'
        : badDates.length === 0
          ? 'pass'
          : badDates.length === rows.length
            ? 'fail'
            : 'warn',
    detail:
      dateIndex === -1
        ? 'No Date or Posted date column mapped yet.'
        : badDates.length === 0
          ? order === 'AMBIGUOUS'
            ? 'Every value is a date, but day/month order is ambiguous — the worker settles it.'
            : `Every value parses as a date (${order === 'UNKNOWN' ? 'mixed order' : order} format).`
          : `${plural(badDates.length, 'value does', 'values do')} not look like a date (${lines(badDates)}).`,
  });

  /* -- 4. date sequence -------------------------------------------------- */

  const ordinals =
    order === 'AMBIGUOUS' || order === 'UNKNOWN'
      ? []
      : dateValues.map((value) => toOrdinal(value, order));
  const outOfOrder: number[] = [];
  if (ordinals.length > 0) {
    let ascending = 0;
    let descending = 0;
    for (let i = 1; i < ordinals.length; i += 1) {
      const previous = ordinals[i - 1];
      const current = ordinals[i];
      if (previous == null || current == null) continue;
      if (current > previous) ascending += 1;
      else if (current < previous) descending += 1;
    }
    // Statements come either oldest-first or newest-first; judge against
    // whichever direction dominates, so a descending file is not "corrupt".
    const wantAscending = ascending >= descending;
    for (let i = 1; i < ordinals.length; i += 1) {
      const previous = ordinals[i - 1];
      const current = ordinals[i];
      if (previous == null || current == null) continue;
      if (wantAscending ? current < previous : current > previous) outOfOrder.push(i);
    }
  }

  checks.push({
    id: 'date-sequence',
    label: 'Date sequence',
    status:
      dateIndex === -1 || ordinals.length === 0 ? 'skip' : outOfOrder.length === 0 ? 'pass' : 'warn',
    detail:
      dateIndex === -1
        ? 'No Date or Posted date column mapped yet.'
        : ordinals.length === 0
          ? 'Day/month order is ambiguous, so ordering was not verified here.'
          : outOfOrder.length === 0
            ? 'Dates run in a consistent direction with no breaks.'
            : `${plural(outOfOrder.length, 'row breaks', 'rows break')} the date order (${lines(outOfOrder)}).`,
  });

  /* -- 5. amounts -------------------------------------------------------- */

  const amountCells = (row: readonly string[]): string =>
    amountIndex !== -1 ? cellAt(row, amountIndex) : '';

  const badAmounts: number[] = [];
  const signedValues: (number | null)[] = [];
  let anyAmbiguous = false;

  rows.forEach((row, index) => {
    if (amountIndex !== -1) {
      const read = readNumber(amountCells(row));
      if (read === null) {
        badAmounts.push(index);
        signedValues.push(null);
      } else {
        if (read.ambiguous) anyAmbiguous = true;
        signedValues.push(read.value);
      }
      return;
    }
    if (hasPair) {
      const debit = readNumber(cellAt(row, debitIndex));
      const credit = readNumber(cellAt(row, creditIndex));
      if (debit === null && credit === null) {
        // Both blank is a legitimate no-op row in some exports, but an
        // unreadable pair is not usable.
        const rawDebit = cellAt(row, debitIndex);
        const rawCredit = cellAt(row, creditIndex);
        if (rawDebit !== '' || rawCredit !== '') badAmounts.push(index);
        signedValues.push(null);
      } else {
        if (debit?.ambiguous || credit?.ambiguous) anyAmbiguous = true;
        signedValues.push((credit?.value ?? 0) - Math.abs(debit?.value ?? 0));
      }
      return;
    }
    signedValues.push(null);
  });

  checks.push({
    id: 'amount-parse',
    label: 'Amounts numeric',
    status: !hasAmount
      ? 'skip'
      : badAmounts.length === 0
        ? anyAmbiguous
          ? 'warn'
          : 'pass'
        : badAmounts.length === rows.length
          ? 'fail'
          : 'warn',
    detail: !hasAmount
      ? 'No Amount or Debit/Credit pair mapped yet.'
      : badAmounts.length > 0
        ? `${plural(badAmounts.length, 'row has', 'rows have')} an amount that is not a number (${lines(badAmounts)}).`
        : anyAmbiguous
          ? 'All amounts are numeric, but a separator like "1,234" could be thousands or decimals.'
          : `All ${plural(rows.length, 'amount reads', 'amounts read')} cleanly.`,
  });

  /* -- 6. debit/credit hygiene ------------------------------------------- */

  if (hasPair) {
    const bothFilled: number[] = [];
    rows.forEach((row, index) => {
      const debit = cellAt(row, debitIndex);
      const credit = cellAt(row, creditIndex);
      if (debit !== '' && credit !== '' && readNumber(debit) && readNumber(credit)) {
        bothFilled.push(index);
      }
    });
    checks.push({
      id: 'debit-credit',
      label: 'Debit/Credit pairing',
      status: bothFilled.length === 0 ? 'pass' : 'warn',
      detail:
        bothFilled.length === 0
          ? 'Each row uses either the debit or the credit column, never both.'
          : `${plural(bothFilled.length, 'row fills', 'rows fill')} both debit and credit (${lines(bothFilled)}).`,
    });
  }

  /* -- 7. balance continuity -------------------------------------------- */

  if (balanceIndex !== -1 && hasAmount) {
    const balances = rows.map((row) => readUnambiguous(cellAt(row, balanceIndex)));
    const usable = balances.every((value) => value !== null) && !anyAmbiguous;
    const breaks: number[] = [];

    if (usable) {
      for (let i = 1; i < rows.length; i += 1) {
        const previous = balances[i - 1];
        const current = balances[i];
        const delta = signedValues[i];
        if (previous == null || current == null || delta == null) continue;
        if (round2(current - previous) !== round2(delta)) breaks.push(i);
      }
    }

    checks.push({
      id: 'balance-continuity',
      label: 'Balance continuity',
      status: !usable ? 'skip' : breaks.length === 0 ? 'pass' : 'warn',
      detail: !usable
        ? 'Balance column could not be read unambiguously, so continuity was not verified.'
        : breaks.length === 0
          ? 'Every running balance matches the previous balance plus the row amount.'
          : `${plural(breaks.length, 'row does', 'rows do')} not reconcile with the running balance (${lines(breaks)}).`,
    });
  }

  /* -- 8. duplicate transactions ---------------------------------------- */

  const seen = new Map<string, number[]>();
  if (dateIndex !== -1 && hasAmount) {
    rows.forEach((row, index) => {
      const key = `${cellAt(row, dateIndex)}|${cellAt(row, descIndex).toLowerCase()}|${signedValues[index] ?? ''}`;
      const bucket = seen.get(key);
      if (bucket) bucket.push(index);
      else seen.set(key, [index]);
    });
  }
  const duplicateGroups = [...seen.values()].filter((bucket) => bucket.length > 1);
  const duplicateRows = duplicateGroups.reduce((total, bucket) => total + bucket.length, 0);

  checks.push({
    id: 'duplicates',
    label: 'Unique transactions',
    status: dateIndex === -1 || !hasAmount ? 'skip' : duplicateGroups.length === 0 ? 'pass' : 'warn',
    detail:
      dateIndex === -1 || !hasAmount
        ? 'Needs Date and Amount mapped before duplicates can be found.'
        : duplicateGroups.length === 0
          ? 'No two rows share a date, description and amount.'
          : `${plural(duplicateRows, 'row repeats', 'rows repeat')} another row exactly (${plural(duplicateGroups.length, 'group', 'groups')}). Banks do sometimes bill twice — review before removing.`,
  });

  /* -- 9. reference uniqueness ------------------------------------------ */

  if (refIndex !== -1) {
    const refs = new Map<string, number>();
    let repeats = 0;
    let blanks = 0;
    rows.forEach((row) => {
      const value = cellAt(row, refIndex);
      if (value === '') {
        blanks += 1;
        return;
      }
      const count = refs.get(value) ?? 0;
      if (count > 0) repeats += 1;
      refs.set(value, count + 1);
    });

    checks.push({
      id: 'reference-unique',
      label: 'Reference IDs unique',
      status: repeats > 0 ? 'warn' : blanks > 0 ? 'warn' : 'pass',
      detail:
        repeats > 0
          ? `${plural(repeats, 'reference is', 'references are')} reused. Duplicate IDs collide when the transaction id is derived.`
          : blanks > 0
            ? `${plural(blanks, 'row has', 'rows have')} no reference; an id will be derived from the row contents instead.`
            : 'Every row carries a distinct reference id.',
    });
  }

  /* -- 10. descriptions -------------------------------------------------- */

  const blankDescriptions =
    descIndex === -1
      ? []
      : rows.flatMap((row, index) => (cellAt(row, descIndex) === '' ? [index] : []));

  checks.push({
    id: 'descriptions',
    label: 'Descriptions present',
    status: descIndex === -1 ? 'skip' : blankDescriptions.length === 0 ? 'pass' : 'warn',
    detail:
      descIndex === -1
        ? 'No Description column mapped yet.'
        : blankDescriptions.length === 0
          ? 'Every row has a description to carry into the NAME field.'
          : `${plural(blankDescriptions.length, 'row is', 'rows are')} missing a description (${lines(blankDescriptions)}); a placeholder is used.`,
  });

  /* -- 11. file has content --------------------------------------------- */

  if (totalRows === 0) {
    checks.unshift({
      id: 'empty',
      label: 'File has rows',
      status: 'fail',
      detail: 'The file has a header but no transaction rows underneath it.',
    });
  }

  /* -- 12. what the checks above actually covered ------------------------ */

  // The worker returns a bounded sample, so the row-scoped checks above speak
  // for that sample only. Saying so beats implying whole-file certainty.
  const sampled = rows.length < totalRows;
  checks.unshift({
    id: 'coverage',
    label: 'Checked rows',
    status: sampled ? 'skip' : 'pass',
    detail: sampled
      ? `Checks above cover the first ${rows.length.toLocaleString()} of ${totalRows.toLocaleString()} rows. The remainder is verified during conversion.`
      : `Checks above cover all ${plural(totalRows, 'row', 'rows')} in the file.`,
  });

  /* -- 13. anything the engine itself reported --------------------------- */

  // Worker findings are whole-file and authoritative, so they gate the export
  // alongside the local checks rather than being displayed separately.
  const combined = [...checks, ...issuesToChecks(workerIssues)];

  const failures = combined.filter((check) => check.status === 'fail').length;
  const warnings = combined.filter((check) => check.status === 'warn').length;

  return { checks: combined, ready: failures === 0 && totalRows > 0, failures, warnings };
}

/**
 * Fold worker-reported issues into the same shape, so `ParseIssue`s coming back
 * over the wire render through the identical indicator list.
 */
export function issuesToChecks(issues: readonly ParseIssue[]): readonly PreflightCheck[] {
  return issues.map((issue, index) => ({
    id: `worker-${issue.code}-${index}`,
    label: issue.code,
    status: issue.level === 'error' ? 'fail' : issue.level === 'warning' ? 'warn' : 'pass',
    detail: issue.message,
  }));
}
