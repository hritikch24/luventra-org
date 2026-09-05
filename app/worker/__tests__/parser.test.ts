import { describe, expect, it } from 'vitest';

import {
  inferSchema,
  parseAmountToMinor,
  parseDate,
  parseTransactions,
  readRows,
} from '../parser';
import { buildOFX } from '../emitter';
import type { NumberFormatInference } from '../types';
import {
  ACCOUNT,
  META,
  AMBIGUOUS_CSV,
  BINARY_PAYLOADS,
  EMBEDDED_BOM_CSV,
  EMBEDDED_NEWLINE_CSV,
  EU_CSV,
  MIXED_CURRENCY_COLUMN_CSV,
  MIXED_SYMBOL_CSV,
  PAREN_EU_CSV,
  PAREN_EU_SPACE_CSV,
  PAREN_US_CSV,
  US_CSV,
  bytes,
  cp1252TabBytes,
  largeCsv,
  toUtf16,
  withUtf8Bom,
} from './fixtures';

const US_FORMAT: NumberFormatInference = {
  decimalSeparator: '.',
  groupSeparator: ',',
  parenthesesNegative: true,
  trailingSign: true,
  strippedSymbols: [],
  convention: 'signed',
};

const EU_FORMAT: NumberFormatInference = { ...US_FORMAT, decimalSeparator: ',', groupSeparator: '.' };

describe('delimiter and encoding detection', () => {
  it('detects a comma-delimited US export', () => {
    const { schema } = inferSchema(bytes(US_CSV), ACCOUNT);
    expect(schema.delimiter.delimiter).toBe(',');
    expect(schema.delimiter.hasHeaderRow).toBe(true);
    expect(schema.delimiter.consistency).toBe(1);
  });

  it('detects a semicolon-delimited EU export', () => {
    const { schema } = inferSchema(bytes(EU_CSV), ACCOUNT);
    expect(schema.delimiter.delimiter).toBe(';');
  });

  it('detects tabs and skips the bank preamble above the header', () => {
    const { schema } = inferSchema(cp1252TabBytes(), ACCOUNT);
    expect(schema.delimiter.delimiter).toBe('\t');
    expect(schema.delimiter.preambleRows).toBe(2);
    expect(schema.delimiter.hasHeaderRow).toBe(true);
  });

  it('decodes a Windows-1252 byte rather than producing mojibake', () => {
    const input = cp1252TabBytes();
    const { schema } = inferSchema(input, ACCOUNT);
    const { transactions } = parseTransactions(input, schema);
    expect(transactions[0]?.name).toContain('CAFÉ');
    expect(transactions[0]?.name).not.toContain('�');
  });
});

describe('column mapping', () => {
  it('maps date, description, amount and balance from headers', () => {
    const { schema } = inferSchema(bytes(US_CSV), ACCOUNT);
    expect(schema.columns.map((c) => c.role)).toEqual(['date', 'description', 'amount', 'balance']);
  });

  it('recognises a debit/credit column pair', () => {
    const { schema } = inferSchema(bytes(EU_CSV), ACCOUNT);
    expect(schema.columns.map((c) => c.role)).toEqual([
      'date',
      'description',
      'debit',
      'credit',
      'balance',
    ]);
    expect(schema.numberFormat.convention).toBe('debit-credit');
  });

  it('maps withdrawal/deposit synonyms onto debit/credit', () => {
    const { schema } = inferSchema(cp1252TabBytes(), ACCOUNT);
    expect(schema.columns.map((c) => c.role)).toEqual(['date', 'description', 'debit', 'credit']);
  });
});

