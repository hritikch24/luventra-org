/**
 * OFX 1.x / QBO / QFX emitters.
 *
 * OFX 1.x is **SGML, not XML**. Three consequences drive everything below:
 *
 *  1. Leaf elements are written *open only* — `<FITID>ABC` with no `</FITID>`.
 *     Only aggregates (elements containing other elements) get a close tag.
 *     Emitting well-formed XML here makes Quicken and QuickBooks reject the
 *     file, so the leaf/aggregate distinction is enforced by the writer API:
 *     `leaf()` physically cannot produce a close tag.
 *  2. The file opens with a plain-text `KEY:VALUE` header block, terminated by
 *     one blank line, *before* the first `<OFX>` tag. That block is ASCII.
 *  3. Line endings are CRLF throughout, including inside the header block and
 *     after the final tag.
 *
 * Output is byte-exact and reproducible: given the same options, the same
 * bytes come out. Nothing here reads the clock, the locale, or `Math.random`.
 */

import { sha1Hex } from './sha1';
import { compareDates, formatDate, formatDateTime, formatMinor } from './money';
import type {
  IdentifiedTransaction,
  MinorUnits,
  OfxBuildOptions,
  OfxDialect,
  PlainDate,
  StatementRange,
} from './types';

const CRLF = '\r\n';

/** OFX 1.x field length caps (OFX 1.0.2 spec, section 11.4.2.3.1). */
const LIMITS = {
  name: 32,
  memo: 255,
  checkNum: 12,
  refNum: 32,
  fitId: 255,
  acctId: 22,
  bankId: 9,
} as const;

/* -------------------------------------------------------------------------- */
/* Text sanitation                                                            */
/* -------------------------------------------------------------------------- */

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

/**
 * Prepares a value for an SGML leaf.
 *
 * The header declares `ENCODING:USASCII`, so the body must be ASCII: accented
 * characters are decomposed and stripped of their combining marks (é -> e),
 * anything still non-ASCII becomes '?', and control characters — which would
 * corrupt the SGML stream — are dropped. `& < >` are entity-escaped.
 * Whitespace is collapsed so a value never spans a line.
 */
export function sgmlText(value: string, maxLength: number): string {
  const folded = value
    .normalize('NFD')
    // Strip combining diacritical marks left behind by NFD.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/€/g, 'EUR')
    .replace(/£/g, 'GBP')
    .replace(/₹/g, 'INR');

  let out = '';
  for (const char of folded) {
    const code = char.codePointAt(0)!;
    if (code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20 || code === 0xa0) {
      // Collapse any run of whitespace to a single space.
      if (!out.endsWith(' ')) out += ' ';
      continue;
    }
    if (code < 0x20 || code === 0x7f) continue;
    if (code > 0x7e) {
      out += '?';
      continue;
    }
    out += ENTITIES[char] ?? char;
  }

  out = out.trim();
  if (out.length <= maxLength) return out;

  // Truncate on the character, then repair a half-written entity at the tail.
  const cut = out.slice(0, maxLength);
  const lastAmp = cut.lastIndexOf('&');
  if (lastAmp !== -1 && !cut.slice(lastAmp).includes(';')) {
    return cut.slice(0, lastAmp).trimEnd();
  }
  return cut.trimEnd();
}

/* -------------------------------------------------------------------------- */
/* SGML writer                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Append-only SGML writer. Aggregates are opened and closed; leaves are
 * written open-only, which is what makes the output OFX 1.x rather than XML.
 */
class SgmlWriter {
  private readonly parts: string[] = [];
  private readonly stack: string[] = [];
  private depth = 0;

  /** Opens an aggregate (an element that contains other elements). */
  open(tag: string): void {
    this.line(`<${tag}>`);
    this.stack.push(tag);
    this.depth += 1;
  }

  /** Closes the innermost aggregate. */
  close(tag: string): void {
    const expected = this.stack.pop();
    if (expected !== tag) {
      throw new Error(`OFX writer: closing <${tag}> but <${expected ?? 'nothing'}> is open`);
    }
    this.depth -= 1;
    this.line(`</${tag}>`);
  }

  /**
   * Writes a leaf element: open tag plus value, deliberately **not** closed.
   * Empty values are skipped — an OFX leaf with no content is invalid.
   */
  leaf(tag: string, value: string): void {
    if (value === '') return;
    this.line(`<${tag}>${value}`);
  }

  /** Writes a leaf only when the value is present and non-empty. */
  optionalLeaf(tag: string, value: string | undefined): void {
    if (value === undefined) return;
    this.leaf(tag, value);
  }

  private line(text: string): void {
    this.parts.push('  '.repeat(this.depth), text, CRLF);
  }

  finish(): string {
    if (this.stack.length > 0) {
      throw new Error(`OFX writer: unclosed aggregate <${this.stack[this.stack.length - 1]!}>`);
    }
    return this.parts.join('');
  }
}

/* -------------------------------------------------------------------------- */
/* Header block                                                               */
/* -------------------------------------------------------------------------- */

