import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildOFX, buildQBO } from '../emitter';
import { inferSchema, parseTransactions } from '../parser';
import {
  ACCOUNT,
  EMBEDDED_NEWLINE_CSV,
  EU_CSV,
  META,
  PAREN_EU_CSV,
  PAREN_US_CSV,
  US_CSV,
  bytes,
  largeCsv,
  withUtf8Bom,
} from './fixtures';

const GOLDEN_DIR = join(import.meta.dirname, 'golden');

/**
 * Compares a document against its committed golden file byte for byte.
 *
 * Run with `UPDATE_GOLDEN=1` to rewrite them after an intentional format
 * change — then read the diff, because any change here alters the FITIDs or
 * the wire format that downstream importers depend on.
 *
 * The comparison is on the raw string including CRLF: a golden file stored or
 * checked out with LF endings must fail, since that is exactly the corruption
 * that gets a file rejected by QuickBooks.
 */
function expectGolden(name: string, actual: string): void {
  const path = join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === '1') {
    writeFileSync(path, actual, 'latin1');
    return;
  }
  const expected = readFileSync(path, 'latin1');
  expect(actual).toBe(expected);
}

function convert(csv: string, currency = 'USD') {
  const input = bytes(csv);
  const { schema } = inferSchema(input, { ...ACCOUNT, currency });
  return parseTransactions(input, schema).transactions;
}

describe('golden files', () => {
  it('matches the US statement OFX byte for byte', () => {
    expectGolden('us-statement.ofx', buildOFX(convert(US_CSV), META));
  });

  it('matches the US statement QBO byte for byte', () => {
    expectGolden('us-statement.qbo', buildQBO(convert(US_CSV), META));
  });

  it('matches the EU statement OFX byte for byte', () => {
    expectGolden(
      'eu-statement.ofx',
      buildOFX(convert(EU_CSV, 'EUR'), { ...META, currency: 'EUR', timeZoneSuffix: '[0:GMT]' }),
    );
  });

  it('matches the accounting-parentheses statement', () => {
    expectGolden('paren-us-statement.ofx', buildOFX(convert(PAREN_US_CSV), META));
  });

  it('matches the European parentheses statement', () => {
    expectGolden(
      'paren-eu-statement.ofx',
      buildOFX(convert(PAREN_EU_CSV, 'EUR'), { ...META, currency: 'EUR', timeZoneSuffix: '[0:GMT]' }),
    );
  });

  it('matches the embedded-newline statement, with descriptions flattened', () => {
    expectGolden('embedded-newline.ofx', buildOFX(convert(EMBEDDED_NEWLINE_CSV), META));
  });

  it('produces identical output with and without a UTF-8 BOM', () => {
    const plain = bytes(US_CSV);
    const bommed = withUtf8Bom(US_CSV);
    const fromPlain = buildOFX(parseTransactions(plain, inferSchema(plain, ACCOUNT).schema).transactions, META);
    const fromBom = buildOFX(parseTransactions(bommed, inferSchema(bommed, ACCOUNT).schema).transactions, META);
    expect(fromBom).toBe(fromPlain);
    expectGolden('us-statement.ofx', fromBom);
  });

  it('emits a 100,000 row statement whose shape stays stable', () => {
    // Too large to store as a golden file, so the invariants are pinned
    // instead: one STMTTRN per row, unique FITIDs, and a clean terminator.
    const input = bytes(largeCsv(100_000));
    const { schema } = inferSchema(input, ACCOUNT);
    const { transactions } = parseTransactions(input, schema);
    const doc = buildOFX(transactions, META);
    expect(doc.split('<STMTTRN>').length - 1).toBe(100_000);
    expect(doc.endsWith('</OFX>\r\n')).toBe(true);
    expect(/[^\r]\n/.test(doc)).toBe(false);
    const ids = new Set([...doc.matchAll(/<FITID>([^\r]*)/g)].map((m) => m[1]!));
    expect(ids.size).toBe(100_000);
  });

  it('stores golden files with CRLF endings intact', () => {
    for (const name of ['us-statement.ofx', 'us-statement.qbo', 'eu-statement.ofx', 'paren-us-statement.ofx', 'paren-eu-statement.ofx', 'embedded-newline.ofx']) {
      const raw = readFileSync(join(GOLDEN_DIR, name), 'latin1');
      expect(/[^\r]\n/.test(raw), `${name} must use CRLF`).toBe(false);
      expect(raw.startsWith('OFXHEADER:100\r\n'), `${name} must carry the OFX header`).toBe(true);
    }
  });
});
