# Statement Conversion Engine — Technical Specification

**Scope:** `app/worker/` (parsing and emission) plus `app/lib/worker-client.ts` (main-thread supervision).
**Status:** 180 tests passing, `tsc --noEmit` clean repo-wide, production build verified.
**Audience:** product and engineering. Written to be readable without opening the source.

---

## 1. What the engine does

It converts a bank's CSV export into OFX 1.x, QBO or QFX — the formats QuickBooks, Quicken and
GnuCash import — entirely in the browser. No statement data reaches a server.

The work happens in a Web Worker because it is heavy enough to freeze the UI: encoding detection
scans up to 64 KiB, the file is parsed twice, and a large statement produces a multi-megabyte
string. A 100,000-row file converts in under 300 ms (measured: 286 ms).

The pipeline is five stages: **decode → delimit → locate header → map columns → parse rows**,
then emit.

---

## 2. Design commitments

Three rules hold everywhere in the engine. Most of the design follows from them.

### 2.1 No floating point ever touches money

Money is a `bigint` count of minor units (cents), never a `number`. Amounts are parsed from source
text into `bigint` by string surgery — sign, whole part, fraction — with no `parseFloat` anywhere.

This is not defensive pedantry. `0.1 + 0.2 === 0.30000000000000004` in IEEE-754, and a
reconciliation that is off by a fraction of a cent is a support ticket. Each amount also carries an
explicit `scale` (minor-unit digits) so JPY (0), USD (2) and BHD (3) all round-trip exactly.

### 2.2 Byte-exact reproducibility

Converting the same file twice — on different days, on different machines — produces **identical
bytes**. Nothing reads the clock, the locale, `Intl` defaults, or `Math.random`.

The statement timestamp (`<DTSERVER>`) is derived from the statement's own last transaction date,
not from `Date.now()`. This is what makes re-import idempotent: see §3.

### 2.3 Fail loudly, never silently wrong

A file the engine cannot read correctly is **rejected with a structured issue**, never converted
into a plausible-looking wrong answer. On a financial document, a visible failure is strictly
better than a silent 100× error. Two guards in §4 and §5 exist purely to enforce this.

Failure is scoped: a bad *row* is a warning and the other rows still convert (one malformed line
in a 900-row statement must not cost the user the other 899). A bad *file* is fatal.

---

## 3. FITID: positional `-2` / `-3` duplicate scheme

**Why it matters.** Accounting apps deduplicate imported transactions on `FITID`. Get it wrong in
one direction and a re-import silently duplicates every row; wrong in the other and real
transactions vanish.

**The derivation.**

```
FITID = sha1(accountId | postedDate | amountMinor | memo).slice(0, 32).toUpperCase()
```

32 hex characters = 128 bits. `amountMinor` is stringified from the `bigint`, so `-3.20` hashes
identically on every run. `memo` is trimmed and upper-cased so incidental whitespace or case
changes in a bank's export do not produce a new id for the same transaction.

**The duplicate problem.** Two identical £3.20 coffees on the same day at the same merchant are
genuinely different transactions, but they are identical under that tuple. Giving them the same
`FITID` makes QuickBooks silently swallow the second one.

**The scheme.** Rows identical under the tuple receive a deterministic suffix in the order they
appear: the first keeps the bare hash, the second gets `-2`, the third `-3`.

```
1st occurrence:  A1B2C3D4E5F6...
2nd occurrence:  A1B2C3D4E5F6...-2
3rd occurrence:  A1B2C3D4E5F6...-3
```

No random component — a random suffix would break re-import, which is the entire point.

**The property that makes it safe.** The suffix counts *prior occurrences within the duplicate
group*, not absolute position in the file. Appending next month's rows therefore never renumbers
this month's. A user who converts January, then converts January–February, gets the same ids for
the January rows both times and no duplicates on the second import. This is verified by a
dedicated test.

A bank-supplied unique reference number, when present, is preferred over the derived hash — it is
the institution's own stable identity and survives re-export better than anything computed.

---

## 4. Multi-currency detection by candidate intersection

