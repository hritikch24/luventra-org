/**
 * Schema inference and CSV → canonical-transaction parsing.
 *
 * The pipeline runs in five deterministic stages, each of which is exported so
 * it can be tested (and overridden by the UI) in isolation:
 *
 *   bytes → decode → delimit → locate header → map columns → parse rows
 *
 * Two rules hold throughout:
 *
 *  1. **No floating point ever touches an amount.** Money is parsed from the
 *     source text straight into `bigint` minor units by string surgery, so
 *     `0.1 + 0.2` can never happen. `Number` appears only for row indices,
 *     scores, and calendar components.
 *  2. **No ambient state.** Nothing reads the clock, the locale, `Intl`
 *     defaults, or `Math.random`. The same bytes always yield the same schema.
 */

import * as PapaNamespace from 'papaparse';
import * as jschardet from 'jschardet';

import type {
  AccountIdentity,
  AmountConvention,
  ByteOrderMark,
  CanonicalTransaction,
  ColumnRole,
  CurrencyScale,
  DateFormatInference,
  DateOrder,
  DelimiterInference,
  Delimiter,
  DetectedColumn,
  EncodingInference,
  InferredSchema,
  LineEnding,
  MinorUnits,
  NumberFormatInference,
  ParseIssue,
  PlainDate,
  PlainTime,
  SupportedEncoding,
  TransactionType,
} from './types';
import { sha1Hex } from './sha1';
import { Deadline, NO_DEADLINE, validateContentType } from './guards';

/**
 * CommonJS interop guard.
 *
 * Papa Parse ships as UMD/CJS. A bundler (webpack, Turbopack, Vite) hands the
 * namespace import the exports object directly, but Node's ESM loader cannot
 * statically detect Papa's named exports and exposes only `default`. Reading
 * through `default` when it is present covers both, so this module works
 * unchanged in the browser worker, in a bundler, and under bare `node`.
 */
const Papa: typeof PapaNamespace =
  (PapaNamespace as { default?: typeof PapaNamespace }).default ?? PapaNamespace;

/** Rows read before the parser commits to a delimiter and header position. */
const SNIFF_ROWS = 40;

/** Rows sampled when scoring a column's content against a role. */
const SAMPLE_ROWS = 200;

/** Rows processed between deadline checks in the row loops. */
const DEADLINE_CHECK_INTERVAL = 1024;

/**
 * Removes a stray U+FEFF from the front of a cell.
 *
 * `decodeBytes` strips the BOM by byte offset, so this only fires for the
 * leftovers: a BOM at the start of a header *line* rather than the file, which
 * is what two concatenated exports produce. A surviving BOM is invisible but
 * makes `"\uFEFFDate" === "Date"` false, silently breaking every header match.
 *
 * Belt and braces: U+FEFF is ECMAScript whitespace, so the `.trim()` that
 * follows every call would also remove a *leading* mark. This is kept explicit
 * because that behaviour is obscure enough to be refactored away by accident,
 * and because it states the intent that trim only implies.
 */
function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

/* ========================================================================== */
/* Stage 1 — encoding                                                         */
/* ========================================================================== */

const BOMS: readonly { readonly bytes: readonly number[]; readonly bom: ByteOrderMark }[] = [
  // UTF-32 must be tested before UTF-16LE: FF FE 00 00 starts with FF FE.
  { bytes: [0xff, 0xfe, 0x00, 0x00], bom: 'utf-32le' },
  { bytes: [0x00, 0x00, 0xfe, 0xff], bom: 'utf-32be' },
  { bytes: [0xef, 0xbb, 0xbf], bom: 'utf-8' },
  { bytes: [0xff, 0xfe], bom: 'utf-16le' },
  { bytes: [0xfe, 0xff], bom: 'utf-16be' },
];

/** Maps a jschardet label onto an encoding `TextDecoder` actually accepts. */
const ENCODING_ALIASES: Readonly<Record<string, SupportedEncoding>> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  ascii: 'utf-8', // ASCII is a strict UTF-8 subset; decoding as UTF-8 is lossless.
  'us-ascii': 'utf-8',
  'utf-16le': 'utf-16le',
  'utf-16be': 'utf-16be',
  'windows-1252': 'windows-1252',
  'iso-8859-1': 'windows-1252', // Banks label CP1252 as Latin-1 constantly.
  'iso-8859-2': 'windows-1252',
  latin1: 'windows-1252',
  'iso-8859-15': 'iso-8859-15',
  'windows-1251': 'windows-1251',
  'iso-8859-5': 'windows-1251',
  'shift_jis': 'shift_jis',
  sjis: 'shift_jis',
  gb2312: 'gb18030',
  gbk: 'gb18030',
  gb18030: 'gb18030',
  big5: 'big5',
  'euc-kr': 'euc-kr',
  'koi8-r': 'koi8-r',
  ibm866: 'ibm866',
};