interface HeaderFields {
  readonly version: '102' | '103';
  readonly newFileUid: string;
}

/**
 * The ASCII `KEY:VALUE` preamble. Terminated by a blank line; the byte after
 * that blank line is the `<` of `<OFX>`.
 */
function buildHeader({ version, newFileUid }: HeaderFields): string {
  const rows: readonly [string, string][] = [
    ['OFXHEADER', '100'],
    ['DATA', 'OFXSGML'],
    ['VERSION', version],
    ['SECURITY', 'NONE'],
    ['ENCODING', 'USASCII'],
    ['CHARSET', '1252'],
    ['COMPRESSION', 'NONE'],
    ['OLDFILEUID', 'NONE'],
    ['NEWFILEUID', newFileUid],
  ];
  return rows.map(([key, value]) => `${key}:${value}`).join(CRLF) + CRLF + CRLF;
}

/* -------------------------------------------------------------------------- */
/* Body                                                                       */
/* -------------------------------------------------------------------------- */

/** OFX ids are uppercase hex/alphanumeric tokens; keep them ASCII-safe. */
function idToken(value: string, maxLength: number): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, maxLength);
}

/** Derives the statement period from the rows when the caller did not give one. */
function resolveRange(
  transactions: readonly IdentifiedTransaction[],
  explicit: StatementRange | undefined,
  fallback: PlainDate,
): StatementRange {
  if (explicit !== undefined) return explicit;
  const first = transactions[0];
  if (first === undefined) return { start: fallback, end: fallback };
  let start = first.datePosted;
  let end = first.datePosted;
  for (const txn of transactions) {
    if (compareDates(txn.datePosted, start) < 0) start = txn.datePosted;
    if (compareDates(txn.datePosted, end) > 0) end = txn.datePosted;
  }
  return { start, end };
}

/** Closing balance: caller's value, else the last row's running balance, else 0. */
function resolveLedgerBalance(
  transactions: readonly IdentifiedTransaction[],
  explicit: MinorUnits | undefined,
): MinorUnits {
  if (explicit !== undefined) return explicit;
  for (let i = transactions.length - 1; i >= 0; i -= 1) {
    const balance = transactions[i]!.balance;
    if (balance !== undefined) return balance;
  }
  return 0n;
}

function writeSignon(w: SgmlWriter, options: OfxBuildOptions, dialect: OfxDialect): void {
  const { account, asOf, timeZoneSuffix } = options;
  const serverTime = formatDateTime(asOf.date, asOf.time, timeZoneSuffix);

  w.open('SIGNONMSGSRSV1');
  w.open('SONRS');
  w.open('STATUS');
  w.leaf('CODE', '0');
  w.leaf('SEVERITY', 'INFO');
  w.close('STATUS');
  w.leaf('DTSERVER', serverTime);
  w.leaf('LANGUAGE', options.language ?? 'ENG');
  w.open('FI');
  w.leaf('ORG', sgmlText(account.institution, 32));
  w.leaf('FID', idToken(account.fid, 32));
  w.close('FI');
  // Intuit's own extension. QuickBooks (.qbo) refuses a file without it, and
  // Quicken (.qfx) uses it to route the file to a subscribed institution.
  if (dialect !== 'ofx') {
    w.leaf('INTU.BID', idToken(options.intuitBid ?? account.fid, 32));
  }
  w.close('SONRS');
  w.close('SIGNONMSGSRSV1');
}

function writeTransaction(w: SgmlWriter, txn: IdentifiedTransaction): void {
  w.open('STMTTRN');
  w.leaf('TRNTYPE', txn.type);
  w.leaf(
    'DTPOSTED',
    txn.timePosted === undefined
      ? formatDate(txn.datePosted)
      : formatDateTime(txn.datePosted, txn.timePosted, ''),
  );
  if (txn.dateUser !== undefined) {
    w.leaf('DTUSER', formatDate(txn.dateUser));
  }
  w.leaf('TRNAMT', formatMinor(txn.amount, txn.scale));
  w.leaf('FITID', idToken(txn.fitId, LIMITS.fitId));
  if (txn.checkNumber !== undefined) {
    w.leaf('CHECKNUM', idToken(txn.checkNumber, LIMITS.checkNum));
  }
  if (txn.referenceNumber !== undefined) {
    w.leaf('REFNUM', idToken(txn.referenceNumber, LIMITS.refNum));
  }
  // NAME is mandatory; fall back to the type so the leaf is never empty.
  w.leaf('NAME', sgmlText(txn.name, LIMITS.name) || txn.type);
  if (txn.memo !== undefined) {
    w.optionalLeaf('MEMO', sgmlText(txn.memo, LIMITS.memo) || undefined);
  }
  w.close('STMTTRN');
}