**Why it matters.** OFX carries exactly one `<CURDEF>` per statement. A file mixing currencies has
no valid representation: emitting it would relabel every foreign row as the default currency and
hand the user a reconciliation wrong by the exchange rate. So a mixed file must be rejected.

**The naive approach fails.** Comparing currency tokens for equality flags `$10.00` alongside
`USD 20.00` as two currencies. That is one currency written two ways, and rejecting it would block
a perfectly good statement. This false positive was found by the fuzzer, not by inspection.

**The rule.** Every currency token maps to the **set of ISO codes it could denote**. Tokens are
compatible when the intersection across all of them is non-empty. A collision is reported only
when no single currency can explain the whole file.

| Token   | Candidate codes                                    |
| ------- | -------------------------------------------------- |
| `$`     | USD, CAD, AUD, NZD, SGD, HKD, TWD, MXN, … (28)      |
| `€`     | EUR                                                 |
| `£`     | GBP, EGP, LBP, SYP, SSP, SDG                        |
| `¥`     | JPY, CNY                                            |
| `Rs`    | INR, PKR, LKR, NPR, MUR, SCR                        |
| `USD`   | USD *(a bare ISO code denotes only itself)*         |

Worked examples:

| File contains  | Intersection      | Result       |
| -------------- | ----------------- | ------------ |
| `$` + `USD`    | {USD}             | accepted     |
| `¥` + `JPY`    | {JPY}             | accepted     |
| `$` + `€`      | ∅                 | **rejected** |
| `USD` + `EUR`  | ∅                 | **rejected** |

**Two independent scans.** Schema inference samples the first 200 rows. A currency that first
appears on row 5,000 would slip past that, so `parseTransactions` also checks every row of the
full file. Both paths raise the same `multi-currency` error code.

Error messages annotate a symbol with its dominant reading (`£ (GBP)`) for legibility. That
annotation is **display only** — the matching logic always uses the full candidate set.

---

## 5. Encoding and content-type: the ordering that matters

Detection order is load-bearing, not incidental.

**Step 1 — magic numbers.** Known binary formats are named and rejected before anything else: PDF,
ZIP (which covers `.xlsx`/`.ods`/`.docx`), OLE2 (`.xls`/`.doc`), PNG, JPEG, GIF, gzip, bzip2, 7z,
RAR, SQLite, ELF, Mach-O, WebAssembly. Without this, Papa Parse happily "parses" a PDF into
thousands of junk rows and the user gets an incomprehensible mapping screen instead of
*"that's a PDF"*.

**Step 2 — UTF-16 BOM check, and it must come before step 3.** UTF-16 encoded ASCII is
approximately half NUL bytes. The next step treats a NUL byte as proof of binary content. Run them
in the wrong order and **every UTF-16 CSV is rejected as a binary file** — a whole class of bank
exports, silently unsupported. The BOM is the only thing distinguishing UTF-16 text from a binary
blob, so it is checked first. There is a test whose sole purpose is to pin this ordering.

**Step 3 — NUL and control-byte density.** A NUL byte cannot appear in any supported text encoding
(UTF-16 excepted, hence step 2) and is the conventional binary marker used by `git` and `file`. A
control-character density above 5% also rejects. The threshold is deliberately not zero: a stray
`0x1A` (DOS EOF) or an ANSI colour escape from a piped export should not sink a good file.

**Step 4 — encoding selection.** A BOM is authoritative and short-circuits statistical detection.
Otherwise `jschardet` votes on a 64 KiB sample. Anything it cannot name confidently falls back to
**Windows-1252**, chosen because it decodes any byte sequence without throwing — a misdetection
mangles one payee name rather than failing the whole import.

**BOM stripping.** `decodeBytes` strips a BOM by byte offset. A second, cell-level strip catches
the leftover case: two exports concatenated, where the second file's BOM sits at the start of a
*header line* rather than at byte 0. A surviving U+FEFF is invisible but makes `"﻿Date"`
unequal to `"Date"`, silently breaking every header match in the file.

*Engineering note:* U+FEFF is ECMAScript whitespace, so the `.trim()` applied to every header cell
would also remove a leading mark. The explicit strip is therefore belt-and-braces, kept because
that behaviour is obscure enough to be refactored away by accident.