describe('date disambiguation', () => {
  it('infers MDY when a middle component exceeds 12', () => {
    const { schema } = inferSchema(bytes(US_CSV), ACCOUNT);
    expect(schema.dateFormat.order).toBe('MDY');
    expect(schema.dateFormat.ambiguous).toBe(false);
  });

  it('infers DMY when a leading component exceeds 12', () => {
    const { schema } = inferSchema(bytes(EU_CSV), ACCOUNT);
    expect(schema.dateFormat.order).toBe('DMY');
    expect(schema.dateFormat.ambiguous).toBe(false);
  });

  it('infers YMD from ISO dates', () => {
    const { schema } = inferSchema(cp1252TabBytes(), ACCOUNT);
    expect(schema.dateFormat.order).toBe('YMD');
  });

  it('flags a column where every day is <= 12 instead of guessing silently', () => {
    const { schema, issues } = inferSchema(bytes(AMBIGUOUS_CSV), ACCOUNT);
    expect(schema.dateFormat.ambiguous).toBe(true);
    expect(schema.dateFormat.order).toBe('MDY');
    expect(issues.map((i) => i.code)).toContain('ambiguous-date-order');
  });

  it('applies the inferred order to each row', () => {
    const input = bytes(EU_CSV);
    const { schema } = inferSchema(input, ACCOUNT);
    const { transactions } = parseTransactions(input, schema);
    expect(transactions[0]?.datePosted).toEqual({ year: 2025, month: 1, day: 17 });
    expect(transactions[1]?.datePosted).toEqual({ year: 2025, month: 2, day: 3 });
  });

  it('lets a named month override the column order', () => {
    const mdy = { order: 'MDY', separator: ' ', fourDigitYear: true, monthIsAlpha: true, hasTime: false, timeZone: null, confidence: 1, ambiguous: false } as const;
    expect(parseDate('17 Jan 2025', mdy)).toEqual({ year: 2025, month: 1, day: 17 });
  });

  it('rejects impossible calendar dates', () => {
    const dmy = { order: 'DMY', separator: '/', fourDigitYear: true, monthIsAlpha: false, hasTime: false, timeZone: null, confidence: 1, ambiguous: false } as const;
    expect(parseDate('30/02/2025', dmy)).toBeNull();
    expect(parseDate('29/02/2024', dmy)).toEqual({ year: 2024, month: 2, day: 29 });
  });
});

describe('amount parsing into BigInt minor units', () => {
  it('parses plain and grouped decimals exactly', () => {
    expect(parseAmountToMinor('0.1', US_FORMAT, 2)).toBe(10n);
    expect(parseAmountToMinor('0.2', US_FORMAT, 2)).toBe(20n);
    expect(parseAmountToMinor('1,234.50', US_FORMAT, 2)).toBe(123450n);
    expect(parseAmountToMinor('$1,000', US_FORMAT, 2)).toBe(100000n);
  });

  it('never accumulates float error', () => {
    // The canonical demonstration: 0.1 + 0.2 !== 0.3 in binary floating point.
    const sum = parseAmountToMinor('0.1', US_FORMAT, 2)! + parseAmountToMinor('0.2', US_FORMAT, 2)!;
    expect(sum).toBe(30n);
    expect(sum).toBe(parseAmountToMinor('0.30', US_FORMAT, 2));
  });

  it('keeps precision far beyond Number.MAX_SAFE_INTEGER', () => {
    expect(parseAmountToMinor('92233720368547758.07', US_FORMAT, 2)).toBe(9223372036854775807n);
  });

  it('handles accounting negatives and trailing signs', () => {
    expect(parseAmountToMinor('(45.60)', US_FORMAT, 2)).toBe(-4560n);
    expect(parseAmountToMinor('123.45-', US_FORMAT, 2)).toBe(-12345n);
    expect(parseAmountToMinor('100.00 DR', US_FORMAT, 2)).toBe(-10000n);
    expect(parseAmountToMinor('100.00 CR', US_FORMAT, 2)).toBe(10000n);
  });

  it('rounds half away from zero at the currency scale', () => {
    expect(parseAmountToMinor('0.005', US_FORMAT, 2)).toBe(1n);
    expect(parseAmountToMinor('99.999', US_FORMAT, 2)).toBe(10000n);
    expect(parseAmountToMinor('0.004', US_FORMAT, 2)).toBe(0n);
  });

  it('distinguishes an empty cell from zero', () => {
    expect(parseAmountToMinor('', US_FORMAT, 2)).toBeNull();
    expect(parseAmountToMinor('0.00', US_FORMAT, 2)).toBe(0n);
  });

  it('reads European grouping under a European format', () => {
    expect(parseAmountToMinor('1.234,56', EU_FORMAT, 2)).toBe(123456n);
    expect(parseAmountToMinor('2.500,00', EU_FORMAT, 2)).toBe(250000n);
  });

  describe('locale grouping fallback', () => {
    // A group separator must sit between a digit and exactly three digits.
    // Without this guard, a European value read under a US format has its
    // comma stripped as grouping and comes out 100x too large -- silently.
    it('rejects a European value read under a US format rather than returning 100x', () => {
      expect(parseAmountToMinor('1 234,56', US_FORMAT, 2)).toBeNull();
    });

    it('rejects a separator not followed by exactly three digits', () => {
      expect(parseAmountToMinor('1,23', US_FORMAT, 2)).toBeNull();
      expect(parseAmountToMinor('1,5', US_FORMAT, 2)).toBeNull();
      expect(parseAmountToMinor('1,23456', US_FORMAT, 2)).toBeNull();
    });

    it('still accepts well-formed grouping', () => {
      expect(parseAmountToMinor('1,234,567.89', US_FORMAT, 2)).toBe(123456789n);
      expect(parseAmountToMinor('12345.67', US_FORMAT, 2)).toBe(1234567n);
    });
  });
});

