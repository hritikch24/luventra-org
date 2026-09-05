/**
 * Canonical types for the statement-conversion worker pipeline.
 *
 * Money is NEVER represented as a JS number. All amounts are `bigint` in the
 * account currency's minor unit (cents/paise), together with an explicit
 * `scale` (number of minor-unit digits) so that JPY (scale 0), USD (scale 2)
 * and BHD (scale 3) all round-trip byte-exactly.
 */

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/** Amount in minor units. Negative = debit/withdrawal, positive = credit/deposit. */
export type MinorUnits = bigint;

/** Number of digits after the decimal separator for a currency. */
export type CurrencyScale = 0 | 2 | 3;

/** ISO-4217 alphabetic code, e.g. "USD", "INR", "JPY". */
export type CurrencyCode = string;

export interface Money {
  readonly amount: MinorUnits;
  readonly currency: CurrencyCode;
  readonly scale: CurrencyScale;
}

/* -------------------------------------------------------------------------- */
/* Encoding / delimiter / date inference                                      */
/* -------------------------------------------------------------------------- */

/** Encodings the decoder stage is allowed to hand to `TextDecoder`. */
export type SupportedEncoding =
  | 'utf-8'
  | 'utf-16le'
  | 'utf-16be'
  | 'windows-1252'
  | 'iso-8859-1'
  | 'iso-8859-15'
  | 'windows-1251'
  | 'shift_jis'
  | 'gb18030'
  | 'big5'
  | 'euc-kr'
  | 'koi8-r'
  | 'ibm866'
  | 'ascii';

export type ByteOrderMark = 'utf-8' | 'utf-16le' | 'utf-16be' | 'utf-32le' | 'utf-32be' | null;

export interface EncodingInference {
  /** Encoding actually used to decode the byte buffer. */
  readonly encoding: SupportedEncoding;
  /** Raw label reported by jschardet, before normalisation. */
  readonly detectedLabel: string | null;
  /** jschardet confidence in [0, 1]; 1 when a BOM settled it. */
  readonly confidence: number;
  /** BOM found at offset 0, if any. Stripped before decoding. */
  readonly bom: ByteOrderMark;
  /** Bytes consumed by the BOM (0 when absent). */
  readonly bomLength: number;
  /** True when detection fell back to the default rather than deciding. */
  readonly fallback: boolean;
}

export type Delimiter = ',' | ';' | '\t' | '|' | '^' | '~';

export type LineEnding = '\r\n' | '\n' | '\r';

export interface DelimiterInference {
  readonly delimiter: Delimiter;
  readonly quoteChar: '"' | "'";
  readonly escapeChar: '"' | '\\';
  readonly lineEnding: LineEnding;
  /** Field count that the majority of scanned rows agreed on. */
  readonly fieldCount: number;
  /** Fraction of scanned rows matching `fieldCount`, in [0, 1]. */
  readonly consistency: number;
  /** Rows skipped as preamble before the header row (bank blurb, filters, …). */
  readonly preambleRows: number;
  readonly hasHeaderRow: boolean;
}

/** Ordered day/month/year token layout of a date column. */
export type DateOrder = 'DMY' | 'MDY' | 'YMD' | 'YDM';

export interface DateFormatInference {
  readonly order: DateOrder;
  /** Literal separator between date parts; null for compact forms (YYYYMMDD). */
  readonly separator: '/' | '-' | '.' | ' ' | null;
  /** Four-digit years present in the sample. */
  readonly fourDigitYear: boolean;
  /** Month rendered as a name/abbreviation ("Jan", "January") rather than digits. */
  readonly monthIsAlpha: boolean;
  /** True when a time-of-day component follows the date. */
  readonly hasTime: boolean;
  /** IANA zone the statement is anchored to; null means "treat as local/naive". */
  readonly timeZone: string | null;
  /** Fraction of sampled values parsed unambiguously under `order`, in [0, 1]. */
  readonly confidence: number;
  /** True when both DMY and MDY parse every sample (all days <= 12). */
  readonly ambiguous: boolean;
}

/* -------------------------------------------------------------------------- */
/* Column detection                                                           */
/* -------------------------------------------------------------------------- */

/** Semantic role a source column was mapped to. */
export type ColumnRole =
  | 'date'
  | 'postedDate'
  | 'description'
  | 'memo'
  | 'payee'
  | 'checkNumber'
  | 'referenceNumber'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'balance'
  | 'currency'
  | 'category'
  | 'type'
  | 'ignored';

export interface DetectedColumn {
  /** Zero-based index into the parsed row array. */
  readonly index: number;
  /** Header text as it appeared in the file (trimmed, original case). */
  readonly header: string;
  readonly role: ColumnRole;
  /** Heuristic score in [0, 1] for this role assignment. */
  readonly confidence: number;
  /** True when the user overrode the heuristic mapping. */
  readonly userAssigned: boolean;
}

