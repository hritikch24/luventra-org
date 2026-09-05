/**
 * Best-effort numeric reading for preview-time checks only.
 *
 * The authoritative conversion is `parseAmountToMinor` in the worker, which
 * works from an inferred `NumberFormatInference` and returns bigint minor
 * units. This module exists because the pre-flight panel has to say something
 * useful before that inference has run. It returns `null` whenever the value
 * is ambiguous rather than guessing, so a check can report "not verified"
 * instead of a false failure.
 */

/** Currency symbols and codes stripped before parsing. */
const SYMBOLS = /[$£€¥₹¢₽₺₩฿]|(?:^|\s)(?:usd|eur|gbp|inr|jpy|aud|cad|chf|cny)(?=\s|$)/gi;

export interface NumericRead {
  readonly value: number;
  /** True when a decimal separator had to be guessed between '.' and ','. */
  readonly ambiguous: boolean;
}

/**
 * Parse one cell. Handles parenthesised negatives, trailing signs, grouped
 * thousands and both decimal conventions.
 */
export function readNumber(raw: string): NumericRead | null {
  let text = raw.trim();
  if (text === '') return null;

  let negative = false;

  // "(1,234.56)" -> negative
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  text = text.replace(SYMBOLS, '').replace(/[\s  ]/g, '');

  // Leading or trailing sign (mainframe exports put it at the end).
  if (text.endsWith('-') || text.endsWith('+')) {
    negative = negative !== text.endsWith('-');
    text = text.slice(0, -1);
  }
  if (text.startsWith('-') || text.startsWith('+')) {
    negative = negative !== text.startsWith('-');
    text = text.slice(1);
  }

  // A trailing DR/CR indicator flips the sign.
  const indicator = /(dr|cr)$/i.exec(text);
  if (indicator) {
    if (indicator[1]?.toLowerCase() === 'dr') negative = !negative;
    text = text.slice(0, -2);
  }

  if (!/^[\d.,']*$/.test(text) || !/\d/.test(text)) return null;

  text = text.replace(/'/g, '');

  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let ambiguous = false;
  let normalised: string;

  if (lastDot === -1 && lastComma === -1) {
    normalised = text;
  } else if (lastDot !== -1 && lastComma !== -1) {
    // Whichever comes last is the decimal separator.
    const decimal = lastDot > lastComma ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    normalised = text.split(group).join('');
    normalised = normalised.replace(decimal, '.');
  } else {
    const sep = lastDot !== -1 ? '.' : ',';
    const tail = text.slice((lastDot !== -1 ? lastDot : lastComma) + 1);
    const occurrences = text.split(sep).length - 1;

    if (occurrences > 1 || tail.length === 3) {
      // "1.234.567" or "1,234" — grouping, not a decimal point. A lone
      // three-digit tail is genuinely ambiguous ("1,234" vs "1.234").
      normalised = text.split(sep).join('');
      ambiguous = occurrences === 1 && tail.length === 3;
    } else {
      normalised = text.replace(sep, '.');
    }
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;

  return { value: negative ? -value : value, ambiguous };
}

/** Convenience wrapper for callers that only need a definite number. */
export function readUnambiguous(raw: string): number | null {
  const read = readNumber(raw);
  if (read === null || read.ambiguous) return null;
  return read.value;
}

/** Round to cents so float drift does not trip equality comparisons. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
