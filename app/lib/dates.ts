/**
 * Preview-time date reading. Like `numeric.ts`, this is a stand-in for the
 * worker's `inferDateFormat`/`parseDate` pair: it decides day/month order from
 * the whole column rather than per value, and refuses to guess when the
 * column is genuinely ambiguous.
 */

export type DateOrder = 'ISO' | 'DMY' | 'MDY' | 'AMBIGUOUS' | 'UNKNOWN';

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

interface Tokens {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  /** Set when a month name resolved position b, e.g. "12 Mar 2024". */
  readonly alphaMonth: boolean;
  /** Set when the first token is a four-digit year. */
  readonly isoish: boolean;
}

function tokenise(raw: string): Tokens | null {
  const value = raw.trim();
  if (value === '') return null;

  // Compact YYYYMMDD.
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compact) {
    return {
      a: Number(compact[1]),
      b: Number(compact[2]),
      c: Number(compact[3]),
      alphaMonth: false,
      isoish: true,
    };
  }

  // Drop any time-of-day component before splitting.
  const dateOnly = value.split(/[T ]/)[0] ?? value;
  const parts = dateOnly.split(/[/\-.]/).filter((part) => part !== '');
  if (parts.length !== 3) return null;

  const [p0, p1, p2] = parts;
  if (p0 === undefined || p1 === undefined || p2 === undefined) return null;

  const alpha = MONTHS[p1.slice(0, 3).toLowerCase()];
  if (alpha !== undefined) {
    const day = Number(p0);
    const year = Number(p2);
    if (!Number.isInteger(day) || !Number.isInteger(year)) return null;
    return { a: day, b: alpha, c: year, alphaMonth: true, isoish: false };
  }

  if (!/^\d+$/.test(p0) || !/^\d+$/.test(p1) || !/^\d+$/.test(p2)) return null;
  return {
    a: Number(p0),
    b: Number(p1),
    c: Number(p2),
    alphaMonth: false,
    isoish: p0.length === 4,
  };
}

/** Decide one order for the whole column. */
export function inferOrder(values: readonly string[]): DateOrder {
  let seen = 0;
  let iso = 0;
  let dmyOnly = 0;
  let mdyOnly = 0;

  for (const value of values) {
    const tokens = tokenise(value);
    if (!tokens) continue;
    seen += 1;

    if (tokens.isoish) {
      iso += 1;
      continue;
    }
    if (tokens.alphaMonth) {
      dmyOnly += 1;
      continue;
    }
    if (tokens.a > 12 && tokens.b <= 12) dmyOnly += 1;
    else if (tokens.b > 12 && tokens.a <= 12) mdyOnly += 1;
  }

  if (seen === 0) return 'UNKNOWN';
  if (iso === seen) return 'ISO';
  if (dmyOnly > 0 && mdyOnly === 0) return 'DMY';
  if (mdyOnly > 0 && dmyOnly === 0) return 'MDY';
  if (dmyOnly > 0 && mdyOnly > 0) return 'UNKNOWN';
  return 'AMBIGUOUS';
}

/** Days since epoch, for ordering only. Null when unparseable. */
export function toOrdinal(raw: string, order: DateOrder): number | null {
  const tokens = tokenise(raw);
  if (!tokens) return null;

  let year: number;
  let month: number;
  let day: number;

  if (tokens.isoish) {
    year = tokens.a;
    month = tokens.b;
    day = tokens.c;
  } else if (tokens.alphaMonth) {
    day = tokens.a;
    month = tokens.b;
    year = tokens.c;
  } else if (order === 'MDY') {
    month = tokens.a;
    day = tokens.b;
    year = tokens.c;
  } else if (order === 'DMY') {
    day = tokens.a;
    month = tokens.b;
    year = tokens.c;
  } else {
    return null;
  }

  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** True when the value tokenises into something date-shaped at all. */
export function looksLikeDate(raw: string): boolean {
  return tokenise(raw) !== null;
}