/** How signed amounts are encoded in the source file. */
export type AmountConvention =
  /** One signed column: negatives are debits. */
  | 'signed'
  /** One signed column whose sign is inverted relative to `signed`. */
  | 'signed-inverted'
  /** Separate debit and credit columns, both holding positive magnitudes. */
  | 'debit-credit'
  /** One magnitude column plus a separate DR/CR indicator column. */
  | 'magnitude-with-indicator';

export interface NumberFormatInference {
  readonly decimalSeparator: '.' | ',';
  /** Thousands separator; U+00A0 covers the fr/ru non-breaking-space style. */
  readonly groupSeparator: ',' | '.' | ' ' | "'" | '\u00A0' | null;
  /** Negatives written as "(123.45)" rather than "-123.45". */
  readonly parenthesesNegative: boolean;
  /** Trailing sign, e.g. "123.45-" (common in mainframe exports). */
  readonly trailingSign: boolean;
  /** Currency symbols/codes to strip before parsing, e.g. ["$", "USD", "₹"]. */
  readonly strippedSymbols: readonly string[];
  readonly convention: AmountConvention;
}

/* -------------------------------------------------------------------------- */
/* Full inferred schema                                                       */
/* -------------------------------------------------------------------------- */

export interface AccountIdentity {
  /** Routing/sort/IFSC code. Empty string when unknown. */
  readonly bankId: string;
  /** Account number as it should appear in ACCTID. */
  readonly accountId: string;
  readonly accountType: OfxAccountType;
  readonly currency: CurrencyCode;
  readonly scale: CurrencyScale;
  /** Institution display name, used for ORG in the OFX signon block. */
  readonly institution: string;
  /** Institution numeric id, used for FID in the OFX signon block. */
  readonly fid: string;
}

export type OfxAccountType = 'CHECKING' | 'SAVINGS' | 'MONEYMRKT' | 'CREDITLINE' | 'CD';

export interface InferredSchema {
  readonly encoding: EncodingInference;
  readonly delimiter: DelimiterInference;
  readonly dateFormat: DateFormatInference;
  readonly numberFormat: NumberFormatInference;
  readonly columns: readonly DetectedColumn[];
  readonly account: AccountIdentity;
  /** Total data rows seen (excluding preamble and header). */
  readonly rowCount: number;
  /** Stable digest of the source bytes; feeds deterministic FITID derivation. */
  readonly sourceDigest: string;
}

/* -------------------------------------------------------------------------- */
/* Canonical transaction row                                                  */
/* -------------------------------------------------------------------------- */

/** OFX 1.x TRNTYPE enumeration. */
export type TransactionType =
  | 'CREDIT'
  | 'DEBIT'
  | 'INT'
  | 'DIV'
  | 'FEE'
  | 'SRVCHG'
  | 'DEP'
  | 'ATM'
  | 'POS'
  | 'XFER'
  | 'CHECK'
  | 'PAYMENT'
  | 'CASH'
  | 'DIRECTDEP'
  | 'DIRECTDEBIT'
  | 'REPEATPMT'
  | 'OTHER';

/**
 * A date with no time component and no zone, stored as the exact digits that
 * must be emitted. Keeps the pipeline free of `Date` and its DST hazards.
 */
export interface PlainDate {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  /** 1-31. */
  readonly day: number;
}

