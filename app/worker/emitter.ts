/**
 * String-returning OFX 1.x / QBO / QFX emitter.
 *
 * This is the ergonomic front door over `ofx.ts`: it takes canonical rows plus
 * a loose `SchemaMeta` bag, fills in deterministic defaults, derives FITIDs,
 * and hands back the document as a string. `ofx.ts` remains the byte-level
 * authority — everything here funnels through its SGML writer, so the two can
 * never disagree about the wire format.
 *
 * ## The three rules that make or break the file
 *
 * 1. **SGML, not XML — but only leaves are unclosed.** `<TRNTYPE>DEBIT` has no
 *    close tag. *Aggregates must still be closed*: `<STMTTRN>` … `</STMTTRN>`,
 *    `<OFX>` … `</OFX>`. Leaving an aggregate open is not "more SGML", it is a
 *    parse error — the OFX 1.0.2 DTD ends every aggregate explicitly, and
 *    QuickBooks' parser needs those close tags to know where a transaction
 *    stops. The writer in `ofx.ts` enforces this structurally: `leaf()` cannot
 *    emit a close tag, and `close()` throws on a mismatched aggregate.
 * 2. **CRLF everywhere.** Header block, body, and the line after `</OFX>`.
 *    A bare `\n` gets the file rejected on import.
 * 3. **ASCII header block**, terminated by exactly one blank line before the
 *    first `<OFX>`.
 *
 * ## Determinism
 *
 * Nothing here reads the clock. `SchemaMeta.asOf` defaults to the statement's
 * own last transaction date rather than "now", so converting the same CSV
 * twice — on different days, on different machines — produces byte-identical
 * output. That is what makes re-import idempotent.
 */

import { buildOfxDocument, encodeAscii } from './ofx';
import { sha1Hex } from './sha1';
import { compareDates, formatDate, formatMinor } from './money';
import type {
  AccountIdentity,
  CanonicalTransaction,
  CurrencyScale,
  SchemaMeta,
  IdentifiedTransaction,
  MinorUnits,
  OfxBuildOptions,
  OfxDialect,
  PlainDate,
  PlainTime,
} from './types';

export type { SchemaMeta } from './types';

/* ========================================================================== */
/* Meta                                                                       */
/* ========================================================================== */

const MIDNIGHT: PlainTime = { hour: 0, minute: 0, second: 0 };
const EPOCH: PlainDate = { year: 1970, month: 1, day: 1 };

function resolveAccount(meta: SchemaMeta): AccountIdentity {
  return {
    bankId: meta.bankId ?? '',
    accountId: meta.accountId,
    accountType: meta.accountType ?? 'CHECKING',
    currency: meta.currency ?? 'USD',
    scale: meta.scale ?? 2,
    institution: meta.institution ?? 'BANK',
    fid: meta.fid ?? '0000',
  };
}

/** Latest posted date in the batch; the epoch when there are no rows. */
function latestDate(transactions: readonly CanonicalTransaction[]): PlainDate {
  let latest: PlainDate | null = null;
  for (const txn of transactions) {
    if (latest === null || compareDates(txn.datePosted, latest) > 0) latest = txn.datePosted;
  }
  return latest ?? EPOCH;
}

/* ========================================================================== */
/* FITID                                                                      */
/* ========================================================================== */

/**
 * The single FITID strategy for the codebase:
 *
 *     sha1(accountId|postedDate|amountMinor|memo).slice(0, 32)
 *
 * Personal-finance apps (QuickBooks, Quicken, GnuCash) deduplicate imported
 * transactions on FITID, so this has exactly two obligations:
 *
 *  - **Stable.** Converting the same statement twice, on any machine, on any
 *    day, must produce the same id — otherwise a re-import duplicates every
 *    row. Nothing in the tuple is derived from the clock, the file's byte
 *    offset, or row position.
 *  - **Distinct.** Two different transactions must never share an id, or the
 *    importer silently swallows the second one.
 *
 * Those two pull against each other for genuine same-day duplicates (two
 * identical coffees), which are identical under the tuple yet are separate
 * transactions. `resolveCollisions` handles that with a deterministic `-2`,
 * `-3` suffix rather than a random string, so the pair stays reproducible.
 */
const FITID_LENGTH = 32;

/** Digits of the posted date, `YYYYMMDD` — the tuple's second component. */
function fitIdDate(date: PlainDate): string {
  return formatDate(date);
}

/**
 * Computes the base FITID for one transaction.
 *
 * `amountMinor` is stringified from the `bigint` via `formatMinor`, never a
 * float, so `-3.20` hashes identically on every run.
 */
