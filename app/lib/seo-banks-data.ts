import type { ColumnRole, DateOrder } from '@/app/worker/types';

/**
 * Bank export profiles for the programmatic SEO pages under `/banks`.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE — read before treating any of this as fact
 * ---------------------------------------------------------------------------
 *
 * These profiles are reconstructed from general knowledge of published export
 * formats. They are NOT transcribed from verified live downloads, and every
 * entry makes specific factual claims about a named real company's product.
 *
 * Bank CSV formats are a moving target. They differ by:
 *   - product   — a checking export is not a credit-card export
 *   - region    — Barclays UK and Barclays US are different institutions
 *   - channel   — web download vs mobile vs the "export to Quicken" path
 *   - date      — banks re-cut these formats without announcement
 *
 * So every entry ships `confidence` and `lastVerified`, and `publishableBanks()`
 * returns only what a human has actually checked against a real file. That is
 * empty until someone does the work, deliberately: an empty SEO section is
 * recoverable, twenty indexed pages making wrong factual claims about named
 * banks is not.
 *
 * TO VERIFY AN ENTRY (about ten minutes each):
 *   1. Download a real CSV export from that bank and product.
 *   2. Diff the header row against `sampleHeaders` — order included.
 *   3. Confirm `dateFormat` and `amountMode` against actual rows.
 *   4. Set `confidence: 'verified'` and stamp `lastVerified` with today.
 *
 * The safety property that makes shipping this survivable: none of it is
 * load-bearing for correctness. The converter reads the real schema from the
 * user's actual file. A wrong entry here degrades a pre-filled mapping hint
 * and some marketing prose; it cannot corrupt anyone's converted output.
 *
 * The `commonGotcha` prose is a different matter — it describes how *this
 * engine* handles a given CSV shape, which our own test suite verifies. That
 * reasoning is sound even where a header list still needs checking.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** How the source encodes transaction direction. */
export type AmountMode = 'single_signed' | 'debit_credit_pair';

/**
 * Trust level of a profile's structural claims.
 *
 * - `verified`   a human diffed this against a real export on `lastVerified`
 * - `likely`     widely documented and stable, but unconfirmed here
 * - `unverified` reconstructed from general knowledge; a starting point only
 */
export type Confidence = 'verified' | 'likely' | 'unverified';

/** One named import failure, rendered as its own section on a bank page. */
export interface BankQuirk {
  readonly title: string;
  readonly body: string;
}

/**
 * A bank's export layout.
 *
 * Carries two names for several fields (`name`/`bankName`,
 * `headers`/`sampleHeaders`, `verified`/`confidence`). That redundancy is
 * deliberate: this module is consumed by pages written against two different
 * vocabularies, and the aliases are derived from one canonical definition by
 * `buildProfile`, so they cannot drift apart.
 */
export interface BankExportProfile {
  /** URL segment: `/banks/<slug>`. */
  readonly slug: string;
  readonly bankName: string;
  /** Alias of `bankName`. */
  readonly name: string;
  /** Human label for the product, e.g. "checking account". */
  readonly accountKind: string;
  /** Alias of `sampleHeaders`. */
  readonly headers: readonly string[];
  /** Normalised header -> engine role, derived from `sampleHeaders`. */
  readonly headerMap: Readonly<Record<string, ColumnRole>>;
  /** The full list of import failures, rendered as sections. */
  readonly quirks: readonly BankQuirk[];
  /** Alias of `confidence === 'verified'`. */
  readonly verified: boolean;
  /** Alias of `lastVerified`, falling back to the compile date. */
  readonly lastReviewed: string;
  /** Full institution name, for prose and metadata. */
  readonly legalName: string;
  /** Which product this profile describes; formats differ per product. */
  readonly product: 'checking' | 'credit-card' | 'combined';
  readonly region: 'US' | 'UK' | 'EU' | 'CA' | 'AU';

  /** The export's header row, in order. Empty when the bank ships no header. */
  readonly sampleHeaders: readonly string[];

  /** Human-facing format string, e.g. "MM/DD/YYYY". */
  readonly dateFormat: string;
  /** The same thing in the engine's vocabulary. */
  readonly dateOrder: DateOrder;

