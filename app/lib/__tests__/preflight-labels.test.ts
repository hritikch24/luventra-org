import { describe, it, expect } from 'vitest';
import { issuesToChecks } from '@/app/lib/preflight';
import type { ParseIssue } from '@/app/worker/types';

const issue = (code: string, level: ParseIssue['level'], message = 'detail'): ParseIssue =>
  ({ code, level, message }) as ParseIssue;

describe('issuesToChecks labelling', () => {
  it('renders a human label instead of the raw code', () => {
    const check = issuesToChecks([issue('no-date-column', 'error')])[0];
    expect(check?.label).toBe('No date column found');
    expect(check?.status).toBe('fail');
  });

  it('maps warning and info levels onto the indicator statuses', () => {
    expect(issuesToChecks([issue('ragged-rows', 'warning')])[0]?.status).toBe('warn');
    expect(issuesToChecks([issue('skipped-unsettled', 'info')])[0]?.status).toBe('pass');
  });

  it('falls back to a readable form for a code it does not know', () => {
    const check = issuesToChecks([issue('some-future-code', 'warning')])[0];
    expect(check?.label).toBe('Some future code');
    expect(check?.label).not.toContain('-');
  });

  it('collapses per-row codes into one entry carrying the count', () => {
    const checks = issuesToChecks([
      issue('bad-amount', 'warning', 'row 2 has no amount'),
      issue('bad-amount', 'warning', 'row 9 has no amount'),
      issue('bad-amount', 'warning', 'row 14 has no amount'),
    ]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.label).toBe('Row skipped: no amount (3 rows)');
    expect(checks[0]?.detail).toContain('3 rows were skipped');
    expect(checks[0]?.detail).toContain('row 2 has no amount');
  });

  it('does not pluralise a single per-row issue', () => {
    // Bank of America raises exactly one of these on every file.
    const checks = issuesToChecks([issue('bad-amount', 'warning', 'Beginning balance row')]);
    expect(checks[0]?.label).toBe('Row skipped: no amount');
    expect(checks[0]?.detail).toBe('Beginning balance row');
  });

  it('keeps file-level issues ungrouped and preserves their order', () => {
    const checks = issuesToChecks([
      issue('no-header', 'warning'),
      issue('encoding-fallback', 'warning'),
    ]);
    expect(checks.map((c) => c.label)).toEqual([
      'No header row: columns guessed from content',
      'Text encoding guessed',
    ]);
  });

  it('gives every check a unique id even when codes repeat', () => {
    const checks = issuesToChecks([
      issue('ragged-rows', 'warning'),
      issue('ragged-rows', 'warning'),
      issue('bad-date', 'warning'),
      issue('bad-date', 'warning'),
    ]);
    expect(new Set(checks.map((c) => c.id)).size).toBe(checks.length);
  });
});