export function computeFitId(
  accountId: string,
  postedDate: PlainDate,
  amountMinor: MinorUnits,
  scale: CurrencyScale,
  memo: string,
): string {
  const tuple = `${accountId}|${fitIdDate(postedDate)}|${formatMinor(amountMinor, scale)}|${memo.trim().toUpperCase()}`;
  return sha1Hex(tuple).slice(0, FITID_LENGTH).toUpperCase();
}

/** The descriptive text a transaction is identified by: memo, else name. */
function memoFor(txn: CanonicalTransaction): string {
  return txn.memo !== undefined && txn.memo !== '' ? txn.memo : txn.name;
}

/**
 * Stamps a FITID onto every row, preserving input order.
 *
 * Rows identical under the tuple get `-2`, `-3`, … appended in the order they
 * appear. The suffix is positional within the duplicate group, not within the
 * file, so appending next month's rows never renumbers this month's — the
 * property that keeps re-imports idempotent.
 *
 * A row that already carries a `fitId` keeps it: the parser may have lifted a
 * bank-supplied reference, which is a better identity than anything derived.
 */
export function withFitIds(
  accountId: string,
  scale: CurrencyScale,
  transactions: readonly CanonicalTransaction[],
): IdentifiedTransaction[] {
  const occurrences = new Map<string, number>();
  const out: IdentifiedTransaction[] = [];

  for (const txn of transactions) {
    const base =
      txn.fitId !== undefined && txn.fitId !== ''
        ? txn.fitId
        : computeFitId(accountId, txn.datePosted, txn.amount, scale, memoFor(txn));

    const seen = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, seen);
    // First occurrence keeps the bare hash; later ones get -2, -3, ...
    out.push({ ...txn, fitId: seen === 1 ? base : `${base}-${seen}` });
  }

  return out;
}

/* ========================================================================== */
/* Emitters                                                                   */
/* ========================================================================== */

function toBuildOptions(
  transactions: readonly CanonicalTransaction[],
  meta: SchemaMeta,
): OfxBuildOptions {
  const account = resolveAccount(meta);
  const identified = withFitIds(account.accountId, account.scale, transactions);
  const asOf = meta.asOf ?? { date: latestDate(transactions), time: MIDNIGHT };

  return {
    account,
    transactions: identified,
    asOf,
    timeZoneSuffix: meta.timeZoneSuffix ?? '[0:GMT]',
    ...(meta.range !== undefined ? { range: meta.range } : {}),
    ...(meta.ledgerBalance !== undefined ? { ledgerBalance: meta.ledgerBalance } : {}),
    ...(meta.availableBalance !== undefined ? { availableBalance: meta.availableBalance } : {}),
    ...(meta.intuitBid !== undefined ? { intuitBid: meta.intuitBid } : {}),
    ...(meta.language !== undefined ? { language: meta.language } : {}),
  };
}

/**
 * Builds an OFX 1.0.2 document.
 *
 * Returns the document as a string; every character is ASCII, and every line
 * ends with CRLF including the last. Use `toBytes` when writing to a Blob —
 * it guarantees the 1:1 byte mapping rather than trusting the caller's
 * encoder.
 */
export function buildOFX(transactions: readonly CanonicalTransaction[], meta: SchemaMeta): string {
  return buildOfxDocument(toBuildOptions(transactions, meta), 'ofx');
}

/**
 * QuickBooks Web Connect (`.qbo`).
 *
 * Same SGML as OFX plus the `<INTU.BID>` routing tag in the signon block,
 * without which QuickBooks rejects the file outright.
 */
export function buildQBO(transactions: readonly CanonicalTransaction[], meta: SchemaMeta): string {
  return buildOfxDocument(toBuildOptions(transactions, meta), 'qbo');
}

/** Quicken Web Connect (`.qfx`). Same wire format as QBO. */
export function buildQFX(transactions: readonly CanonicalTransaction[], meta: SchemaMeta): string {
  return buildOfxDocument(toBuildOptions(transactions, meta), 'qfx');
}

/** Dispatches to the emitter for `dialect`. */
export function buildDocument(
  transactions: readonly CanonicalTransaction[],
  meta: SchemaMeta,
  dialect: OfxDialect,
): string {
  return buildOfxDocument(toBuildOptions(transactions, meta), dialect);
}

/**
 * Encodes a built document to bytes for download.
 *
 * Not `TextEncoder`: that would emit UTF-8 multi-byte sequences for anything
 * non-ASCII, contradicting the `ENCODING:USASCII` the header declares.
 */
export function toBytes(document: string): Uint8Array {
  return encodeAscii(document);
}