  readonly amountMode: AmountMode;
  /** One-line human description of the sign convention. */
  readonly amountConvention: string;

  /**
   * The deepest single reason this export fails a naive QuickBooks import.
   * A plain-English technical breakdown, not marketing copy.
   */
  readonly commonGotcha: string;

  readonly confidence: Confidence;
  /** ISO date a human last checked this against a real export, else null. */
  readonly lastVerified: string | null;
}

/** What each entry actually declares; the aliases are derived from it. */
type BankInput = Omit<
  BankExportProfile,
  'name' | 'accountKind' | 'headers' | 'headerMap' | 'quirks' | 'verified' | 'lastReviewed'
> & {
  readonly quirks?: readonly BankQuirk[];
  readonly accountKind?: string;
};

/**
 * Canonical key for a header cell.
 *
 * Header text arrives with inconsistent casing, stray whitespace and doubled
 * spaces across exports — and across a single bank's own products — so both
 * the lookup table and the incoming column are folded through this before
 * being compared.
 */
export function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Header keywords to engine roles, most specific first.
 *
 * The map is derived from `sampleHeaders` rather than hand-written per bank.
 * A per-bank role map would be a second set of factual claims to keep in sync
 * with the first; deriving it means a corrected header list yields a corrected
 * preset for free.
 */
const ROLE_KEYWORDS: ReadonlyArray<readonly [ColumnRole, readonly string[]]> = [
  ['postedDate', ['post date', 'posting date', 'posted date', 'completed date', 'settlement date', 'value date']],
  ['date', ['transaction date', 'trans. date', 'trans date', 'txn date', 'started date', 'booking date', 'date']],
  ['debit', ['debit amount', 'debit', 'withdrawals', 'withdrawal', 'money out', 'paid out']],
  ['credit', ['credit amount', 'credit', 'deposits', 'deposit', 'money in', 'paid in']],
  ['balance', ['running bal.', 'running balance', 'closing balance', 'balance (gbp)', 'balance']],
  ['amount', ['transaction amount', 'amount (gbp)', 'local amount', 'amount', 'value']],
  ['checkNumber', ['check or slip #', 'check number', 'cheque number', 'check #']],
  ['referenceNumber', ['transaction id', 'reference no', 'reference', 'number', 'ref']],
  ['currency', ['local currency', 'currency', 'ccy']],
  ['category', ['category split', 'subcategory', 'category']],
  ['type', ['transaction type', 'type', 'details', 'status', 'state']],
  ['memo', ['notes and #tags', 'memo', 'notes', 'note']],
  ['payee', ['counter party', 'counterparty', 'payee', 'card member', 'merchant']],
  ['description', ['transaction description', 'description', 'narration', 'particulars', 'name']],
  // Identifiers that must never reach the exported file.
  ['ignored', ['account number', 'account #', 'card no.', 'card number', 'account', 'product', 'emoji', 'address', 'receipt', 'fee', 'time', 'sort code', 'marker', 'blank']],
];

/** Best-effort role for one header cell, or `ignored` when nothing matches. */
function roleForHeader(header: string): ColumnRole {
  const key = normaliseHeader(header);
  for (const [role, keywords] of ROLE_KEYWORDS) {
    for (const keyword of keywords) {
      if (key === keyword) return role;
    }
  }
  for (const [role, keywords] of ROLE_KEYWORDS) {
    for (const keyword of keywords) {
      if (key.includes(keyword)) return role;
    }
  }
  return 'ignored';
}

/** Builds the normalised header -> role lookup for a profile. */
export function deriveHeaderMap(headers: readonly string[]): Readonly<Record<string, ColumnRole>> {
  const map: Record<string, ColumnRole> = {};
  for (const header of headers) {
    map[normaliseHeader(header)] = roleForHeader(header);
  }
  return map;
}

const ACCOUNT_KIND: Readonly<Record<BankExportProfile['product'], string>> = {
  checking: 'checking account',
  'credit-card': 'credit card',
  combined: 'account statement',
};

/** Date this table was last touched, used when an entry has no review stamp. */
const COMPILED_ON = '2026-09-05';

