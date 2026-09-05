/**
 * Minor-unit money helpers. Every function is total and integer-only: no
 * `Number` ever touches an amount, so nothing here can drift by a cent.
 */

import type { CurrencyScale, MinorUnits, PlainDate, PlainTime } from './types';

const POW10: readonly bigint[] = [1n, 10n, 100n, 1000n];

/**
 * Renders minor units as an OFX decimal string: a leading '-' for negatives,
 * a '.' decimal point, no grouping, and exactly `scale` fraction digits.
 *
 *   formatMinor(-12345n, 2) === "-123.45"
 *   formatMinor(5n, 2)      === "0.05"
 *   formatMinor(1200n, 0)   === "1200"
 */
export function formatMinor(amount: MinorUnits, scale: CurrencyScale): string {
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;
  if (scale === 0) {
    return (negative ? '-' : '') + magnitude.toString();
  }
  const divisor = POW10[scale]!;
  const whole = magnitude / divisor;
  const fraction = magnitude % divisor;
  const fractionText = fraction.toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fractionText}`;
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, '0');
}

/** `YYYYMMDD`, the OFX short date form. */
export function formatDate(date: PlainDate): string {
  return `${pad(date.year, 4)}${pad(date.month, 2)}${pad(date.day, 2)}`;
}

/**
 * `YYYYMMDDHHMMSS` plus the caller's timezone suffix (e.g. `[-5:EST]`).
 * Pass an empty suffix to omit it.
 */
export function formatDateTime(date: PlainDate, time: PlainTime, timeZoneSuffix: string): string {
  return `${formatDate(date)}${pad(time.hour, 2)}${pad(time.minute, 2)}${pad(time.second, 2)}${timeZoneSuffix}`;
}

/** Orders two plain dates: negative when `a` precedes `b`. */
export function compareDates(a: PlainDate, b: PlainDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}