function matchBom(bytes: Uint8Array): { bom: ByteOrderMark; length: number } {
  for (const candidate of BOMS) {
    if (bytes.length < candidate.bytes.length) continue;
    let matches = true;
    for (let i = 0; i < candidate.bytes.length; i += 1) {
      if (bytes[i] !== candidate.bytes[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return { bom: candidate.bom, length: candidate.bytes.length };
  }
  return { bom: null, length: 0 };
}

/** jschardet wants a Buffer or a binary string; workers have no Buffer. */
function toBinaryString(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return out;
}

/**
 * Decides how to decode the buffer.
 *
 * A BOM is authoritative and short-circuits statistical detection. Otherwise
 * jschardet votes, and anything it cannot name confidently falls back to
 * Windows-1252 — the superset that decodes any byte sequence without throwing,
 * so a misdetection mangles a payee name rather than failing the whole import.
 */
export function detectEncoding(bytes: Uint8Array): EncodingInference {
  const { bom, length } = matchBom(bytes);
  if (bom === 'utf-8' || bom === 'utf-16le' || bom === 'utf-16be') {
    return {
      encoding: bom,
      detectedLabel: bom,
      confidence: 1,
      bom,
      bomLength: length,
      fallback: false,
    };
  }
  if (bom === 'utf-32le' || bom === 'utf-32be') {
    // TextDecoder has no UTF-32. Nothing sane emits UTF-32 CSV; treat the file
    // as unsupported by falling back, and let the caller surface the warning.
    return {
      encoding: 'windows-1252',
      detectedLabel: bom,
      confidence: 0,
      bom,
      bomLength: length,
      fallback: true,
    };
  }

  // Detection quality plateaus quickly; 64 KiB is plenty and keeps this O(1).
  const sample = bytes.subarray(0, Math.min(bytes.length, 64 * 1024));
  let detected: { encoding: string; confidence: number } | null = null;
  try {
    detected = jschardet.detect(toBinaryString(sample));
  } catch {
    detected = null;
  }

  const label = detected?.encoding ?? null;
  const normalized = label === null ? undefined : ENCODING_ALIASES[label.toLowerCase()];
  const confidence = detected?.confidence ?? 0;

  if (normalized !== undefined && confidence >= 0.6) {
    return {
      encoding: normalized,
      detectedLabel: label,
      confidence,
      bom: null,
      bomLength: 0,
      fallback: false,
    };
  }

  return {
    encoding: 'windows-1252',
    detectedLabel: label,
    confidence,
    bom: null,
    bomLength: 0,
    fallback: true,
  };
}

/** Decodes the buffer, stripping any BOM first so it never leaks into cell 0. */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: EncodingInference } {
  const encoding = detectEncoding(bytes);
  const body = encoding.bomLength > 0 ? bytes.subarray(encoding.bomLength) : bytes;
  // `fatal: false` keeps a bad byte as U+FFFD instead of aborting the import.
  const decoder = new TextDecoder(encoding.encoding, { fatal: false });
  return { text: decoder.decode(body), encoding };
}

/* ========================================================================== */
/* Stage 2 — delimiter                                                        */
/* ========================================================================== */

const CANDIDATE_DELIMITERS: readonly Delimiter[] = [',', ';', '\t', '|', '^', '~'];

function detectLineEnding(text: string): LineEnding {
  const crlf = text.indexOf('\r\n');
  if (crlf !== -1) return '\r\n';
  if (text.indexOf('\n') !== -1) return '\n';
  if (text.indexOf('\r') !== -1) return '\r';
  return '\n';
}

/** Parses at most `SNIFF_ROWS` rows with an explicit delimiter, quotes honoured. */
function previewRows(text: string, delimiter: Delimiter, limit: number): string[][] {
  const result = Papa.parse<string[]>(text, {
    delimiter,
    preview: limit,
    skipEmptyLines: 'greedy',
    newline: undefined,
  });
  return result.data.filter((row): row is string[] => Array.isArray(row));
}

/**
 * Picks the delimiter by field-count agreement.
 *
 * The winner is the character that splits the sniff window into the most
 * columns while keeping the row width *consistent*. Consistency is weighted
 * far above width, because a wrong delimiter (a comma inside unquoted address
 * text, say) produces high but erratic column counts, whereas the right one
 * produces the same count on nearly every row.
 */
export function detectDelimiter(text: string, deadline: Deadline = NO_DEADLINE): DelimiterInference {
  const lineEnding = detectLineEnding(text);

  let best: { delimiter: Delimiter; fieldCount: number; consistency: number } = {
    delimiter: ',',
    fieldCount: 1,
    consistency: 0,
  };
  let bestScore = -1;

  for (const delimiter of CANDIDATE_DELIMITERS) {
    deadline.check();
    const rows = previewRows(text, delimiter, SNIFF_ROWS);
    if (rows.length === 0) continue;

    // Modal field count across the window.
    const counts = new Map<number, number>();
    for (const row of rows) {
      counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
    }
    let modal = 1;
    let modalHits = 0;
    for (const [count, hits] of counts) {
      // Ties break toward more columns: a real 6-column file also "agrees"
      // trivially at 1 column under a delimiter that never appears.
      if (hits > modalHits || (hits === modalHits && count > modal)) {
        modal = count;
        modalHits = hits;
      }
    }
    if (modal < 2) continue;

    const consistency = modalHits / rows.length;
    const score = consistency * 100 + Math.min(modal, 40);
    if (score > bestScore) {
      bestScore = score;
      best = { delimiter, fieldCount: modal, consistency };
    }
  }

  const rows = previewRows(text, best.delimiter, SNIFF_ROWS);
  const headerIndex = locateHeaderRow(rows, best.fieldCount);

  return {
    delimiter: best.delimiter,
    quoteChar: '"',
    escapeChar: '"',
    lineEnding,
    fieldCount: best.fieldCount,
    consistency: best.consistency,
    preambleRows: headerIndex === -1 ? 0 : headerIndex,
    hasHeaderRow: headerIndex !== -1,
  };
}

/* ========================================================================== */
/* Stage 3 — header location                                                  */
/* ========================================================================== */

const NUMERIC_CELL = /^[\s(]*[-+]?[\p{Sc}]?\s*\d[\d\s.,']*\)?\s*$/u;

function looksNumeric(cell: string): boolean {
  return NUMERIC_CELL.test(cell.trim());
}

/**
 * Finds the header row, skipping the preamble many banks prepend ("Account:
 * 1234", "Statement period …", blank rows).
 *
 * The header is the earliest row that fills the modal width and whose cells
 * read as labels rather than data: non-empty, non-numeric, and not dates.
 * Returns -1 when no such row exists, i.e. the file is headerless.
 */
export function locateHeaderRow(rows: readonly string[][], fieldCount: number): number {
  let bestIndex = -1;
  let bestScore = 0;

  const limit = Math.min(rows.length, SNIFF_ROWS);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i]!;
    if (row.length !== fieldCount) continue;

    let labels = 0;
    let filled = 0;
    for (const raw of row) {
      const cell = raw.trim();
      if (cell === '') continue;
      filled += 1;
      if (!looksNumeric(cell) && parseDateParts(cell) === null) labels += 1;
    }
    if (filled < Math.max(2, Math.ceil(fieldCount * 0.6))) continue;

    // Prefer all-label rows, and prefer earlier rows among equals.
    const score = labels / filled + filled / fieldCount / 100;
    if (labels === filled && score > bestScore) {
      bestScore = score;
      bestIndex = i;
      break;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestScore >= 0.75 ? bestIndex : -1;
}

/* ========================================================================== */
/* Stage 4 — column mapping                                                   */
/* ========================================================================== */

/**
 * Header keywords per role, most specific first.
 *
 * Order matters within a role and across roles: "posting date" must beat the
 * bare "date" rule, and "balance" must not be swallowed by "amount".
 */
const HEADER_PATTERNS: readonly { readonly role: ColumnRole; readonly pattern: RegExp; readonly weight: number }[] = [
  { role: 'postedDate', pattern: /^(post(ing|ed)?|clear(ed|ing)|settle(ment|d)?|value)\s*date$/, weight: 1 },
  { role: 'date', pattern: /^(transaction|txn|trans|booking|entry|operation)?\s*date$/, weight: 1 },
  { role: 'date', pattern: /^date$/, weight: 1 },
  { role: 'date', pattern: /date/, weight: 0.6 },

  { role: 'debit', pattern: /^(debit|withdrawal|withdrawals|paid\s*out|money\s*out|outflow|dr)(\s*amount)?$/, weight: 1 },
  { role: 'debit', pattern: /(debit|withdrawal|paid\s*out|money\s*out)/, weight: 0.7 },
  { role: 'credit', pattern: /^(credit|deposit|deposits|paid\s*in|money\s*in|inflow|cr)(\s*amount)?$/, weight: 1 },
  { role: 'credit', pattern: /(credit|deposit|paid\s*in|money\s*in)/, weight: 0.7 },

  { role: 'balance', pattern: /^(running\s*|closing\s*|available\s*)?balance$/, weight: 1 },
  { role: 'balance', pattern: /balance/, weight: 0.7 },

  { role: 'amount', pattern: /^(transaction\s*)?amount$/, weight: 1 },
  { role: 'amount', pattern: /^(amt|value|sum|net)$/, weight: 0.9 },
  { role: 'amount', pattern: /amount/, weight: 0.6 },

  { role: 'checkNumber', pattern: /^(che(ck|que)\s*(no|num(ber)?|#)?)$/, weight: 1 },
  { role: 'checkNumber', pattern: /che(ck|que)/, weight: 0.6 },

  { role: 'referenceNumber', pattern: /^(reference|ref|transaction\s*id|txn\s*id|utr|cheque\s*ref)(\s*(no|num(ber)?|#|id))?$/, weight: 1 },
  { role: 'referenceNumber', pattern: /(reference|\bref\b|transaction\s*id)/, weight: 0.6 },

  { role: 'payee', pattern: /^(payee|merchant|counterparty|beneficiary|to\s*\/?\s*from)$/, weight: 1 },
  { role: 'description', pattern: /^(description|narration|particulars|details|transaction\s*details|remarks|name)$/, weight: 1 },
  { role: 'description', pattern: /(description|narration|particulars|details)/, weight: 0.7 },
  { role: 'memo', pattern: /^(memo|note|notes|additional\s*info)$/, weight: 1 },
  { role: 'memo', pattern: /memo/, weight: 0.6 },

  { role: 'currency', pattern: /^(currency|ccy|curr)$/, weight: 1 },
  { role: 'category', pattern: /^(category|categories|class|tag)$/, weight: 1 },
  { role: 'type', pattern: /^(type|transaction\s*type|txn\s*type|dr\s*\/?\s*cr|debit\s*\/?\s*credit\s*indicator|ind(icator)?)$/, weight: 1 },
];

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[_.]+/g, ' ')
    .replace(/[^a-z0-9#/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Scores a header string against every role; returns the best match, if any. */
function scoreHeader(header: string): { role: ColumnRole; confidence: number } | null {
  const normalized = normalizeHeader(header);
  if (normalized === '') return null;
  for (const rule of HEADER_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      return { role: rule.role, confidence: rule.weight };
    }
  }
  return null;
}

/** Fraction of non-empty samples satisfying `predicate`. */
function ratio(samples: readonly string[], predicate: (value: string) => boolean): number {
  let seen = 0;
  let hits = 0;
  for (const sample of samples) {
    const value = sample.trim();
    if (value === '') continue;
    seen += 1;
    if (predicate(value)) hits += 1;
  }
  return seen === 0 ? 0 : hits / seen;
}

/**
 * Content-based role guess, used when a header is missing, blank, or
 * unrecognised. Looks at what the column actually holds.
 */
function scoreContent(samples: readonly string[]): { role: ColumnRole; confidence: number } | null {
  const dateRatio = ratio(samples, (value) => parseDateParts(value) !== null);
  if (dateRatio >= 0.8) return { role: 'date', confidence: dateRatio * 0.8 };

  const numericRatio = ratio(samples, looksNumeric);
  if (numericRatio >= 0.9) return { role: 'amount', confidence: numericRatio * 0.5 };

  const textRatio = ratio(samples, (value) => value.length >= 3 && !looksNumeric(value));
  if (textRatio >= 0.7) return { role: 'description', confidence: textRatio * 0.5 };

  return null;
}

/** Roles that may appear at most once; later, weaker claims are demoted. */
const UNIQUE_ROLES: ReadonlySet<ColumnRole> = new Set<ColumnRole>([
  'date',
  'postedDate',
  'description',
  'memo',
  'payee',
  'amount',
  'debit',
  'credit',
  'balance',
  'checkNumber',
  'referenceNumber',
  'balance',
  'currency',
  'type',
]);

/**
 * Assigns a role to every column.
 *
 * Headers win when they are recognised; otherwise the column's own values
 * decide. A second pass resolves contention so that no unique role is claimed
 * twice — the higher-confidence column keeps it, the loser is demoted to
 * `description` if it is textual and `ignored` otherwise.
 */
export function mapColumns(
  headers: readonly string[],
  columnSamples: readonly (readonly string[])[],
): DetectedColumn[] {
  const draft = headers.map((header, index): DetectedColumn => {
    const samples = columnSamples[index] ?? [];
    const byHeader = scoreHeader(header);
    // A confident header beats content sniffing; a weak one only wins if the
    // content agrees with nothing better.
    if (byHeader !== null && byHeader.confidence >= 0.9) {
      return { index, header: header.trim(), role: byHeader.role, confidence: byHeader.confidence, userAssigned: false };
    }
    const byContent = scoreContent(samples);
    if (byHeader !== null && (byContent === null || byHeader.confidence >= byContent.confidence)) {
      return { index, header: header.trim(), role: byHeader.role, confidence: byHeader.confidence, userAssigned: false };
    }
    if (byContent !== null) {
      return { index, header: header.trim(), role: byContent.role, confidence: byContent.confidence, userAssigned: false };
    }
    return { index, header: header.trim(), role: 'ignored', confidence: 0, userAssigned: false };
  });

  const claimed = new Map<ColumnRole, number>();
  const resolved: DetectedColumn[] = draft.map((column) => ({ ...column }));

  for (const column of resolved) {
    if (column.role === 'ignored' || !UNIQUE_ROLES.has(column.role)) continue;
    const incumbentIndex = claimed.get(column.role);
    if (incumbentIndex === undefined) {
      claimed.set(column.role, column.index);
      continue;
    }
    const incumbent = resolved[incumbentIndex]!;
    const loser = column.confidence > incumbent.confidence ? incumbent : column;
    const winner = loser === incumbent ? column : incumbent;
    claimed.set(winner.role, winner.index);
    demote(resolved, loser, columnSamples[loser.index] ?? []);
  }

  return resolved;
}

function demote(columns: DetectedColumn[], loser: DetectedColumn, samples: readonly string[]): void {
  const textual = ratio(samples, (value) => !looksNumeric(value)) >= 0.7;
  const fallbackRole: ColumnRole = textual && !columns.some((c) => c.role === 'memo') ? 'memo' : 'ignored';
  columns[loser.index] = { ...loser, role: fallbackRole, confidence: 0 };
}

/* ========================================================================== */
/* Stage 5a — dates                                                           */
/* ========================================================================== */

const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

interface DateParts {
  /** The three numeric/alpha components in the order they appeared. */
  readonly parts: readonly number[];
  readonly separator: '/' | '-' | '.' | ' ' | null;
  /** Index (0-2) whose token was an alphabetic month name, or -1. */
  readonly alphaMonthAt: number;
  readonly fourDigitYearAt: number;
  readonly time: PlainTime | null;
}

const TIME_RE = /(\d{1,2}):(\d{2})(?::(\d{2}))?/;

/**
 * Splits a date string into its three components without deciding what they
 * mean. Returns null when the value is not a date at all.
 */
export function parseDateParts(value: string): DateParts | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const timeMatch = TIME_RE.exec(trimmed);
  let time: PlainTime | null = null;
  if (timeMatch !== null) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const second = timeMatch[3] === undefined ? 0 : Number(timeMatch[3]);
    if (hour <= 23 && minute <= 59 && second <= 59) {
      time = { hour, minute, second };
    }
  }

  const datePortion = timeMatch === null ? trimmed : trimmed.slice(0, timeMatch.index);
  // Compact forms: YYYYMMDD or DDMMYYYY, no separators at all.
  const compact = /^(\d{8})$/.exec(datePortion.trim());
  if (compact !== null) {
    const digits = compact[1]!;
    return {
      parts: [Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8))],
      separator: null,
      alphaMonthAt: -1,
      fourDigitYearAt: 0,
      time,
    };
  }

  const tokens = datePortion.split(/[/\-.\s,]+/u).filter((token) => token !== '');
  if (tokens.length !== 3) return null;

  const separator: '/' | '-' | '.' | ' ' | null =
    datePortion.includes('/') ? '/'
      : datePortion.includes('-') ? '-'
        : datePortion.includes('.') ? '.'
          : ' ';

  const parts: number[] = [];
  let alphaMonthAt = -1;
  let fourDigitYearAt = -1;

  for (let i = 0; i < 3; i += 1) {
    const token = tokens[i]!;
    if (/^\d+$/.test(token)) {
      if (token.length === 4) fourDigitYearAt = i;
      else if (token.length > 4 || token.length === 0) return null;
      parts.push(Number(token));
      continue;
    }
    const month = MONTH_NAMES[token.slice(0, 4).toLowerCase()] ?? MONTH_NAMES[token.slice(0, 3).toLowerCase()];
    if (month === undefined) return null;
    alphaMonthAt = i;
    parts.push(month);
  }

  // A component out of every plausible range means this is not a date.
  if (parts.some((part) => part < 1)) return null;
  if (fourDigitYearAt === -1 && parts.some((part) => part > 99)) return null;

  return { parts, separator, alphaMonthAt, fourDigitYearAt, time };
}

/**
 * Infers day/month order across a whole column.
 *
 * The disambiguation that matters: with only `03/04/2025` in hand, MM/DD and
 * DD/MM are indistinguishable. But across a real statement, *some* row almost
 * always carries a day above 12 — `17/04/2025` can only be DD/MM. So the
 * column is scanned for the first position that is forced, and that decides
 * the whole column. Only when no row disambiguates is the result flagged
 * `ambiguous`, and the caller can offer the user a toggle.
 */
export function inferDateFormat(samples: readonly string[]): DateFormatInference {
  let parsed = 0;
  let total = 0;
  let alphaMonth = false;
  let fourDigitYear = false;
  let hasTime = false;
  let separator: '/' | '-' | '.' | ' ' | null = null;
  let yearAt = -1;

  // Evidence that a position cannot be a month.
  let firstExceeds12 = false;
  let secondExceeds12 = false;
  let firstExceeds31 = false;

  for (const sample of samples) {
    if (sample.trim() === '') continue;
    total += 1;
    const parts = parseDateParts(sample);
    if (parts === null) continue;
    parsed += 1;

    if (separator === null) separator = parts.separator;
    if (parts.alphaMonthAt !== -1) alphaMonth = true;
    if (parts.fourDigitYearAt !== -1) {
      fourDigitYear = true;
      if (yearAt === -1) yearAt = parts.fourDigitYearAt;
    }
    if (parts.time !== null) hasTime = true;

    const [a, b, c] = [parts.parts[0]!, parts.parts[1]!, parts.parts[2]!];
    if (a > 31) firstExceeds31 = true;
    if (a > 12) firstExceeds12 = true;
    if (b > 12) secondExceeds12 = true;
    void c;
  }

  // A named month pins the order outright — no counting needed.
  const alphaAt = alphaMonth ? firstAlphaPosition(samples) : -1;

  let order: DateOrder;
  let ambiguous = false;

  if (yearAt === 0 || firstExceeds31) {
    order = 'YMD';
  } else if (alphaAt === 1) {
    order = 'DMY';
  } else if (alphaAt === 0) {
    order = 'MDY';
  } else if (firstExceeds12) {
    // 17/04/2025 — position 0 cannot be a month.
    order = 'DMY';
  } else if (secondExceeds12) {
    // 04/17/2025 — position 1 cannot be a month.
    order = 'MDY';
  } else {
    // Every row has both leading values <= 12. Genuinely undecidable from the
    // data; default to MDY (the dominant convention in CSV exports that do not
    // use ISO) and tell the caller it is a guess.
    order = 'MDY';
    ambiguous = true;
  }

  return {
    order,
    separator,
    fourDigitYear,
    monthIsAlpha: alphaMonth,
    hasTime,
    timeZone: null,
    confidence: total === 0 ? 0 : parsed / total,
    ambiguous,
  };
}

function firstAlphaPosition(samples: readonly string[]): number {
  for (const sample of samples) {
    const parts = parseDateParts(sample);
    if (parts !== null && parts.alphaMonthAt !== -1) return parts.alphaMonthAt;
  }
  return -1;
}

/** Two-digit years: 70-99 map to the 1900s, 00-69 to the 2000s (POSIX rule). */
function expandYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Applies an inferred order to one value. Returns null if it does not fit. */
export function parseDate(value: string, format: DateFormatInference): PlainDate | null {
  const parts = parseDateParts(value);
  if (parts === null) return null;
  const [a, b, c] = [parts.parts[0]!, parts.parts[1]!, parts.parts[2]!];

  // A named month overrides the column order — "3 Jan 2025" is unambiguous
  // even in a column inferred as MDY.
  let year: number;
  let month: number;
  let day: number;

  if (parts.alphaMonthAt === 1) {
    [day, month, year] = [a, b, c];
  } else if (parts.alphaMonthAt === 0) {
    [month, day, year] = [a, b, c];
  } else if (parts.alphaMonthAt === 2) {
    [year, day, month] = [a, b, c];
  } else {
    switch (format.order) {
      case 'YMD': [year, month, day] = [a, b, c]; break;
      case 'DMY': [day, month, year] = [a, b, c]; break;
      case 'MDY': [month, day, year] = [a, b, c]; break;
      case 'YDM': [year, day, month] = [a, b, c]; break;
    }
  }

  // ISO-shaped values carry the year first regardless of the column's order.
  if (parts.fourDigitYearAt === 0 && format.order !== 'YMD' && format.order !== 'YDM') {
    [year, month, day] = [a, b, c];
  }

  year = expandYear(year);
  if (month < 1 || month > 12) return null;
  const monthLength = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
  if (day < 1 || day > monthLength) return null;

  return { year, month, day };
}

/* ========================================================================== */
/* Stage 5b — amounts                                                         */
/* ========================================================================== */

const CURRENCY_SYMBOLS = /[\p{Sc}]|(?:^|\s)(?:USD|EUR|GBP|INR|JPY|AUD|CAD|CHF|SGD|AED|Rs\.?)(?=\s|$)/giu;
const DR_CR_SUFFIX = /\b(DR|CR|DB|D|C)\b\.?\s*$/i;

/**
 * Works out how numbers are written in this file.
 *
 * The hard case is a lone separator: `1,234` is 1234 in en-US and 1.234 in
 * de-DE. It is resolved by evidence — a separator followed by anything other
 * than exactly three digits must be a decimal point, and a value carrying two
 * of the same separator must be using it for grouping. Only when every sample
 * is `x,yyy`-shaped does it stay undecidable, and the en-US reading wins.
 */
export function inferNumberFormat(
  samples: readonly string[],
  convention: AmountConvention,
): NumberFormatInference {
  let dotCount = 0;
  let commaCount = 0;
  let sawBothInOneValue = false;
  let dotIsDecimal = false;
  let commaIsDecimal = false;
  let dotIsGroup = false;
  let commaIsGroup = false;
  let spaceGroup = false;
  let apostropheGroup = false;
  let parenthesesNegative = false;
  let trailingSign = false;
  const strippedSymbols = new Set<string>();

  for (const sample of samples) {
    const raw = sample.trim();
    if (raw === '') continue;

    for (const match of raw.matchAll(CURRENCY_SYMBOLS)) {
      strippedSymbols.add(match[0].trim());
    }
    if (/^\(.*\)$/.test(raw)) parenthesesNegative = true;
    if (/[-+]\s*$/.test(raw)) trailingSign = true;

    const digitsOnly = raw.replace(CURRENCY_SYMBOLS, '').replace(DR_CR_SUFFIX, '');
    if (/\d[  ]\d{3}\b/u.test(digitsOnly)) spaceGroup = true;
    if (/\d'\d{3}\b/.test(digitsOnly)) apostropheGroup = true;

    const dots = (digitsOnly.match(/\./g) ?? []).length;
    const commas = (digitsOnly.match(/,/g) ?? []).length;
    dotCount += dots;
    commaCount += commas;

    if (dots > 0 && commas > 0) {
      sawBothInOneValue = true;
      // Whichever appears last is the decimal separator.
      if (digitsOnly.lastIndexOf('.') > digitsOnly.lastIndexOf(',')) {
        dotIsDecimal = true;
        commaIsGroup = true;
      } else {
        commaIsDecimal = true;
        dotIsGroup = true;
      }
      continue;
    }

    if (dots > 1) dotIsGroup = true;
    if (commas > 1) commaIsGroup = true;
    // A separator trailed by anything but three digits cannot be grouping.
    if (dots === 1 && !/\.\d{3}(?!\d)/.test(digitsOnly)) dotIsDecimal = true;
    if (commas === 1 && !/,\d{3}(?!\d)/.test(digitsOnly)) commaIsDecimal = true;
  }

  let decimalSeparator: '.' | ',';
  let groupSeparator: NumberFormatInference['groupSeparator'];

  if (sawBothInOneValue || (dotIsDecimal !== commaIsDecimal && (dotIsDecimal || commaIsDecimal))) {
    decimalSeparator = commaIsDecimal && !dotIsDecimal ? ',' : '.';
  } else if (dotIsGroup && !commaIsGroup) {
    decimalSeparator = ',';
  } else if (commaIsGroup && !dotIsGroup) {
    decimalSeparator = '.';
  } else {
    // Undecidable (e.g. every value is "1,234"). en-US reading.
    decimalSeparator = '.';
  }

  if (spaceGroup) groupSeparator = ' ';
  else if (apostropheGroup) groupSeparator = "'";
  else if (decimalSeparator === '.') groupSeparator = commaCount > 0 ? ',' : null;
  else groupSeparator = dotCount > 0 ? '.' : null;

  return {
    decimalSeparator,
    groupSeparator,
    parenthesesNegative,
    trailingSign,
    strippedSymbols: [...strippedSymbols].sort(),
    convention,
  };
}

/** Rounds a magnitude string's fraction to `scale` digits, half away from zero. */
function scaleFraction(fraction: string, scale: CurrencyScale): { digits: string; carry: boolean } {
  if (fraction.length === scale) return { digits: fraction, carry: false };
  if (fraction.length < scale) return { digits: fraction.padEnd(scale, '0'), carry: false };
  const kept = fraction.slice(0, scale);
  const nextDigit = fraction.charCodeAt(scale) - 48;
  if (nextDigit < 5) return { digits: kept, carry: false };
  // Increment the kept digits as an integer; a full overflow carries into the
  // whole part (0.999 at scale 2 → 1.00).
  if (scale === 0) return { digits: '', carry: true };
  const bumped = (BigInt(kept === '' ? '0' : kept) + 1n).toString();
  if (bumped.length > scale) return { digits: bumped.slice(1), carry: true };
  return { digits: bumped.padStart(scale, '0'), carry: false };
}

/**
 * Checks that every group separator sits between a digit and exactly three
 * digits, as grouping always does: `1,234,567` yes, `1,23` and `1 234,56` no.
 *
 * This is the guard against a locale mismatch turning into a 100x error. Read
 * under a US format, the European `1 234,56` would otherwise have its comma
 * stripped as grouping and come out as 123456.00 rather than 1234.56 — a
 * silently wrong number, which on a bank statement is far worse than a loud
 * failure. Rejecting the cell instead surfaces it as a skipped row the user
 * can see and correct by overriding the format.
 */
function groupingIsWellFormed(text: string, separator: string): boolean {
  let index = text.indexOf(separator);
  while (index !== -1) {
    const before = text.charCodeAt(index - 1) - 48;
    if (!(before >= 0 && before <= 9)) return false;
    for (let i = 1; i <= 3; i += 1) {
      const digit = text.charCodeAt(index + i) - 48;
      if (!(digit >= 0 && digit <= 9)) return false;
    }
    const fourth = text.charCodeAt(index + 4) - 48;
    if (fourth >= 0 && fourth <= 9) return false;
    index = text.indexOf(separator, index + 1);
  }
  return true;
}

/**
 * Parses one money cell into signed minor units.
 *
 * Entirely string-based: the text is stripped to a sign, a whole part and a
 * fraction, then assembled with `BigInt`. No `parseFloat`, so `123.45` is
 * exactly 12345n rather than 12344.999999999998 rounded and hoped for.
 *
 * Returns null for blanks and unparseable cells so the caller can distinguish
 * "no value" from "zero".
 */
export function parseAmountToMinor(
  raw: string,
  format: NumberFormatInference,
  scale: CurrencyScale,
): MinorUnits | null {
  let text = raw.trim();
  if (text === '') return null;

  let negative = false;

  // Accounting parentheses.
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  // DR/CR indicator glued to the amount.
  const drcr = DR_CR_SUFFIX.exec(text);
  if (drcr !== null) {
    const marker = drcr[1]!.toUpperCase();
    if (marker === 'DR' || marker === 'DB' || marker === 'D') negative = true;
    text = text.slice(0, drcr.index).trim();
  }

  text = text.replace(CURRENCY_SYMBOLS, '').trim();

  // Leading or trailing sign.
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1).trim();
  } else if (text.startsWith('+')) {
    text = text.slice(1).trim();
  }
  if (text.endsWith('-')) {
    negative = !negative;
    text = text.slice(0, -1).trim();
  } else if (text.endsWith('+')) {
    text = text.slice(0, -1).trim();
  }

  // Strip grouping, then normalise the decimal mark to '.'.
  if (format.groupSeparator !== null) {
    if (!groupingIsWellFormed(text, format.groupSeparator)) return null;
    text = text.split(format.groupSeparator).join('');
  }
  // Any remaining space is grouping regardless of what was inferred.
  text = text.replace(/[\s ]/g, '');
  if (format.decimalSeparator === ',') {
    text = text.replace(/\./g, '').replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }

  if (!/^\d*(?:\.\d*)?$/.test(text) || text === '' || text === '.') return null;

  const dot = text.indexOf('.');
  const wholeText = dot === -1 ? text : text.slice(0, dot);
  const fractionText = dot === -1 ? '' : text.slice(dot + 1);

  const { digits, carry } = scaleFraction(fractionText, scale);
  const whole = BigInt(wholeText === '' ? '0' : wholeText) + (carry ? 1n : 0n);
  const multiplier = 10n ** BigInt(scale);
  const magnitude = whole * multiplier + BigInt(digits === '' ? '0' : digits);

  return negative ? -magnitude : magnitude;
}

/* ========================================================================== */
/* Stage 5c — transaction assembly                                            */
/* ========================================================================== */

/** Keyword → TRNTYPE, checked against the description and any type column. */
const TYPE_KEYWORDS: readonly (readonly [RegExp, TransactionType])[] = [
  [/\batm\b|cash\s*withdrawal/i, 'ATM'],
  [/\bche(ck|que)\b/i, 'CHECK'],
  [/\b(interest|int\.?\s*(paid|earned))\b/i, 'INT'],
  [/\bdividend\b/i, 'DIV'],
  [/\b(service\s*charge|maintenance\s*fee|monthly\s*fee)\b/i, 'SRVCHG'],
  [/\b(fee|charge|commission|gst|surcharge)\b/i, 'FEE'],
  [/\b(salary|payroll|direct\s*dep(osit)?|neft\s*cr|imps\s*cr)\b/i, 'DIRECTDEP'],
  [/\b(direct\s*deb(it)?|standing\s*order|auto\s*pay|ach\s*deb)\b/i, 'DIRECTDEBIT'],
  [/\b(transfer|xfer|neft|rtgs|imps|upi|wire)\b/i, 'XFER'],
  [/\b(pos|card\s*purchase|debit\s*card)\b/i, 'POS'],
  [/\bdeposit\b/i, 'DEP'],
  [/\bpayment\b/i, 'PAYMENT'],
];

function inferType(description: string, typeCell: string, amount: MinorUnits): TransactionType {
  const haystack = `${typeCell} ${description}`;
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(haystack)) return type;
  }
  return amount < 0n ? 'DEBIT' : 'CREDIT';
}

/** Reads a cell by role, or '' when the role is unmapped. */
function cellFor(row: readonly string[], columns: readonly DetectedColumn[], role: ColumnRole): string {
  const column = columns.find((c) => c.role === role);
  if (column === undefined) return '';
  return (row[column.index] ?? '').trim();
}

function hasRole(columns: readonly DetectedColumn[], role: ColumnRole): boolean {
  return columns.some((c) => c.role === role);
}

/** Chooses the amount convention from which columns were detected. */
export function inferConvention(columns: readonly DetectedColumn[]): AmountConvention {
  if (hasRole(columns, 'debit') && hasRole(columns, 'credit')) return 'debit-credit';
  if (hasRole(columns, 'amount') && hasRole(columns, 'type')) return 'magnitude-with-indicator';
  return 'signed';
}

/** True when the value marks a debit under a DR/CR indicator column. */
function indicatesDebit(indicator: string): boolean {
  return /^\s*(dr|db|d|debit|withdrawal|w)\s*\.?\s*$/i.test(indicator);
}

/* ========================================================================== */
/* Multi-currency detection                                                   */
/* ========================================================================== */

/**
 * Currency symbols mapped to the ISO codes they could denote.
 *
 * A symbol rarely names one currency. `$` is shared by the US, Canada,
 * Australia, Singapore and a dozen more; `¥` covers both JPY and CNY. Treating
 * a symbol as a single code makes `$10.00` and `USD 20.00` look like two
 * different currencies and rejects a perfectly good statement, so each symbol
 * carries its full candidate set instead.
 */
const CURRENCY_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  $: ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'TWD', 'MXN', 'ARS', 'CLP', 'COP', 'UYU', 'BRL', 'FJD', 'JMD', 'NAD', 'TTD', 'XCD', 'BBD', 'BMD', 'BND', 'BSD', 'BZD', 'GYD', 'KYD', 'LRD', 'SBD', 'SRD'],
  '\u20ac': ['EUR'],
  '\u00a3': ['GBP', 'EGP', 'LBP', 'SYP', 'SSP', 'SDG'],
  '\u00a5': ['JPY', 'CNY'],
  '\u20b9': ['INR'],
  '\u20a9': ['KRW', 'KPW'],
  '\u20bd': ['RUB'],
  '\u20aa': ['ILS'],
  '\u20ba': ['TRY'],
  '\u20ab': ['VND'],
  '\u0e3f': ['THB'],
  '\u20b1': ['PHP'],
  '\u20a6': ['NGN'],
  Rs: ['INR', 'PKR', 'LKR', 'NPR', 'MUR', 'SCR'],
  'Rs.': ['INR', 'PKR', 'LKR', 'NPR', 'MUR', 'SCR'],
  R$: ['BRL'],
  'CHF': ['CHF'],
  'kr': ['SEK', 'NOK', 'DKK', 'ISK'],
};

/** The ISO codes a token could denote; a bare code denotes only itself. */
function currencyCandidates(token: string): readonly string[] {
  const trimmed = token.trim();
  const known = CURRENCY_CANDIDATES[trimmed];
  if (known !== undefined) return known;
  return [trimmed.toUpperCase()];
}

/**
 * Renders a token for a user-facing message: `\u20ac` alone is less useful than
 * `\u20ac (EUR)`.
 *
 * The annotation is the first candidate, which each list orders by real-world
 * dominance -- `\u00a3` is overwhelmingly GBP even though EGP and LBP share the
 * glyph. This is display only; the conflict test itself uses the full
 * candidate set and never relies on this guess.
 */
function describeCurrencyToken(token: string): string {
  const primary = currencyCandidates(token)[0];
  return primary !== undefined && primary !== token.trim().toUpperCase()
    ? `${token} (${primary})`
    : token;
}

/**
 * True when no single currency can explain every token.
 *
 * Compatibility is set intersection, not equality: `$` and `USD` intersect at
 * USD and are one currency, while `$` and `EUR` share nothing and are two.
 */
function currencyTokensConflict(tokens: readonly string[]): boolean {
  let possible: Set<string> | null = null;
  for (const token of tokens) {
    const candidates = currencyCandidates(token);
    if (possible === null) {
      possible = new Set(candidates);
      continue;
    }
    possible = new Set(candidates.filter((code) => possible!.has(code)));
    if (possible.size === 0) return true;
  }
  return false;
}

/**
 * Detects a statement that mixes currencies.
 *
 * OFX carries exactly one `<CURDEF>` per statement, so a mixed file has no
 * valid representation: emitting it would silently relabel every foreign row
 * as the default currency and hand the user a reconciliation that is wrong by
 * the exchange rate. Failing loudly is the only correct outcome.
 *
 * Two independent signals, since a file may carry either or both:
 *  - an explicit currency column holding more than one distinct code
 *  - more than one distinct currency symbol embedded in the amount text
 */
export function detectCurrencyCollision(
  columns: readonly DetectedColumn[],
  samples: readonly (readonly string[])[],
  strippedSymbols: readonly string[],
): ParseIssue | null {
  const currencyColumn = columns.find((c) => c.role === 'currency');
  if (currencyColumn !== undefined) {
    const distinct = new Set<string>();
    for (const value of samples[currencyColumn.index] ?? []) {
      const code = value.trim();
      if (code !== '') distinct.add(code);
    }
    if (currencyTokensConflict([...distinct])) {
      return {
        level: 'error',
        code: 'multi-currency',
        message: `The currency column holds more than one currency (${[...distinct].sort().map(describeCurrencyToken).join(', ')}). A single OFX statement can only declare one.`,
        column: currencyColumn.index,
      };
    }
  }

  const distinctSymbols = [...new Set(strippedSymbols)];
  if (currencyTokensConflict(distinctSymbols)) {
    return {
      level: 'error',
      code: 'multi-currency',
      message: `The amounts mix more than one currency (${distinctSymbols.sort().map(describeCurrencyToken).join(', ')}). A single OFX statement can only declare one.`,
    };
  }

  return null;
}

/* ========================================================================== */
/* Public API                                                                 */
/* ========================================================================== */

export interface ParsedRows {
  /** Every data row, already split into cells. Preamble and header removed. */
  readonly rows: readonly string[][];
  readonly headers: readonly string[];
  readonly delimiter: DelimiterInference;
  readonly encoding: EncodingInference;
}

/**
 * Runs decode + delimit + header location, returning raw cells.
 *
 * The body parse runs through Papa's `step` callback rather than its bulk
 * mode. Bulk mode is one uninterruptible synchronous call: on a pathological
 * file it would run past the deadline with no way to stop it. Stepping costs a
 * little throughput but lets the deadline be checked at row boundaries and the
 * parse aborted mid-file, which is what makes the timeout guard real rather
 * than decorative.
 */
export function readRows(bytes: Uint8Array, deadline: Deadline = NO_DEADLINE): ParsedRows {
  const { text, encoding } = decodeBytes(bytes);
  const delimiter = detectDelimiter(text, deadline);

  const all: string[][] = [];
  let sinceCheck = 0;
  Papa.parse<string[]>(text, {
    delimiter: delimiter.delimiter,
    skipEmptyLines: 'greedy',
    step: (result, parser) => {
      const row = result.data;
      if (Array.isArray(row)) all.push(row);
      // Checking the clock per row would dominate the loop; every 1024 rows
      // bounds the overshoot to milliseconds while costing nothing measurable.
      sinceCheck += 1;
      if (sinceCheck >= DEADLINE_CHECK_INTERVAL) {
        sinceCheck = 0;
        if (deadline.expired()) parser.abort();
      }
    },
  });
  deadline.check();

  const headerIndex = delimiter.hasHeaderRow ? delimiter.preambleRows : -1;
  const headers =
    headerIndex === -1
      ? Array.from({ length: delimiter.fieldCount }, (_, i) => `Column ${i + 1}`)
      : (all[headerIndex] ?? []).map((cell) => stripBom(cell).trim());

  const body = all
    .slice(headerIndex + 1)
    // Drop trailing junk rows ("End of statement", totals) that do not fit.
    .filter((row) => row.length === delimiter.fieldCount && row.some((cell) => cell.trim() !== ''));

  return { rows: body, headers, delimiter, encoding };
}

/** Column-major sample of the first `SAMPLE_ROWS` data rows. */
function columnSamples(rows: readonly string[][], width: number): string[][] {
  const samples: string[][] = Array.from({ length: width }, () => []);
  const limit = Math.min(rows.length, SAMPLE_ROWS);
  for (let r = 0; r < limit; r += 1) {
    const row = rows[r]!;
    for (let c = 0; c < width; c += 1) {
      samples[c]!.push(row[c] ?? '');
    }
  }
  return samples;
}

/**
 * The schema returned alongside a fatal issue.
 *
 * Callers that ignore the issue level still get a structurally valid object
 * rather than a null they would have to guard, and `rowCount: 0` makes the
 * emptiness explicit.
 */
function emptySchema(account: AccountIdentity): InferredSchema {
  return {
    encoding: {
      encoding: 'utf-8',
      detectedLabel: null,
      confidence: 0,
      bom: null,
      bomLength: 0,
      fallback: true,
    },
    delimiter: {
      delimiter: ',',
      quoteChar: '"',
      escapeChar: '"',
      lineEnding: '\n',
      fieldCount: 0,
      consistency: 0,
      preambleRows: 0,
      hasHeaderRow: false,
    },
    dateFormat: {
      order: 'MDY',
      separator: null,
      fourDigitYear: false,
      monthIsAlpha: false,
      hasTime: false,
      timeZone: null,
      confidence: 0,
      ambiguous: false,
    },
    numberFormat: {
      decimalSeparator: '.',
      groupSeparator: null,
      parenthesesNegative: false,
      trailingSign: false,
      strippedSymbols: [],
      convention: 'signed',
    },
    columns: [],
    account,
    rowCount: 0,
    sourceDigest: sha1Hex(''),
  };
}

export interface InferenceResult {
  readonly schema: InferredSchema;
  readonly issues: readonly ParseIssue[];
}

/**
 * Infers the complete schema for a statement file.
 *
 * `account` supplies the identity fields the CSV cannot know (routing number,
 * institution, currency scale); everything else is derived from the bytes.
 */
export function inferSchema(
  bytes: Uint8Array,
  account: AccountIdentity,
  deadline: Deadline = NO_DEADLINE,
): InferenceResult {
  const issues: ParseIssue[] = [];

  // Reject wrong-format payloads before the pipeline can manufacture a
  // plausible-looking schema out of binary noise.
  const rejection = validateContentType(bytes);
  if (rejection !== null) {
    return { schema: emptySchema(account), issues: [rejection] };
  }

  const { rows, headers, delimiter, encoding } = readRows(bytes, deadline);

  // A file with no data rows has nothing to infer; one clear message beats the
  // cascade of secondary complaints every later stage would add.
  if (rows.length === 0) {
    return {
      schema: emptySchema(account),
      issues: [
        {
          level: 'error',
          code: 'no-rows',
          message: delimiter.hasHeaderRow
            ? 'The file has a header row but no transactions.'
            : 'No data rows found.',
        },
      ],
    };
  }

  if (encoding.fallback) {
    issues.push({
      level: 'warning',
      code: 'encoding-fallback',
      message: `Could not confidently detect the encoding (best guess: ${encoding.detectedLabel ?? 'none'}); decoded as Windows-1252.`,
    });
  }
  if (delimiter.consistency < 0.9) {
    issues.push({
      level: 'warning',
      code: 'ragged-rows',
      message: `Only ${Math.round(delimiter.consistency * 100)}% of rows have the expected ${delimiter.fieldCount} columns.`,
    });
  }
  if (!delimiter.hasHeaderRow) {
    issues.push({
      level: 'warning',
      code: 'no-header',
      message: 'No header row found; columns were mapped from their contents.',
    });
  }
  const samples = columnSamples(rows, delimiter.fieldCount);
  const columns = mapColumns(headers, samples);

  const dateColumn = columns.find((c) => c.role === 'date') ?? columns.find((c) => c.role === 'postedDate');
  const dateFormat = inferDateFormat(dateColumn === undefined ? [] : samples[dateColumn.index] ?? []);
  if (dateColumn === undefined) {
    issues.push({ level: 'error', code: 'no-date-column', message: 'Could not identify a date column.' });
  } else if (dateFormat.ambiguous) {
    issues.push({
      level: 'warning',
      code: 'ambiguous-date-order',
      message: 'No row has a day above 12, so MM/DD and DD/MM cannot be told apart. Assuming MM/DD/YYYY.',
      column: dateColumn.index,
    });
  } else if (dateFormat.confidence < 0.95) {
    issues.push({
      level: 'warning',
      code: 'unparsed-dates',
      message: `${Math.round((1 - dateFormat.confidence) * 100)}% of values in the date column are not dates.`,
      column: dateColumn.index,
    });
  }

  const convention = inferConvention(columns);
  const amountSamples: string[] = [];
  for (const role of ['amount', 'debit', 'credit', 'balance'] as const) {
    const column = columns.find((c) => c.role === role);
    if (column !== undefined) amountSamples.push(...(samples[column.index] ?? []));
  }
  if (amountSamples.length === 0) {
    issues.push({ level: 'error', code: 'no-amount-column', message: 'Could not identify an amount column.' });
  }
  const numberFormat = inferNumberFormat(amountSamples, convention);

  const collision = detectCurrencyCollision(columns, samples, numberFormat.strippedSymbols);
  if (collision !== null) issues.push(collision);

  const schema: InferredSchema = {
    encoding,
    delimiter,
    dateFormat,
    numberFormat,
    columns,
    account,
    rowCount: rows.length,
    sourceDigest: sha1Hex(`${bytes.length}:${headers.join('')}:${rows.length}`),
  };

  return { schema, issues };
}

export interface ParseResult {
  readonly transactions: readonly CanonicalTransaction[];
  readonly issues: readonly ParseIssue[];
}

/**
 * Applies a schema to the file, producing canonical transactions.
 *
 * Rows that cannot be parsed are skipped with a row-scoped issue rather than
 * failing the import — one malformed line in a 900-row statement should not
 * cost the user the other 899.
 */
export function parseTransactions(
  bytes: Uint8Array,
  schema: InferredSchema,
  deadline: Deadline = NO_DEADLINE,
): ParseResult {
  const { rows } = readRows(bytes, deadline);
  const { columns, dateFormat, numberFormat, account } = schema;
  const scale: CurrencyScale = account.scale;
  const issues: ParseIssue[] = [];
  const transactions: CanonicalTransaction[] = [];

  const currenciesSeen = new Set<string>();

  for (let i = 0; i < rows.length; i += 1) {
    if (i % DEADLINE_CHECK_INTERVAL === 0) deadline.check();
    const row = rows[i]!;

    const dateCell = cellFor(row, columns, 'date') || cellFor(row, columns, 'postedDate');
    const datePosted = parseDate(dateCell, dateFormat);
    if (datePosted === null) {
      issues.push({
        level: 'warning',
        code: 'bad-date',
        message: `Skipped row: "${dateCell}" is not a date.`,
        row: i,
      });
      continue;
    }

    const amount = resolveAmount(row, columns, numberFormat, scale);
    if (amount === null) {
      issues.push({
        level: 'warning',
        code: 'bad-amount',
        message: 'Skipped row: no parseable amount.',
        row: i,
      });
      continue;
    }

    const description = cellFor(row, columns, 'description') || cellFor(row, columns, 'payee');
    const memo = cellFor(row, columns, 'memo');
    const checkNumber = cellFor(row, columns, 'checkNumber');
    const referenceNumber = cellFor(row, columns, 'referenceNumber');
    const balanceCell = cellFor(row, columns, 'balance');
    const balance = balanceCell === '' ? null : parseAmountToMinor(balanceCell, numberFormat, scale);
    const currencyCell = cellFor(row, columns, 'currency');
    const userDateCell = hasRole(columns, 'date') ? cellFor(row, columns, 'postedDate') : '';
    const dateUser = userDateCell === '' ? null : parseDate(userDateCell, dateFormat);
    const parts = parseDateParts(dateCell);

    transactions.push({
      sourceRow: i,
      datePosted,
      type: inferType(description, cellFor(row, columns, 'type'), amount),
      amount,
      currency: currencyCell === '' ? account.currency : currencyCell.toUpperCase(),
      scale,
      // NAME must never be empty; fall back to the memo, then a placeholder.
      name: description !== '' ? description : memo !== '' ? memo : 'TRANSACTION',
      ...(dateFormat.hasTime && parts?.time != null ? { timePosted: parts.time } : {}),
      ...(dateUser !== null ? { dateUser } : {}),
      ...(memo !== '' && memo !== description ? { memo } : {}),
      ...(checkNumber !== '' ? { checkNumber } : {}),
      ...(referenceNumber !== '' ? { referenceNumber } : {}),
      ...(balance !== null ? { balance } : {}),
    });

    currenciesSeen.add(currencyCell === '' ? account.currency : currencyCell.toUpperCase());
  }

  // The sample-based check in `inferSchema` only sees the first 200 rows; a
  // currency that first appears on row 5000 has to be caught here.
  if (currencyTokensConflict([...currenciesSeen])) {
    issues.push({
      level: 'error',
      code: 'multi-currency',
      message: `The file mixes ${[...currenciesSeen].sort().join(', ')}. A single OFX statement can only declare one currency.`,
    });
  }

  return { transactions, issues };
}

/**
 * Normalises the row's amount to a single signed value in minor units.
 *
 * Handles all four conventions:
 *  - `signed`                   one column, negatives are debits
 *  - `signed-inverted`          one column, positives are debits
 *  - `debit-credit`             two columns of positive magnitudes
 *  - `magnitude-with-indicator` one magnitude column plus a DR/CR column
 */
function resolveAmount(
  row: readonly string[],
  columns: readonly DetectedColumn[],
  format: NumberFormatInference,
  scale: CurrencyScale,
): MinorUnits | null {
  if (format.convention === 'debit-credit') {
    const debit = parseAmountToMinor(cellFor(row, columns, 'debit'), format, scale);
    const credit = parseAmountToMinor(cellFor(row, columns, 'credit'), format, scale);
    // Both columns hold positive magnitudes; the column decides the sign.
    // Some exports fill both with 0 — treat that as "the other one wins".
    if (debit !== null && debit !== 0n) return debit > 0n ? -debit : debit;
    if (credit !== null && credit !== 0n) return credit < 0n ? -credit : credit;
    if (debit === null && credit === null) return null;
    return 0n;
  }

  const amount = parseAmountToMinor(cellFor(row, columns, 'amount'), format, scale);
  if (amount === null) return null;

  if (format.convention === 'magnitude-with-indicator') {
    const magnitude = amount < 0n ? -amount : amount;
    return indicatesDebit(cellFor(row, columns, 'type')) ? -magnitude : magnitude;
  }

  return format.convention === 'signed-inverted' ? -amount : amount;
}