describe('sign conventions', () => {
  it('reads a single signed column', () => {
    const input = bytes(US_CSV);
    const { schema } = inferSchema(input, ACCOUNT);
    const { transactions } = parseTransactions(input, schema);
    expect(transactions.map((t) => t.amount)).toEqual([-320n, 250000n, -10000n]);
  });

  it('signs a debit/credit pair from the column, not the value', () => {
    const input = bytes(EU_CSV);
    const { schema } = inferSchema(input, { ...ACCOUNT, currency: 'EUR' });
    const { transactions } = parseTransactions(input, schema);
    expect(transactions[0]?.amount).toBe(-1234n);
    expect(transactions[1]?.amount).toBe(250000n);
  });

  it('carries the running balance as minor units', () => {
    const input = bytes(US_CSV);
    const { schema } = inferSchema(input, ACCOUNT);
    const { transactions } = parseTransactions(input, schema);
    expect(transactions[0]?.balance).toBe(124680n);
  });
});

describe('transaction typing', () => {
  it('derives TRNTYPE from description keywords', () => {
    const input = bytes(US_CSV);
    const { schema } = inferSchema(input, ACCOUNT);
    const { transactions } = parseTransactions(input, schema);
    expect(transactions.map((t) => t.type)).toEqual(['DEBIT', 'DIRECTDEP', 'ATM']);
  });

  it('falls back to the sign when no keyword matches', () => {
    const input = bytes('Date,Description,Amount\n01/03/2025,SOMETHING OPAQUE,-5.00\n01/04/2025,ALSO OPAQUE,5.00\n');
    const { schema } = inferSchema(input, ACCOUNT);
    const { transactions } = parseTransactions(input, schema);
    expect(transactions.map((t) => t.type)).toEqual(['DEBIT', 'CREDIT']);
  });
});

describe('row-level resilience', () => {
  it('skips a malformed row without losing the rest of the file', () => {
    const input = bytes(
      'Date,Description,Amount\n01/03/2025,GOOD ONE,-1.00\nNOT-A-DATE,BROKEN,-2.00\n01/05/2025,GOOD TWO,-3.00\n',
    );
    const { schema } = inferSchema(input, ACCOUNT);
    const { transactions, issues } = parseTransactions(input, schema);
    expect(transactions).toHaveLength(2);
    expect(transactions.map((t) => t.name)).toEqual(['GOOD ONE', 'GOOD TWO']);
    expect(issues.filter((i) => i.code === 'bad-date')).toHaveLength(1);
    expect(issues[0]?.row).toBe(1);
  });
});