---

## 6. Cooperative abort and the two-layer timeout

**The constraint.** A Web Worker is single-threaded. While a synchronous loop is running, no timer
fires and no message is read. Nothing inside the worker can preempt it.

### Layer 1 — cooperative deadline (15 s, inside the worker)

A `Deadline` object is created per request and checked at row boundaries — every 1,024 rows in the
parse and transaction loops. Checking the clock per row would dominate the loop; every 1,024 rows
bounds overshoot to milliseconds at no measurable cost.

**The part that makes this real rather than decorative:** the CSV body is parsed through Papa
Parse's `step` callback rather than its bulk mode. Bulk mode is one uninterruptible synchronous
call — on a pathological file it would run to completion and only *then* notice the budget was
blown, leaving the thread frozen for the full duration. Stepping costs a little throughput but
allows `parser.abort()` to stop the parse mid-file.

A test pins this distinction specifically: it measures a full parse, then asserts an aborted parse
of the same file finishes in under half that time. The threshold is self-calibrating, so it
encodes no absolute timing assumption.

On expiry the worker returns a clean `system-timeout` response, keeping the worker warm.

### Layer 2 — main-thread watchdog and hard kill (16 s)

Layer 1 covers every loop the engine owns. It cannot cover a pathological single row, a runaway
regex, or a bug in a dependency that wedges the thread somewhere that never checks. In that state
the worker cannot report its own timeout — it cannot do anything, including read its message queue.

Only the main thread can break that, and only with `worker.terminate()`, which stops the thread
mid-instruction. `StatementWorkerClient` arms a watchdog per request, before `postMessage` (a post
to a wedged worker returns normally, so no later point is guaranteed to run).

**Why 16 s and not 15 s.** The one-second gap lets the cooperative path win whenever it can. A
clean `system-timeout` names the file and keeps the worker warm for the next drop; termination
throws away module initialisation too. Killing at exactly 15 s would race the better outcome.

On termination the client rejects every in-flight request with a typed `WorkerTimeoutError`
carrying an actionable message (re-export, or split by date range), discards the instance so the
next request spawns fresh, and lets the UI recover. Termination is necessarily indiscriminate — it
takes down sibling requests that were behaving — because the thread is wedged and there is no way
to run only the healthy work. A frozen UI is strictly worse.

---

## 7. OFX 1.x wire format

**OFX 1.x is SGML, not XML.** Three properties, each of which will get a file rejected if wrong:

1. **Leaf elements are unclosed.** `<TRNTYPE>DEBIT` with no closing tag.
2. **Aggregates ARE closed.** `<STMTTRN>…</STMTTRN>`, `<OFX>…</OFX>`. Leaving an aggregate open is
   not "more SGML" — it is a parse error. The OFX 1.0.2 DTD ends every aggregate explicitly, and
   QuickBooks needs the close tag to know where one transaction stops and the next begins.
3. **CRLF everywhere**, including the header block and the line after `</OFX>`. A bare `\n` gets
   the file rejected on import.

The leaf/aggregate distinction is enforced *structurally*, not by discipline: the writer's `leaf()`
method is incapable of emitting a close tag, and `close()` throws on a mismatched aggregate. No
future edit can accidentally produce XML.

The file opens with an ASCII `KEY:VALUE` header block terminated by exactly one blank line. Since
the header declares `ENCODING:USASCII`, the body is folded to ASCII — accents are decomposed
(`Café` → `Cafe`) rather than replaced with `?`, and truncation repairs a half-written entity if it
lands mid-`&amp;`.

QBO and QFX are the same wire format plus the `<INTU.BID>` routing tag, without which QuickBooks
rejects the file outright.

---

## 8. Verification

