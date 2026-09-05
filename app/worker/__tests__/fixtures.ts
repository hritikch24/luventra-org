import type { AccountIdentity, SchemaMeta } from '../types';

/** UTF-8 encodes a fixture string to the byte buffer the engine expects. */
export function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export const ACCOUNT: AccountIdentity = {
  bankId: '021000021',
  accountId: '000123456789',
  accountType: 'CHECKING',
  currency: 'USD',
  scale: 2,
  institution: 'Example Bank',
  fid: '10898',
};

export const META: SchemaMeta = {
  accountId: '000123456789',
  bankId: '021000021',
  institution: 'Example Bank',
  fid: '10898',
  currency: 'USD',
  scale: 2,
  timeZoneSuffix: '[-5:EST]',
};

/** US export: comma-delimited, MM/DD/YYYY, signed amounts, `$` and grouping. */
export const US_CSV = [
  'Date,Description,Amount,Balance',
  '01/03/2025,"BLUE BOTTLE COFFEE",-3.20,"1,246.80"',
  '01/17/2025,ACME PAYROLL,"$2,500.00","3,746.80"',
  '02/28/2025,ATM WITHDRAWAL,-100.00,"3,646.80"',
  '',
].join('\n');

/** EU export: semicolon, DD/MM/YYYY, comma decimals, debit/credit pair. */
export const EU_CSV = [
  'Date;Description;Debit;Credit;Balance',
  '17/01/2025;TESCO STORES;12,34;;1.234,56',
  '03/02/2025;SALARY PAYMENT;;2.500,00;3.734,56',
  '',
].join('\n');

/** Every leading component <= 12, so DD/MM and MM/DD cannot be distinguished. */
export const AMBIGUOUS_CSV = [
  'Date,Description,Amount',
  '01/02/2025,ALPHA,-1.00',
  '03/04/2025,BRAVO,-2.00',
  '',
].join('\n');

/**
 * Tab-delimited with a two-row bank preamble, ISO dates, and a Windows-1252
 * `É` (0xC9) that is not valid UTF-8 — the byte that proves encoding fallback
 * decodes rather than mojibakes.
 */
export function cp1252TabBytes(): Uint8Array {
  const head = 'Account Statement\r\nAccount: 1234\r\n\r\nTransaction Date\tNarration\tWithdrawal\tDeposit\r\n2025-01-05\tCAF';
  const tail = ' MOMENTO\t3.20\t\r\n2025-01-06\tINTEREST EARNED\t\t1.05\r\n';
  const out = new Uint8Array(head.length + 1 + tail.length);
  for (let i = 0; i < head.length; i += 1) out[i] = head.charCodeAt(i);
  out[head.length] = 0xc9;
  for (let i = 0; i < tail.length; i += 1) out[head.length + 1 + i] = tail.charCodeAt(i);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Hardening fixtures                                                         */
/* -------------------------------------------------------------------------- */

/** Prefixes a UTF-8 BOM (EF BB BF) to the encoded text. */
export function withUtf8Bom(text: string): Uint8Array {
  const body = bytes(text);
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}

/** Encodes as UTF-16 with the matching BOM. ASCII input only. */
export function toUtf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = littleEndian ? 0xff : 0xfe;
  out[1] = littleEndian ? 0xfe : 0xff;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out[2 + i * 2] = littleEndian ? code & 0xff : code >> 8;
    out[3 + i * 2] = littleEndian ? code >> 8 : code & 0xff;
  }
  return out;
}

/** Descriptions carrying raw LF and CRLF inside quoted fields. */
export const EMBEDDED_NEWLINE_CSV = [
  'Date,Description,Amount',
  '01/03/2025,"ACME CORP\nINVOICE 4471",-3.20',
  '01/17/2025,"MULTI\r\nLINE\r\nMERCHANT",2500.00',
  '02/28/2025,"TRAILING NEWLINE\n",-1.00',
  '',
].join('\n');

/** Accounting parentheses for negatives, quoted so the grouping comma survives. */
export const PAREN_US_CSV = [
  'Date,Description,Amount',
  '01/03/2025,ALPHA,"(1,234.56)"',
  '01/17/2025,BRAVO,"2,500.00"',
  '02/28/2025,CHARLIE,"(99.99)"',
  '',
].join('\n');

/** European accounting parentheses: dot grouping, comma decimals. */
export const PAREN_EU_CSV = [
  'Date;Description;Amount',
  '17/01/2025;ALPHA;(1.234,56)',
  '03/02/2025;BRAVO;2.500,00',
  '',
].join('\n');

/** European parentheses using space grouping. */
export const PAREN_EU_SPACE_CSV = [
  'Date;Description;Amount',
  '17/01/2025;ALPHA;(1 234,56)',
  '03/02/2025;BRAVO;2 500,00',
  '',
].join('\n');

/** Two distinct currency symbols embedded in the amount column. */
export const MIXED_SYMBOL_CSV = [
  'Date,Description,Amount',
  '01/03/2025,LONDON OFFICE,\u00a310.00',
  '01/17/2025,PARIS OFFICE,\u20ac20.00',
  '',
].join('\n');

/** An explicit currency column holding two distinct codes. */
export const MIXED_CURRENCY_COLUMN_CSV = [
  'Date,Description,Amount,Currency',
  '01/03/2025,ALPHA,10.00,USD',
  '01/17/2025,BRAVO,20.00,EUR',
  '',
].join('\n');

/** Builds a synthetic statement of `count` data rows. */
export function largeCsv(count: number): string {
  const rows: string[] = ['Date,Description,Amount,Balance'];
  for (let i = 0; i < count; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    rows.push(`01/${day}/2025,MERCHANT ${i},-1.00,${(1000000 - i) / 100}`);
  }
  rows.push('');
  return rows.join('\n');
}

/** Magic-number prefixes for formats users mistake for a CSV. */
export const BINARY_PAYLOADS: Readonly<Record<string, Uint8Array>> = {
  pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3]),
  xlsx: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00]),
  xls: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]),
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
  gzip: new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]),
  sqlite: new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66]),
};

/**
 * Two exports concatenated: a preamble, then a second file's UTF-8 BOM sitting
 * at the start of the header line rather than at byte 0.
 *
 * `decodeBytes` strips a BOM only at offset 0, so this one survives decoding
 * and reaches the header cell as a literal U+FEFF -- invisible, but enough to
 * make "\uFEFFDate" !== "Date" and break every header match in the file.
 */
export const EMBEDDED_BOM_CSV = [
  'Statement export',
  'Account: 1234',
  '\ufeffDate,Description,Amount',
  '01/03/2025,COFFEE,-3.20',
  '01/17/2025,PAYROLL,2500.00',
  '',
].join('\n');