describe('determinism', () => {
  it('produces an identical schema on repeated runs', () => {
    const a = inferSchema(bytes(US_CSV), ACCOUNT).schema;
    const b = inferSchema(bytes(US_CSV), ACCOUNT).schema;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

/* ========================================================================== */
/* Hardening: chaotic and hostile input                                       */
/* ========================================================================== */

/** Every guard here must fail as a structured issue, never as a thrown error. */
function inferQuietly(input: Uint8Array) {
  return inferSchema(input, ACCOUNT);
}

describe('malformed layouts', () => {
  it('reports an empty file as a single clear issue', () => {
    const { schema, issues } = inferQuietly(bytes(''));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('empty-file');
    expect(schema.rowCount).toBe(0);
  });

  it('reports a header-only file without a cascade of secondary complaints', () => {
    const { issues } = inferQuietly(bytes('Date,Description,Amount\n'));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('no-rows');
  });

  it('handles a file with no trailing newline', () => {
    const { schema } = inferQuietly(bytes('Date,Description,Amount\n01/03/2025,X,-1.00'));
    expect(schema.rowCount).toBe(1);
  });

  it('handles a whitespace-only file', () => {
    const { issues } = inferQuietly(bytes('   \n\n  \n'));
    expect(issues[0]?.code).toBe('no-rows');
  });

  it('parses a single data row', () => {
    const input = bytes('Date,Description,Amount\n01/03/2025,SOLO MERCHANT,-1.00\n');
    const { schema } = inferQuietly(input);
    const { transactions } = parseTransactions(input, schema);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.name).toBe('SOLO MERCHANT');
  });

  it('does not throw on a single column with no delimiter present', () => {
    expect(() => inferQuietly(bytes('justtext\nmoretext\n'))).not.toThrow();
  });

  it('does not throw on ragged rows of wildly differing widths', () => {
    const ragged = 'Date,Description,Amount\n01/03/2025,A\n01/04/2025,B,-1.00,extra,more\n01/05/2025,C,-2.00\n';
    expect(() => {
      const { schema } = inferQuietly(bytes(ragged));
      parseTransactions(bytes(ragged), schema);
    }).not.toThrow();
  });

  it('processes 100,000 rows without loss', () => {
    const input = bytes(largeCsv(100_000));
    const { schema } = inferQuietly(input);
    expect(schema.rowCount).toBe(100_000);
    const { transactions } = parseTransactions(input, schema);
    expect(transactions).toHaveLength(100_000);
    expect(transactions[99_999]?.name).toBe('MERCHANT 99999');
  });
});

describe('byte order marks', () => {
  const csv = 'Date,Description,Amount\n01/03/2025,COFFEE,-3.20\n01/17/2025,PAYROLL,2500.00\n';

  it('strips a UTF-8 BOM so the first header still matches', () => {
    const { headers } = readRows(withUtf8Bom(csv));
    expect(headers[0]).toBe('Date');
    expect(headers[0]?.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('decodes UTF-16LE and strips its BOM', () => {
    const { headers } = readRows(toUtf16(csv, true));
    expect(headers).toEqual(['Date', 'Description', 'Amount']);
  });

  it('decodes UTF-16BE and strips its BOM', () => {
    const { headers } = readRows(toUtf16(csv, false));
    expect(headers).toEqual(['Date', 'Description', 'Amount']);
  });

  it('maps columns correctly through a BOM, not into an unrecognised role', () => {
    // The regression this guards: a surviving U+FEFF makes "\uFEFFDate" !== "Date",
    // so the date column falls through to content sniffing or `ignored`.
    for (const input of [withUtf8Bom(csv), toUtf16(csv, true), toUtf16(csv, false)]) {
      const { schema } = inferQuietly(input);
      expect(schema.columns.map((c) => c.role)).toEqual(['date', 'description', 'amount']);
      expect(schema.columns[0]?.confidence).toBeGreaterThan(0.9);
    }
  });

  it('strips a BOM that appears at the header line rather than byte 0', () => {
    // decodeBytes only strips at offset 0, so a concatenated export leaves a
    // literal U+FEFF on the header cell. Without the cell-level strip the date
    // column stops matching and the whole mapping collapses.
    const { headers } = readRows(bytes(EMBEDDED_BOM_CSV));
    expect(headers[0]).toBe('Date');
    expect(headers[0]?.charCodeAt(0)).not.toBe(0xfeff);

    const { schema } = inferQuietly(bytes(EMBEDDED_BOM_CSV));
    expect(schema.columns.map((c) => c.role)).toEqual(['date', 'description', 'amount']);
  });

  it('parses transactions identically with and without a BOM', () => {
    const plain = parseTransactions(bytes(csv), inferQuietly(bytes(csv)).schema).transactions;
    const bommed = parseTransactions(withUtf8Bom(csv), inferQuietly(withUtf8Bom(csv)).schema).transactions;
    expect(bommed).toEqual(plain);
  });
});

describe('embedded newlines in quoted fields', () => {
  const input = bytes(EMBEDDED_NEWLINE_CSV);

  it('does not split a quoted multi-line description into extra rows', () => {
    const { schema } = inferQuietly(input);
    expect(schema.rowCount).toBe(3);
  });

  it('preserves the newline inside the parsed field', () => {
    const { schema } = inferQuietly(input);
    const { transactions } = parseTransactions(input, schema);
    expect(transactions).toHaveLength(3);
    expect(transactions[0]?.name).toContain('\n');
    expect(transactions[1]?.name).toContain('\r\n');
  });

  it('collapses embedded newlines when emitting, so the SGML stays one line per leaf', () => {
    const { schema } = inferQuietly(input);
    const { transactions } = parseTransactions(input, schema);
    const doc = buildOFX(transactions, META);
    // Every line in the body is a tag line; a raw newline inside NAME would
    // produce a line with no '<' and corrupt the document.
    for (const line of doc.split('\r\n')) {
      if (line.trim() === '') continue;
      expect(line.trimStart().startsWith('<') || line.includes(':')).toBe(true);
    }
    expect(doc).toContain('<NAME>ACME CORP INVOICE 4471');
  });
});

describe('accounting parentheses', () => {
  it('reads US parentheses as negative minor units', () => {
    const input = bytes(PAREN_US_CSV);
    const { schema } = inferQuietly(input);
    expect(schema.numberFormat.parenthesesNegative).toBe(true);
    const { transactions } = parseTransactions(input, schema);
    expect(transactions.map((t) => t.amount)).toEqual([-123456n, 250000n, -9999n]);
  });

  it('reads European dot-grouped parentheses', () => {
    const input = bytes(PAREN_EU_CSV);
    const { schema } = inferQuietly(input);
    expect(schema.numberFormat.decimalSeparator).toBe(',');
    expect(schema.numberFormat.groupSeparator).toBe('.');
    const { transactions } = parseTransactions(input, schema);
    expect(transactions.map((t) => t.amount)).toEqual([-123456n, 250000n]);
  });

  it('reads European space-grouped parentheses', () => {
    const input = bytes(PAREN_EU_SPACE_CSV);
    const { schema } = inferQuietly(input);
    expect(schema.numberFormat.decimalSeparator).toBe(',');
    const { transactions } = parseTransactions(input, schema);
    expect(transactions.map((t) => t.amount)).toEqual([-123456n, 250000n]);
  });

  it('does not double-negate a parenthesised value that also carries a sign', () => {
    const format = {
      decimalSeparator: '.',
      groupSeparator: null,
      parenthesesNegative: true,
      trailingSign: true,
      strippedSymbols: [],
      convention: 'signed',
    } as const;
    expect(parseAmountToMinor('(-5.00)', format, 2)).toBe(500n);
  });
});

describe('multi-currency collision', () => {
  it('rejects two distinct currency symbols in the amount column', () => {
    const { issues } = inferQuietly(bytes(MIXED_SYMBOL_CSV));
    const collision = issues.find((i) => i.code === 'multi-currency');
    expect(collision).toBeDefined();
    expect(collision?.level).toBe('error');
    expect(collision?.message).toContain('EUR');
    expect(collision?.message).toContain('GBP');
  });

  it('rejects an explicit currency column holding two codes', () => {
    const { issues } = inferQuietly(bytes(MIXED_CURRENCY_COLUMN_CSV));
    const collision = issues.find((i) => i.code === 'multi-currency');
    expect(collision?.level).toBe('error');
    expect(collision?.column).toBe(3);
  });

  it('accepts a single currency repeated on every row', () => {
    const csv = 'Date,Description,Amount,Currency\n01/03/2025,A,10.00,USD\n01/17/2025,B,20.00,USD\n';
    const { issues } = inferQuietly(bytes(csv));
    expect(issues.some((i) => i.code === 'multi-currency')).toBe(false);
  });

  it('treats a symbol and its ISO code as the same currency', () => {
    const csv = 'Date,Description,Amount\n01/03/2025,A,\u20ac10.00\n01/17/2025,B,EUR 20.00\n';
    const { issues } = inferQuietly(bytes(csv));
    expect(issues.some((i) => i.code === 'multi-currency')).toBe(false);
  });

  it('does not flag a symbol and its own ISO code as a conflict', () => {
    // `$` denotes USD, CAD, AUD and more, so `$10.00` alongside `USD 20.00` is
    // one currency written two ways. Treating a symbol as a single code here
    // would reject a perfectly valid statement.
    const csv = 'Date,Description,Amount\n01/03/2025,A,$10.00\n01/17/2025,B,USD 20.00\n';
    expect(inferQuietly(bytes(csv)).issues.some((i) => i.code === 'multi-currency')).toBe(false);
  });

  it('does not flag an ambiguous symbol against a compatible code', () => {
    // \u00a5 covers both JPY and CNY; paired with JPY it intersects, so it is fine.
    const csv = 'Date,Description,Amount\n01/03/2025,A,\u00a510\n01/17/2025,B,JPY 20\n';
    expect(inferQuietly(bytes(csv)).issues.some((i) => i.code === 'multi-currency')).toBe(false);
  });

  it('still flags a symbol against an incompatible code', () => {
    const csv = 'Date,Description,Amount\n01/03/2025,A,$10.00\n01/17/2025,B,EUR 20.00\n';
    expect(inferQuietly(bytes(csv)).issues.some((i) => i.code === 'multi-currency')).toBe(true);
  });

  it('does not flag a currency column mixing a symbol with its code', () => {
    const csv = 'Date,Description,Amount,Currency\n01/03/2025,A,10.00,$\n01/17/2025,B,20.00,USD\n';
    const input = bytes(csv);
    const { schema, issues } = inferQuietly(input);
    expect(issues.some((i) => i.code === 'multi-currency')).toBe(false);
    expect(parseTransactions(input, schema).issues.some((i) => i.code === 'multi-currency')).toBe(false);
  });

  it('catches a currency that first appears beyond the inference sample window', () => {
    // Inference samples 200 rows; this one changes currency at row 500, so
    // only the full row scan in parseTransactions can see it.
    const rows = ['Date,Description,Amount,Currency'];
    for (let i = 0; i < 600; i += 1) {
      rows.push(`01/03/2025,ROW ${i},-1.00,${i === 500 ? 'JPY' : 'USD'}`);
    }
    const input = bytes(rows.join('\n'));
    const { schema, issues } = inferQuietly(input);
    expect(issues.some((i) => i.code === 'multi-currency')).toBe(false);
    const parsed = parseTransactions(input, schema);
    const collision = parsed.issues.find((i) => i.code === 'multi-currency');
    expect(collision?.level).toBe('error');
    expect(collision?.message).toContain('JPY');
  });
});

describe('binary payload rejection', () => {
  it.each(Object.keys(BINARY_PAYLOADS))('rejects a %s payload before parsing', (name) => {
    const { issues } = inferQuietly(BINARY_PAYLOADS[name]!);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('unsupported-content');
    expect(issues[0]?.level).toBe('error');
  });

  it('rejects a payload containing NUL bytes', () => {
    const nulled = new Uint8Array(200);
    nulled.set(bytes('Date,Description,Amount'));
    const { issues } = inferQuietly(nulled);
    expect(issues[0]?.code).toBe('unsupported-content');
  });

  it('never throws on random binary noise', () => {
    // Deterministic pseudo-random bytes: a fixed LCG, so a failure reproduces.
    let seed = 42;
    const noise = new Uint8Array(8192);
    for (let i = 0; i < noise.length; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      noise[i] = seed % 256;
    }
    expect(() => inferQuietly(noise)).not.toThrow();
  });
});