| Layer | What it covers |
| --- | --- |
| **180 unit tests** | Every stage in isolation, plus the worker message loop and the client watchdog |
| **6 golden files** | Byte-for-byte output comparison, including CRLF integrity. `UPDATE_GOLDEN=1` regenerates |
| **1,500-case fuzzer** | Seeded LCG (a failure names the seed and reproduces). Asserts nothing throws, and that any document that *is* emitted is well-formed: CRLF-only, ASCII-only, leaves unclosed, aggregates balanced, correctly terminated |
| **Mutation testing** | Guards are deliberately broken to confirm the suite fails. Removing the content-type gate fails 27 tests; the watchdog, 4; the deadline, 6; multi-currency, 5; the parse abort, 1 |
| **Production build** | Verified that Turbopack compiles the worker into a real chunk rather than shipping raw source |

Two bugs in this sprint were found by fuzzing and mutation testing rather than by review: the
`$`/`USD` currency false positive (§4), and a test that appeared to cover the parse abort but
tripped the deadline earlier in the pipeline and never exercised it.

### Production bundling

`new Worker(new URL('../worker/index.worker.ts', import.meta.url), { type: 'module' })` is the form
Turbopack statically detects; a computed path would not be bundled as a worker entry. Turbopack
compiles it into a bootstrap plus the engine chunk (~380 KB) and deliberately strips `type:'module'`
in favour of a classic worker that loads the chunks.

A raw `.ts` copy of the worker entry also appears under `.next/static/media/`. It is an artifact of
the `new URL()` expression being tracked as an asset reference and is **not** what `new Worker`
receives — the runtime loads the compiled chunk. It is harmless, though it does publish the entry
file's source.

---

## 9. Known limitations

Recorded deliberately; none are believed to be blocking.

- **Ambiguous dates.** When every row in a file has a day ≤ 12, `MM/DD` and `DD/MM` are
  indistinguishable from the data alone. The engine defaults to `MDY`, flags the schema
  `ambiguous`, and raises a warning so the UI can offer a toggle. It does not guess silently.
- **Undecidable grouping.** When every amount is `x,yyy`-shaped, the en-US reading wins. Any
  value that disambiguates (a separator not followed by exactly three digits) settles it correctly.
- **`$` is not resolvable to a country.** By design — see §4. A single-currency `$` file is
  converted using the account's configured currency.
- **A pathological single row cannot be interrupted from inside the worker.** This is the reason
  layer 2 exists; the outcome is a hard kill rather than a clean per-file error.
- **UTF-32 is unsupported.** `TextDecoder` has no UTF-32. A UTF-32 BOM is detected and falls back
  rather than crashing. No known bank exports UTF-32 CSV.
- **One statement per file.** OFX permits multiple `<STMTRS>` blocks; the engine emits one.

---

## 10. Market targeting and advertising tags

Added after the engine was sealed. Neither system touches the conversion
pipeline: the worker has no knowledge of either, and no statement data reaches
them. This section documents them because they are the only parts of the app
that talk to a third party.

### 10.1 Market targeting is build-time, not geolocation

**There is no runtime geo detection anywhere in this codebase.** No IP lookup,
no `x-vercel-ip-country`, no `Accept-Language` sniffing, no middleware, no
client-side locale branch. That is worth stating plainly because "geo-targeting"
usually implies exactly those things, and a future reader looking for them will
not find them.

What exists instead: each of the 20 bank profiles in `app/lib/seo-banks-data.ts`
carries a static `region` (`US` / `UK` / `EU` / `CA` / `AU`), and
`app/lib/market-context.ts` maps that region to a copy set —
`marketFor(region)` picks the market, `copyFor(region)` returns the strings.

The consequence is that **the market is a property of the page, not the
visitor**. A reader in London on `/banks/chase-to-quickbooks` sees US copy,
because that page is about a US bank. This is the right default for search
traffic: the query that found the page already encodes the intent, and serving
different copy to different visitors at the same URL is a cloaking risk and
makes the prerendered HTML uncacheable.

| Market | Currency | Leads with | Regions mapped |
| --- | --- | --- | --- |
| US | `$` USD | QuickBooks | US, and CA/AU by fallback |
| UK | `£` GBP | Xero | UK |
| EU | `€` EUR | Xero | EU |

CA and AU fall back to US copy deliberately — their layouts sit closer to the
US convention than the UK one, and nobody has written copy for them yet. That
fallback is in `marketFor`, not scattered through the pages.

