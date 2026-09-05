import { describe, expect, it } from 'vitest';

import { buildOFX, buildQBO, buildQFX, computeFitId, toBytes, withFitIds } from '../emitter';
import { inferSchema, parseTransactions } from '../parser';
import type { CanonicalTransaction } from '../types';
import { ACCOUNT, META, US_CSV, bytes } from './fixtures';

function usTransactions(): readonly CanonicalTransaction[] {
  const input = bytes(US_CSV);
  const { schema } = inferSchema(input, ACCOUNT);
  return parseTransactions(input, schema).transactions;
}

const DATE = { year: 2025, month: 1, day: 3 } as const;

function row(overrides: Partial<CanonicalTransaction> = {}): CanonicalTransaction {
  return {
    sourceRow: 0,
    datePosted: DATE,
    type: 'DEBIT',
    amount: -320n,
    currency: 'USD',
    scale: 2,
    name: 'BLUE BOTTLE',
    ...overrides,
  };
}

describe('OFX 1.x is SGML, not XML', () => {
  const doc = buildOFX(usTransactions(), META);

  it('leaves every leaf element unclosed', () => {
    for (const tag of ['TRNTYPE', 'DTPOSTED', 'TRNAMT', 'FITID', 'NAME', 'BALAMT', 'CODE', 'ACCTID']) {
      expect(doc).toContain(`<${tag}>`);
      expect(doc).not.toContain(`</${tag}>`);
    }
  });

  it('closes every aggregate element', () => {
    // Aggregates are NOT unclosed. The OFX 1.0.2 DTD ends each one explicitly,
    // and QuickBooks needs the close tag to know where a transaction stops.
    for (const tag of [
      'OFX',
      'SIGNONMSGSRSV1',
      'SONRS',
      'STATUS',
      'FI',
      'BANKMSGSRSV1',
      'STMTTRNRS',
      'STMTRS',
      'BANKACCTFROM',
      'BANKTRANLIST',
      'STMTTRN',
      'LEDGERBAL',
    ]) {
      expect(doc).toContain(`<${tag}>`);
      expect(doc).toContain(`</${tag}>`);
    }
  });

  it('balances every aggregate open tag with exactly one close tag', () => {
    const opens = [...doc.matchAll(/<([A-Z][A-Z0-9.]*)>\r\n/g)].map((m) => m[1]!);
    const closes = [...doc.matchAll(/<\/([A-Z][A-Z0-9.]*)>/g)].map((m) => m[1]!);
    expect(opens.slice().sort()).toEqual(closes.slice().sort());
  });

  it('nests aggregates in a well-formed order', () => {
    const stack: string[] = [];
    for (const [, close, open] of doc.matchAll(/<(\/)?([A-Z][A-Z0-9.]*)>\r\n/g)) {
      if (close === undefined) stack.push(open!);
      else expect(stack.pop()).toBe(open!);
    }
    expect(stack).toHaveLength(0);
  });
});

describe('header block', () => {
  const doc = buildOFX(usTransactions(), META);

  it('opens with the QuickBooks Web Connect key/value preamble', () => {
    const header = doc.slice(0, doc.indexOf('\r\n\r\n'));
    expect(header.split('\r\n').map((line) => line.split(':')[0])).toEqual([
      'OFXHEADER',
      'DATA',
      'VERSION',
      'SECURITY',
      'ENCODING',
      'CHARSET',
      'COMPRESSION',
      'OLDFILEUID',
      'NEWFILEUID',
    ]);
    expect(doc.startsWith('OFXHEADER:100\r\n')).toBe(true);
    expect(doc).toContain('DATA:OFXSGML\r\n');
    expect(doc).toContain('VERSION:102\r\n');
  });

  it('separates the header from <OFX> with exactly one blank line', () => {
    expect(/NEWFILEUID:[^\r]*\r\n\r\n<OFX>\r\n/.test(doc)).toBe(true);
  });
});

describe('line endings and encoding', () => {
  const doc = buildOFX(usTransactions(), META);

  it('uses CRLF everywhere with no bare LF', () => {
    expect(/[^\r]\n/.test(doc)).toBe(false);
    expect(doc.split('\n').length - 1).toBe(doc.split('\r\n').length - 1);
  });

  it('terminates the final line', () => {
    expect(doc.endsWith('</OFX>\r\n')).toBe(true);
  });

  it('emits pure ASCII, as the header declares', () => {
    expect(toBytes(doc).every((b) => b < 0x80)).toBe(true);
  });

  it('folds non-ASCII text rather than emitting UTF-8 bytes', () => {
    const doc2 = buildOFX([row({ name: 'CAFÉ MOMENTO' })], META);
    expect(doc2).toContain('<NAME>CAFE MOMENTO');
    expect(toBytes(doc2).every((b) => b < 0x80)).toBe(true);
  });

  it('escapes SGML-significant characters', () => {
    const doc2 = buildOFX([row({ name: 'A & B <LTD>' })], META);
    expect(doc2).toContain('<NAME>A &amp; B &lt;LTD&gt;');
  });
});