export interface PlainTime {
  /** 0-23. */
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** The canonical row every parser stage converges on. */
export interface CanonicalTransaction {
  /** 0-based index of the source data row; ties are broken by it, so ordering is stable. */
  readonly sourceRow: number;
  readonly datePosted: PlainDate;
  /** Time-of-day when the source carried one; omitted otherwise. */
  readonly timePosted?: PlainTime;
  /** Value/settlement date when distinct from `datePosted`. */
  readonly dateUser?: PlainDate;
  readonly type: TransactionType;
  /** Signed amount in minor units: negative = money out. */
  readonly amount: MinorUnits;
  readonly currency: CurrencyCode;
  readonly scale: CurrencyScale;
  /** NAME field, truncated to 32 chars at emit time. */
  readonly name: string;
  /** MEMO field, truncated to 255 chars at emit time. */
  readonly memo?: string;
  readonly checkNumber?: string;
  /** Bank-supplied reference, preferred over a derived hash when unique. */
  readonly referenceNumber?: string;
  /** Running balance after this transaction, when the source provided one. */
  readonly balance?: MinorUnits;
  /** Deterministic transaction id; filled in by the FITID stage. */
  readonly fitId?: string;
}

/** A transaction whose FITID has been assigned. Emitters require this shape. */
export type IdentifiedTransaction = CanonicalTransaction & { readonly fitId: string };

/* -------------------------------------------------------------------------- */
/* Emitter inputs                                                             */
/* -------------------------------------------------------------------------- */

export type OfxDialect = 'ofx' | 'qbo' | 'qfx';

export interface StatementRange {
  readonly start: PlainDate;
  readonly end: PlainDate;
}

export interface OfxBuildOptions {
  readonly account: AccountIdentity;
  readonly transactions: readonly IdentifiedTransaction[];
  /** Defaults to the min/max of `transactions` when omitted. */
  readonly range?: StatementRange;
  /** Closing ledger balance in minor units. Defaults to the last row's balance, else 0n. */
  readonly ledgerBalance?: MinorUnits;
  readonly availableBalance?: MinorUnits;
  /**
   * Fixed server timestamp for DTSERVER/DTASOF/`asof` fields. Required for
   * byte-exact reproducible output; callers pass a value derived from the
   * source data, never `Date.now()`.
   */
  readonly asOf: { readonly date: PlainDate; readonly time: PlainTime };
  /** OFX timezone suffix, e.g. "[-5:EST]" or "[+5.5:IST]". Empty string to omit. */
  readonly timeZoneSuffix: string;
  /** Overrides for the signon block; defaults come from `account`. */
  readonly intuitBid?: string;
  readonly language?: string;
}

/* -------------------------------------------------------------------------- */
/* Worker message protocol                                                    */
/* -------------------------------------------------------------------------- */

export type ParseIssueLevel = 'info' | 'warning' | 'error';

export interface ParseIssue {
  readonly level: ParseIssueLevel;
  readonly code: string;
  readonly message: string;
  /** 0-based source data row, when the issue is row-scoped. */
  readonly row?: number;
  readonly column?: number;
}

/**
 * Emitter configuration the transaction rows cannot supply.
 *
 * Only `accountId` is required; every other field has a deterministic default,
 * so the UI can emit a valid file from an account number alone. Lives here
 * rather than in `emitter.ts` because it crosses the worker boundary as part
 * of `WorkerRequest`.
 */
export interface SchemaMeta {
  /** Account number, written to `<ACCTID>`. Also the first FITID component. */
  readonly accountId: string;
  /** Routing / sort / IFSC code, written to `<BANKID>`. Default: ''. */
  readonly bankId?: string;
  /** Default: 'CHECKING'. */
  readonly accountType?: OfxAccountType;
  /** ISO-4217 code. Default: 'USD'. */
  readonly currency?: CurrencyCode;
  /** Minor-unit digits. Default: 2. */
  readonly scale?: CurrencyScale;
  /** Institution name for `<ORG>`. Default: 'BANK'. */
  readonly institution?: string;
  /** Institution id for `<FID>`. Default: '0000'. */
  readonly fid?: string;
  /** `<INTU.BID>` for QBO/QFX. Default: `fid`. */
  readonly intuitBid?: string;
  /** Default: 'ENG'. */
  readonly language?: string;
  /** OFX timezone suffix, e.g. '[-5:EST]'. Default: '[0:GMT]'. */
  readonly timeZoneSuffix?: string;
  /** Statement period. Default: the min/max posted date across the rows. */
  readonly range?: StatementRange;
  /** Closing balance. Default: the last row carrying one, else 0. */
  readonly ledgerBalance?: MinorUnits;
  readonly availableBalance?: MinorUnits;
  /**
   * Server timestamp for `<DTSERVER>` / `<DTASOF>`.
   * Default: the statement's last posted date at 00:00:00 — deliberately not
   * the wall clock, so output stays reproducible.
   */
  readonly asOf?: { readonly date: PlainDate; readonly time: PlainTime };
}

/**
 * Main thread -> worker.
 *
 * `bytes` is the raw file as read by `FileReader`/`File.arrayBuffer()` — the
 * undecoded buffer, not a string, because encoding detection needs the actual
 * bytes. Transfer it rather than copying it.
 */
export type WorkerRequest =
  /** Sniff the file and report the schema, so the UI can show a mapping preview. */
  | { readonly kind: 'inspect'; readonly id: string; readonly bytes: ArrayBuffer }
  /**
   * Parse and emit. `schema` is what `inspect` returned, optionally with the
   * user's column/date/number overrides applied; omit it to re-infer.
   */
  | {
      readonly kind: 'convert';
      readonly id: string;
      readonly bytes: ArrayBuffer;
      readonly meta: SchemaMeta;
      readonly dialect: OfxDialect;
      readonly schema?: InferredSchema;
      /** Optional download filename; defaults to `statement.<dialect>`. */
      readonly filename?: string;
    };

/** Worker -> main thread. */
export type WorkerResponse =
  | {
      readonly kind: 'inspected';
      readonly id: string;
      readonly schema: InferredSchema;
      /** First rows as parsed, for the mapping preview table. */
      readonly preview: readonly (readonly string[])[];
      readonly issues: readonly ParseIssue[];
    }
  | {
      readonly kind: 'converted';
      readonly id: string;
      /** The emitted document. ASCII, CRLF line endings, leaves unclosed. */
      readonly document: string;
      /** The same document as bytes, ready for a Blob. Transferred, not copied. */
      readonly bytes: ArrayBuffer;
      readonly filename: string;
      readonly transactionCount: number;
      /** Rows skipped and other non-fatal findings. */
      readonly issues: readonly ParseIssue[];
    }
  | {
      readonly kind: 'failed';
      readonly id: string;
      /** Always at least one entry, the first being the fatal one. */
      readonly issues: readonly ParseIssue[];
    };