/** Fills in every derived alias so the two vocabularies cannot drift. */
function buildProfile(input: BankInput): BankExportProfile {
  return {
    ...input,
    name: input.bankName,
    accountKind: input.accountKind ?? ACCOUNT_KIND[input.product],
    headers: input.sampleHeaders,
    headerMap: deriveHeaderMap(input.sampleHeaders),
    quirks: input.quirks ?? [
      { title: 'Why this export breaks a direct import', body: input.commonGotcha },
    ],
    verified: input.confidence === 'verified' && input.lastVerified !== null,
    lastReviewed: input.lastVerified ?? COMPILED_ON,
  };
}

/* -------------------------------------------------------------------------- */
/* Profiles                                                                   */
/* -------------------------------------------------------------------------- */

const RAW_BANKS: readonly BankInput[] = [
  {
    slug: 'chase-to-quickbooks',
    bankName: 'Chase',
    legalName: 'JPMorgan Chase',
    product: 'credit-card',
    region: 'US',
    sampleHeaders: ['Transaction Date', 'Post Date', 'Description', 'Category', 'Type', 'Amount', 'Memo'],
    dateFormat: 'MM/DD/YYYY',
    dateOrder: 'MDY',
    amountMode: 'single_signed',
    amountConvention: 'One signed column — purchases negative, payments positive',
    commonGotcha:
      'Chase ships two date columns and which one you reconcile against changes your books. "Transaction Date" is when the money was spent; "Post Date" is when the bank settled it. They routinely differ by two or three days, so across a month boundary an importer that grabs whichever column it finds first files transactions into the wrong statement period — and nothing errors, because both columns hold perfectly valid dates. The converter maps Transaction Date to DTPOSTED and Post Date to DTUSER so the OFX keeps the distinction. Category and Type have no OFX equivalent and are folded into the memo rather than jammed into the payee, where they would pollute matching rules.',
    confidence: 'likely',
    lastVerified: null,
  },
  {
    slug: 'chase-checking-to-quickbooks',
    bankName: 'Chase Checking',
    legalName: 'JPMorgan Chase',
    product: 'checking',
    region: 'US',
    sampleHeaders: ['Details', 'Posting Date', 'Description', 'Amount', 'Type', 'Balance', 'Check or Slip #'],
    dateFormat: 'MM/DD/YYYY',
    dateOrder: 'MDY',
    amountMode: 'single_signed',
    amountConvention: 'One signed column — debits negative, credits positive',
    commonGotcha:
      'The Chase checking export is a completely different shape from the Chase credit-card export — different headers, an extra Details column, a running Balance — so a mapping saved from one silently mis-maps the other. The column that matters most for bookkeeping is "Check or Slip #": it belongs in the OFX CHECKNUM field, and importers that drop it leave every cleared cheque unmatched during reconciliation, which is exactly the manual work the conversion was supposed to remove.',
    confidence: 'likely',
    lastVerified: null,
  },
  {
    slug: 'bank-of-america-to-quickbooks',
    bankName: 'Bank of America',
    legalName: 'Bank of America',
    product: 'checking',
    region: 'US',
    sampleHeaders: ['Date', 'Description', 'Amount', 'Running Bal.'],
    dateFormat: 'MM/DD/YYYY',
    dateOrder: 'MDY',
    amountMode: 'single_signed',
    amountConvention: 'One signed column — debits negative, credits positive',
    commonGotcha:
      'Bank of America prepends an account summary block — beginning balance, total credits, total debits — above the real header row, separated by a blank line. Almost every importer reads line 1 as the header, finds summary prose where it expected column names, and either fails outright or maps every column one position wrong. The transaction table does not start where the file starts. The converter scans for the first row that reads as column labels rather than values and skips everything above it, which also stops the blank separator line becoming a phantom zero-amount transaction.',
    confidence: 'likely',
    lastVerified: null,
  },
  {
    slug: 'wells-fargo-to-quickbooks',
    bankName: 'Wells Fargo',
    legalName: 'Wells Fargo',
    product: 'checking',
    region: 'US',
    // This export ships no header row; the converter maps columns by content.
    sampleHeaders: [],
    dateFormat: 'MM/DD/YYYY',
    dateOrder: 'MDY',
    amountMode: 'single_signed',
    amountConvention: 'One signed column — debits negative, credits positive',
    commonGotcha:
      'The Wells Fargo CSV has no header row at all. It opens straight into transaction data, five columns wide, one of which is a constant "*" marker carrying no information and another usually empty. Every importer that assumes row 1 is a header consumes a real transaction as its column names — so you silently lose your earliest transaction of the period, and every column ends up labelled with a date and a dollar amount. The converter detects the missing header and maps by content instead: a column of parseable dates is the date, a column of signed decimals is the amount, the longest free-text column is the description.',
    confidence: 'likely',
    lastVerified: null,
  },
  {
    slug: 'amex-to-quickbooks',
    bankName: 'American Express',
    legalName: 'American Express',
    product: 'credit-card',
    region: 'US',
    sampleHeaders: ['Date', 'Description', 'Card Member', 'Account #', 'Amount'],
    dateFormat: 'MM/DD/YYYY',
    dateOrder: 'MDY',
    amountMode: 'single_signed',
    amountConvention: 'Inverted — purchases positive, payments and refunds negative',
    commonGotcha:
      'American Express inverts the sign convention nearly everyone else uses: a purchase is written as a POSITIVE number and a payment or refund as negative, because the export is framed from the issuer’s side of the ledger. Import it raw and every expense books as income and every payment as a charge. The file loads without a single error and the books still balance — to exactly the wrong sign, which is far harder to catch than an outright failure and can survive several closes before anyone notices.',
    confidence: 'likely',
    lastVerified: null,
  },
  {
    slug: 'capital-one-to-quickbooks',
    bankName: 'Capital One',
    legalName: 'Capital One',
    product: 'credit-card',
    region: 'US',
    sampleHeaders: ['Transaction Date', 'Posted Date', 'Card No.', 'Description', 'Category', 'Debit', 'Credit'],
    dateFormat: 'YYYY-MM-DD',
    dateOrder: 'YMD',
    amountMode: 'debit_credit_pair',
    amountConvention: 'Separate Debit and Credit columns, both positive magnitudes',
    commonGotcha:
      'Capital One splits money out and money in into two separate columns, each holding a POSITIVE magnitude with the other left blank. An importer expecting one signed Amount column reads only one of them and produces a statement where every transaction points the same direction. The sign has to come from which column the value sits in, not from the value itself — and the empty side must be read as "absent" rather than zero, or every row gains a phantom 0.00 counterpart. Capital One also uses ISO YYYY-MM-DD rather than US MM/DD/YYYY, so an importer with a hardcoded US format misreads the first two components on every row.',
    confidence: 'likely',
    lastVerified: null,
  },
  {
    slug: 'citibank-to-quickbooks',
    bankName: 'Citibank',
    legalName: 'Citibank',
    product: 'credit-card',
    region: 'US',
    sampleHeaders: ['Status', 'Date', 'Description', 'Debit', 'Credit'],
    dateFormat: 'MM/DD/YYYY',
    dateOrder: 'MDY',
    amountMode: 'debit_credit_pair',
    amountConvention: 'Separate Debit and Credit columns, both positive magnitudes',
    commonGotcha:
      'The Citi export mixes pending transactions in with cleared ones, distinguished only by the Status column. Import the file whole and you book money that has not actually moved and may still change amount or vanish. It compounds on the next export: the same transaction reappears in settled form, and because a settled amount differs from its pending version, no content-based deduplication can recognise it as the same row — so it imports a second time. Filtering on Status before conversion is the only reliable fix.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'pnc-to-quickbooks',
    bankName: 'PNC Bank',
    legalName: 'PNC Bank',
    product: 'checking',
    region: 'US',
    sampleHeaders: ['Date', 'Description', 'Withdrawals', 'Deposits', 'Balance'],
    dateFormat: 'MM/DD/YYYY',
    dateOrder: 'MDY',
    amountMode: 'debit_credit_pair',
    amountConvention: 'Separate Withdrawals and Deposits columns, both positive',
    commonGotcha:
      'PNC uses a Withdrawals/Deposits pair rather than a signed amount, and leaves currency symbols and thousands separators attached to the values ("$1,234.56"). An importer that runs parseFloat over that gets NaN, or far worse, truncates at the comma and books $1.00 in place of $1,234.56 — a 1000x error that produces a perfectly valid-looking transaction. The converter strips symbols and grouping, then validates that a thousands separator actually sits in a thousands position, so a mis-detected locale rejects the row rather than silently scaling it.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'us-bank-to-quickbooks',
    bankName: 'U.S. Bank',
    legalName: 'U.S. Bank',
    product: 'checking',
    region: 'US',
    sampleHeaders: ['Date', 'Transaction', 'Name', 'Memo', 'Amount'],
    dateFormat: 'MM/DD/YYYY',
    dateOrder: 'MDY',
    amountMode: 'single_signed',
    amountConvention: 'One signed column — debits negative, credits positive',
    commonGotcha:
      'U.S. Bank splits the payee across two columns: "Transaction" holds the type (DEBIT, CREDIT, CHECK) and "Name" holds the actual merchant. Importers that map the first text column they find produce a register where every line reads "DEBIT" with no indication of who was paid — technically a successful import, and completely useless for categorisation. Name maps to the OFX NAME field and Transaction is used to derive a real TRNTYPE rather than defaulting everything by sign.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'discover-to-quickbooks',
    bankName: 'Discover',
    legalName: 'Discover',
    product: 'credit-card',
    region: 'US',
    sampleHeaders: ['Trans. Date', 'Post Date', 'Description', 'Amount', 'Category'],
    dateFormat: 'MM/DD/YYYY',
    dateOrder: 'MDY',
    amountMode: 'single_signed',
    amountConvention: 'Issuer convention — purchases positive, payments negative',
    commonGotcha:
      'Discover abbreviates its date header to "Trans. Date", with a period inside the column name. Importers that split header text on punctuation, or match column names against an exact allow-list, fail to recognise it and fall through to treating the date column as unmapped text — leaving the user to map it by hand on every single import. Discover also follows the issuer sign convention where purchases are positive, so amounts need the same inversion as Amex.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'ally-to-quickbooks',
    bankName: 'Ally Bank',
    legalName: 'Ally Bank',
    product: 'checking',
    region: 'US',
    sampleHeaders: ['Date', 'Time', 'Amount', 'Type', 'Description'],
    dateFormat: 'YYYY-MM-DD',
    dateOrder: 'YMD',
    amountMode: 'single_signed',
    amountConvention: 'One signed column — debits negative, credits positive',
    commonGotcha:
      'Ally puts the time of day in its own column, separate from the date. An importer that concatenates them naively produces an unparseable timestamp; one that ignores Time loses the only thing distinguishing several same-day transactions of the same amount. That matters for deduplication — two identical $4.50 coffees on one day are otherwise indistinguishable, and an importer keying on date plus amount will treat the second as a duplicate and drop it. The converter handles the collision with a deterministic transaction-id suffix so both survive.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'barclays-to-quickbooks',
    bankName: 'Barclays',
    legalName: 'Barclays UK',
    product: 'checking',
    region: 'UK',
    sampleHeaders: ['Number', 'Date', 'Account', 'Amount', 'Subcategory', 'Memo'],
    dateFormat: 'DD/MM/YYYY',
    dateOrder: 'DMY',
    amountMode: 'single_signed',
    amountConvention: 'One signed column — debits negative, credits positive',
    commonGotcha:
      'Barclays writes dates as DD/MM/YYYY. QuickBooks US assumes MM/DD/YYYY, so 04/09/2025 imports as 9 April instead of 4 September — and it does NOT error, because both readings are valid dates. Every transaction in the file lands in the wrong month and nothing flags it. This is the most dangerous failure in the entire category precisely because it is silent. The only rows that break the ambiguity are ones where the day exceeds 12, so the converter scans the whole column for such a row and uses it to settle the order for every other row; where no row disambiguates, it says so rather than guessing.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'hsbc-to-quickbooks',
    bankName: 'HSBC',
    legalName: 'HSBC UK',
    product: 'checking',
    region: 'UK',
    sampleHeaders: ['Date', 'Description', 'Amount'],
    dateFormat: 'DD/MM/YYYY',
    dateOrder: 'DMY',
    amountMode: 'single_signed',
    amountConvention: 'One signed column — debits negative, credits positive',
    commonGotcha:
      'The HSBC UK export combines the two worst cases: three bare columns, frequently with no header row to map by, and DD/MM/YYYY dates a US importer will silently misread. With no header, content-based detection is the only way in; with ambiguous dates, the day-above-12 scan is the only way to settle the order. HSBC also quotes description fields containing commas, so a naive split on commas shifts every column right on exactly those rows — usually only a handful in a file, which is what makes it easy to miss.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'natwest-to-quickbooks',
    bankName: 'NatWest',
    legalName: 'NatWest',
    product: 'checking',
    region: 'UK',
    sampleHeaders: ['Date', 'Type', 'Description', 'Value', 'Balance', 'Account Name', 'Account Number'],
    dateFormat: 'DD/MM/YYYY',
    dateOrder: 'DMY',
    amountMode: 'single_signed',
    amountConvention: 'One signed column — debits negative, credits positive',
    commonGotcha:
      'NatWest names its amount column "Value" rather than "Amount", which defeats importers matching on the literal string "amount" — the single most common column rule there is. The file then imports with no amount mapped at all, or, if the importer falls back to "the first numeric column", it latches onto Balance and books running totals as transaction amounts. That second failure looks plausible right up until the register is reconciled.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'lloyds-to-quickbooks',
    bankName: 'Lloyds Bank',
    legalName: 'Lloyds Bank',
    product: 'checking',
    region: 'UK',
    sampleHeaders: [
      'Transaction Date',
      'Transaction Type',
      'Sort Code',
      'Account Number',
      'Transaction Description',
      'Debit Amount',
      'Credit Amount',
      'Balance',
    ],
    dateFormat: 'DD/MM/YYYY',
    dateOrder: 'DMY',
    amountMode: 'debit_credit_pair',
    amountConvention: 'Separate Debit Amount and Credit Amount columns',
    commonGotcha:
      'Lloyds stacks three problems into one file: a Debit/Credit pair instead of a signed amount, DD/MM/YYYY dates, and a Sort Code column formatted like "30-96-26" that has the shape of a hyphenated date. An importer that sniffs columns by content can latch onto the sort code as the date column and produce complete nonsense. The converter prefers an explicit header match over content sniffing precisely so a well-labelled column beats a coincidental pattern.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'monzo-to-quickbooks',
    bankName: 'Monzo',
    legalName: 'Monzo Bank',
    product: 'checking',
    region: 'UK',
    sampleHeaders: [
      'Transaction ID',
      'Date',
      'Time',
      'Type',
      'Name',
      'Emoji',
      'Category',
      'Amount',
      'Currency',
      'Local amount',
      'Local currency',
      'Notes and #tags',
      'Address',
      'Receipt',
      'Description',
      'Category split',
    ],
    dateFormat: 'DD/MM/YYYY',
    dateOrder: 'DMY',
    amountMode: 'single_signed',
    amountConvention: 'One signed column — spending negative, income positive',
    commonGotcha:
      'Monzo exports sixteen columns including a genuine multi-currency pair: Amount/Currency for the settled GBP figure, and "Local amount"/"Local currency" for what the merchant actually charged abroad. An importer that grabs the wrong amount column books foreign-currency figures as GBP — a 50 EUR spend entered as £50, an implied exchange rate of exactly 1.0. OFX carries one currency per statement, so a mixed file has no valid representation; the converter detects more than one currency and refuses rather than relabelling. Monzo does emit a stable Transaction ID, which is a better deduplication key than any hash of date and amount because it survives a later amount correction.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'revolut-to-quickbooks',
    bankName: 'Revolut',
    legalName: 'Revolut',
    product: 'combined',
    region: 'EU',
    sampleHeaders: [
      'Type',
      'Product',
      'Started Date',
      'Completed Date',
      'Description',
      'Amount',
      'Fee',
      'Currency',
      'State',
      'Balance',
    ],
    dateFormat: 'YYYY-MM-DD HH:MM:SS',
    dateOrder: 'YMD',
    amountMode: 'single_signed',
    amountConvention: 'One signed column, plus a SEPARATE Fee column',
    commonGotcha:
      'Revolut is the hardest common case, for three compounding reasons. The Fee column is a separate charge from Amount, so importing only Amount leaves your totals short by every transaction fee in the period — a small, consistent shortfall that is easy to overlook and annoying to find later. A multi-currency account exports all its currencies into one file with a Currency column, which has no valid OFX representation and must be split per currency first. And the State column includes REVERTED and PENDING rows for money that never actually moved.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'starling-to-quickbooks',
    bankName: 'Starling Bank',
    legalName: 'Starling Bank',
    product: 'checking',
    region: 'UK',
    sampleHeaders: ['Date', 'Counter Party', 'Reference', 'Type', 'Amount (GBP)', 'Balance (GBP)'],
    dateFormat: 'DD/MM/YYYY',
    dateOrder: 'DMY',
    amountMode: 'single_signed',
    amountConvention: 'One signed column — debits negative, credits positive',
    commonGotcha:
      'Starling embeds the currency in the column NAME — "Amount (GBP)" — rather than in a separate column or as a symbol on each value. Importers matching headers against "Amount" do not recognise it, and any logic reading a per-row currency finds nothing and falls back to a default that may well be wrong. The payee sits under "Counter Party" rather than Description, Payee or Name, which is a second exact-match miss in the same file.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'td-bank-to-quickbooks',
    bankName: 'TD Bank',
    legalName: 'TD Bank',
    product: 'checking',
    region: 'US',
    sampleHeaders: ['Date', 'Transaction Description', 'Debit', 'Credit', 'Balance'],
    dateFormat: 'MM/DD/YYYY',
    dateOrder: 'MDY',
    amountMode: 'debit_credit_pair',
    amountConvention: 'Separate Debit and Credit columns, unused side left empty',
    commonGotcha:
      'TD Bank uses a Debit/Credit pair where the unused column is left completely empty rather than zero-filled. Importers that coerce an empty cell to 0 rather than treating it as absent either produce a 0.00 transaction for every row, or book each transaction twice — once as a zero and once as the real value. Telling "no value" apart from "a genuine zero" is the entire problem, which is why the converter’s amount parser returns null for an empty cell rather than 0.',
    confidence: 'unverified',
    lastVerified: null,
  },
  {
    slug: 'santander-to-quickbooks',
    bankName: 'Santander',
    legalName: 'Santander UK',
    product: 'checking',
    region: 'UK',
    sampleHeaders: ['Date', 'Description', 'Amount', 'Balance'],
    dateFormat: 'DD/MM/YYYY',
    dateOrder: 'DMY',
    amountMode: 'single_signed',
    amountConvention: 'One signed column — debits negative, credits positive',
    commonGotcha:
      'The Santander UK export opens with several lines of account preamble — the statement date range, the account number, the opening balance — before the transaction table begins, and writes amounts with a trailing currency code rather than a leading symbol. Importers read the preamble as data, and the trailing code defeats numeric parsing on every row. The converter locates the first row that reads as column labels and skips everything above it, and strips trailing currency codes before parsing.',
    confidence: 'unverified',
    lastVerified: null,
  },
];