describe('dialects', () => {
  const txns = usTransactions();

  it('omits INTU.BID from plain OFX', () => {
    expect(buildOFX(txns, META)).not.toContain('INTU.BID');
  });

  it('includes INTU.BID in QBO, which QuickBooks requires', () => {
    expect(buildQBO(txns, META)).toContain('<INTU.BID>10898\r\n');
  });

  it('includes INTU.BID in QFX', () => {
    expect(buildQFX(txns, META)).toContain('<INTU.BID>10898\r\n');
  });
});

describe('FITID strategy', () => {
  it('is sha1(accountId|postedDate|amountMinor|memo) truncated to 32', () => {
    const id = computeFitId('000123456789', DATE, -320n, 2, 'BLUE BOTTLE');
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[0-9A-F]{32}$/);
  });

  it('is stable across calls', () => {
    expect(computeFitId('A', DATE, -320n, 2, 'X')).toBe(computeFitId('A', DATE, -320n, 2, 'X'));
  });

  it('changes when any tuple component changes', () => {
    const base = computeFitId('A', DATE, -320n, 2, 'X');
    expect(computeFitId('B', DATE, -320n, 2, 'X')).not.toBe(base);
    expect(computeFitId('A', { ...DATE, day: 4 }, -320n, 2, 'X')).not.toBe(base);
    expect(computeFitId('A', DATE, -321n, 2, 'X')).not.toBe(base);
    expect(computeFitId('A', DATE, -320n, 2, 'Y')).not.toBe(base);
  });

  it('is insensitive to memo case and surrounding space', () => {
    expect(computeFitId('A', DATE, -320n, 2, ' blue bottle ')).toBe(
      computeFitId('A', DATE, -320n, 2, 'BLUE BOTTLE'),
    );
  });

  describe('collision suffixes', () => {
    it('appends -2, -3 for rows identical under the tuple', () => {
      const dupes = [row(), row({ sourceRow: 1 }), row({ sourceRow: 2 })];
      const ids = withFitIds('A', 2, dupes).map((t) => t.fitId);
      expect(ids[1]).toBe(`${ids[0]}-2`);
      expect(ids[2]).toBe(`${ids[0]}-3`);
      expect(new Set(ids).size).toBe(3);
    });

    it('uses no randomness: the same batch yields the same suffixes', () => {
      const dupes = [row(), row({ sourceRow: 1 })];
      expect(withFitIds('A', 2, dupes).map((t) => t.fitId)).toEqual(
        withFitIds('A', 2, dupes).map((t) => t.fitId),
      );
    });

    it('does not renumber earlier rows when later ones are appended', () => {
      const first = [row(), row({ sourceRow: 1 })];
      const extended = [...first, row({ sourceRow: 2, datePosted: { year: 2025, month: 2, day: 9 } })];
      const before = withFitIds('A', 2, first).map((t) => t.fitId);
      const after = withFitIds('A', 2, extended).map((t) => t.fitId);
      expect(after.slice(0, 2)).toEqual(before);
    });

    it('leaves distinct transactions unsuffixed', () => {
      const ids = withFitIds('A', 2, [row(), row({ sourceRow: 1, amount: -999n })]).map((t) => t.fitId);
      expect(ids.every((id) => !id.includes('-'))).toBe(true);
    });
  });

  it('keeps a caller-supplied fitId in preference to deriving one', () => {
    const ids = withFitIds('A', 2, [row({ fitId: 'BANK-REF-001' })]).map((t) => t.fitId);
    expect(ids).toEqual(['BANK-REF-001']);
  });
});

describe('reproducibility', () => {
  const txns = usTransactions();

  it('produces byte-identical output across builds', () => {
    expect(buildOFX(txns, META)).toBe(buildOFX(txns, META));
  });

  it('derives DTSERVER from the statement, never the clock', () => {
    // The latest posted row is 02/28/2025; a wall-clock read would drift.
    expect(buildOFX(txns, META)).toContain('<DTSERVER>20250228000000[-5:EST]');
  });

  it('emits amounts straight from the bigint with no float round-trip', () => {
    const doc = buildOFX([row({ amount: 9223372036854775807n })], META);
    expect(doc).toContain('<TRNAMT>92233720368547758.07');
  });
});