function writeStatement(w: SgmlWriter, options: OfxBuildOptions): void {
  const { account, transactions, asOf, timeZoneSuffix } = options;
  const range = resolveRange(transactions, options.range, asOf.date);
  const asOfStamp = formatDateTime(asOf.date, asOf.time, timeZoneSuffix);

  w.open('BANKMSGSRSV1');
  w.open('STMTTRNRS');
  // TRNUID is fixed rather than random: reproducibility beats uniqueness here,
  // and consumers only use it to correlate a request they never sent.
  w.leaf('TRNUID', '1');
  w.open('STATUS');
  w.leaf('CODE', '0');
  w.leaf('SEVERITY', 'INFO');
  w.close('STATUS');

  w.open('STMTRS');
  w.leaf('CURDEF', idToken(account.currency, 3).toUpperCase() || 'USD');
  w.open('BANKACCTFROM');
  w.leaf('BANKID', idToken(account.bankId, LIMITS.bankId));
  w.leaf('ACCTID', idToken(account.accountId, LIMITS.acctId));
  w.leaf('ACCTTYPE', account.accountType);
  w.close('BANKACCTFROM');

  w.open('BANKTRANLIST');
  w.leaf('DTSTART', formatDate(range.start));
  w.leaf('DTEND', formatDate(range.end));
  for (const txn of transactions) {
    writeTransaction(w, txn);
  }
  w.close('BANKTRANLIST');

  const ledger = resolveLedgerBalance(transactions, options.ledgerBalance);
  w.open('LEDGERBAL');
  w.leaf('BALAMT', formatMinor(ledger, account.scale));
  w.leaf('DTASOF', asOfStamp);
  w.close('LEDGERBAL');

  if (options.availableBalance !== undefined) {
    w.open('AVAILBAL');
    w.leaf('BALAMT', formatMinor(options.availableBalance, account.scale));
    w.leaf('DTASOF', asOfStamp);
    w.close('AVAILBAL');
  }

  w.close('STMTRS');
  w.close('STMTTRNRS');
  w.close('BANKMSGSRSV1');
}

/* -------------------------------------------------------------------------- */
/* Public emitters                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Builds an OFX 1.0.2 SGML document as a string.
 *
 * The result is pure ASCII, uses CRLF everywhere, and ends with a trailing
 * CRLF after `</OFX>`.
 */
export function buildOfxDocument(options: OfxBuildOptions, dialect: OfxDialect): string {
  const w = new SgmlWriter();
  w.open('OFX');
  writeSignon(w, options, dialect);
  writeStatement(w, options);
  w.close('OFX');

  // NEWFILEUID is derived from the content so the same statement always
  // produces the same header, while different statements do not claim the
  // same file id.
  const body = w.finish();
  const header = buildHeader({
    version: '102',
    newFileUid: fileUidFor(options),
  });
  return header + body;
}

/**
 * Content-derived file uid: stable per statement, distinct across statements.
 *
 * Hashed rather than concatenated — the header value is capped at 36 chars, and
 * splicing two ids together would truncate mid-token, so two statements sharing
 * a first transaction could claim the same uid.
 */
function fileUidFor(options: OfxBuildOptions): string {
  const { transactions } = options;
  if (transactions.length === 0) return 'NONE';
  const first = transactions[0]!;
  const last = transactions[transactions.length - 1]!;
  const material = [
    options.account.bankId,
    options.account.accountId,
    String(transactions.length),
    first.fitId,
    last.fitId,
  ].join('');
  return sha1Hex(material).slice(0, 32).toUpperCase();
}

/**
 * Encodes the document to bytes. Every character is ASCII by construction
 * (see `sgmlText`), so this is a straight 1:1 byte copy and needs no
 * `TextEncoder` — which would otherwise be free to emit multi-byte sequences.
 */
export function encodeAscii(document: string): Uint8Array {
  const bytes = new Uint8Array(document.length);
  for (let i = 0; i < document.length; i += 1) {
    const code = document.charCodeAt(i);
    bytes[i] = code < 0x80 ? code : 0x3f; // '?'
  }
  return bytes;
}

/** Byte-exact OFX 1.x (`.ofx`) file. */
export function buildOFX(options: OfxBuildOptions): Uint8Array {
  return encodeAscii(buildOfxDocument(options, 'ofx'));
}

/**
 * Byte-exact QuickBooks Web Connect (`.qbo`) file.
 *
 * Identical SGML to OFX plus the mandatory `<INTU.BID>` routing tag in the
 * signon block; QuickBooks rejects the file outright without it.
 */
export function buildQBO(options: OfxBuildOptions): Uint8Array {
  return encodeAscii(buildOfxDocument(options, 'qbo'));
}

/**
 * Byte-exact Quicken Web Connect (`.qfx`) file.
 *
 * Same wire format as QBO; Quicken keys off the extension and `<INTU.BID>`.
 */
export function buildQFX(options: OfxBuildOptions): Uint8Array {
  return encodeAscii(buildOfxDocument(options, 'qfx'));
}

/** Dispatches to the emitter for `dialect`. */
export function buildStatementFile(options: OfxBuildOptions, dialect: OfxDialect): Uint8Array {
  switch (dialect) {
    case 'ofx':
      return buildOFX(options);
    case 'qbo':
      return buildQBO(options);
    case 'qfx':
      return buildQFX(options);
  }
}