Because resolution happens at build time, the localised copy ships inside the
prerendered HTML. There is no hydration flash and no per-request work.

**Claim discipline.** The UK/EU copy states that no statement data is
transmitted, which is a property of the architecture and is true. It stops
there. No compliance guarantee, tax-authority endorsement, or certification is
asserted, because none has been obtained.

### 10.2 Google Ads tag and Consent Mode v2

`app/components/GoogleAdsTracker.tsx`, mounted once in the root layout.

| Parameter | Behaviour |
| --- | --- |
| `NEXT_PUBLIC_GOOGLE_ADS_ID` | Tag id. Unset or malformed ⇒ **no script is injected at all** |
| `NEXT_PUBLIC_ADS_CONSENT_DEFAULT` | `denied` (default) or `granted` |
| `NODE_ENV` | Non-production builds inject nothing unless `enableInDevelopment` is passed |

Three gates must all pass before a single byte is requested from Google: a
valid tag id, a production build, and the component being mounted. Verified
against real production builds — with no id, zero prerendered pages contain a
gtag script; with a valid id, all 24 do.

**Loading strategy.** `next/script` with `afterInteractive`. Early enough to
catch a conversion on a short session, but after hydration, so it never
competes with the app for the critical path. `beforeInteractive` would block
first paint for a script unrelated to rendering; `lazyOnload` waits for idle
and can miss a fast bounce, which is precisely the traffic paid ads produce.
The component renders no DOM, so it cannot affect CLS.

**Tag id validation.** The id is interpolated into an inline `<script>`, so it
is checked against `/^(?:AW|G|GT|UA)-[A-Z0-9]+(?:-[A-Z0-9]+)?$/i` first. It
comes from build-time env and is not attacker-controlled today; the check
closes that path permanently and, more usefully, catches the likelier failure —
a typo'd id that would otherwise fail silently and lose a week of conversions.

**Consent Mode v2 defaults to `denied`.** Eight of the twenty bank pages target
UK/EU users, where ePrivacy and GDPR require consent *before* advertising
cookies are set. The tag boots with `ad_storage`, `ad_user_data`,
`ad_personalization` and `analytics_storage` all denied; Google still receives
cookieless pings for conversion modelling. `setAdsConsent(true)` upgrades all
four when a consent banner is accepted. Order matters and is enforced in the
init script: the `consent default` command runs *before* `config`, because a
`config` that lands first sets cookies under the unrestricted behaviour.

Set `NEXT_PUBLIC_ADS_CONSENT_DEFAULT=granted` only where consent is captured
before the app loads, or for US-only traffic.

**The event API is deliberately closed.** `trackGoogleConversion(eventName)`
accepts a name and nothing else — no parameter bag, no page path, no file name,
no row count. The product's whole claim is that a statement never leaves the
browser, and this is the one file that talks outward, so there is nowhere for
statement content to be attached even by accident. A test asserts the payload
contains nothing but `send_to`. If a conversion ever needs a value, add a
narrowly typed field; never a passthrough object.

Every failure path — server render, blocked tag, unset env, third-party throw —
is a silent no-op returning `false`. A conversion ping is never worth
interrupting a user's export.

### 10.3 Verification status

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors, with `strict`, `noUnusedLocals` **and `noUnusedParameters`** |
| `npx vitest run` | 193 passing across 8 files |
| `npx next build` | Succeeds; 20 bank pages prerendered |
| Tag gating | Verified against three real production builds (unset / valid / malformed id) |

Test distribution: parser 70, worker loop 34, guards 26, emitter 26,
worker-client 14, Google Ads 13, golden 9, fuzz 1 (1,500 generated cases).

### 10.4 Open item

The 20 bank profiles remain **unverified against real exports**. They are
reconstructed from published formats, carry `confidence` and
`lastVerified: null`, and all 20 publish. `publishableBanks()` exists to gate
them and is currently unused by the pages. Roughly ten minutes per bank to
confirm; this is the highest-value outstanding work, and it matters more now
that paid traffic is being pointed at those pages.