export const SEO_BANKS: readonly BankExportProfile[] = RAW_BANKS.map(buildProfile);

/* -------------------------------------------------------------------------- */
/* Accessors                                                                  */
/* -------------------------------------------------------------------------- */


/**
 * The only list that should feed `generateStaticParams`.
 *
 * Returns profiles a human has checked against a real export. It is empty
 * until someone does that work — deliberately. See the provenance note above.
 */
export function publishableBanks(): readonly BankExportProfile[] {
  return SEO_BANKS.filter((bank) => bank.confidence === 'verified' && bank.lastVerified !== null);
}

/**
 * Verified plus `likely` entries.
 *
 * Provided as a deliberate one-line escape hatch: pointing the pages here
 * ships the well-documented layouts while the rest are still being checked.
 * Only do that alongside a visible on-page caveat, since these remain
 * unconfirmed factual claims about named companies.
 */
export function reviewedBanks(): readonly BankExportProfile[] {
  return SEO_BANKS.filter((bank) => bank.confidence !== 'unverified');
}

/** Entries still awaiting a human diff against a real export. */
export function unverifiedBanks(): readonly BankExportProfile[] {
  return SEO_BANKS.filter((bank) => bank.confidence !== 'verified' || bank.lastVerified === null);
}

export function bankBySlug(slug: string): BankExportProfile | undefined {
  return SEO_BANKS.find((bank) => bank.slug === slug);
}

