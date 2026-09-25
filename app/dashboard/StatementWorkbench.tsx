'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { PANEL, CONFIG_LABEL } from './components/surface';
import type {
  ColumnRole,
  DetectedColumn,
  InferredSchema,
  OfxDialect,
  ParseIssue,
} from '@/app/worker/types';
import type { CsvPreview } from '@/app/lib/preview';
import { resolvePresetRoles } from '@/app/lib/preset-resolve';
import { runPreflight } from '@/app/lib/preflight';
import {
  StatementWorkerClient,
  downloadBytes,
  downloadFilename,
  mimeForDialect,
} from '@/app/lib/worker-client';
import { FileDropzone } from './components/FileDropzone';
import { MappingTable } from './components/MappingTable';
import { PreviewGrid, PreviewGridEmpty } from './components/PreviewGrid';
import { ValidationPanel, type ExportState } from './components/ValidationPanel';
import { BillingModal, FREE_ROW_LIMIT } from './components/BillingModal';
import { GuestLimitModal } from './components/GuestLimitModal';
import { consumeAnonConversion, type AnonAllowance } from '@/app/lib/conversion-limiter';
import { AuthLink } from '@/app/components/AuthLink';
import { OnboardingTour, useOnboardingTour } from './components/OnboardingTour';
import { trackGoogleConversion } from '@/app/components/GoogleAdsTracker';
import { rowBucket, track } from '@/app/lib/telemetry';

/**
 * Week-one launch toggle: lifts the free-tier row limit for everyone.
 *
 * Written as a full static member expression because Next only inlines
 * `process.env.NEXT_PUBLIC_*` when it can substitute the literal text.
 *
 * This is a build-time constant baked into the client bundle, so it is a
 * promotional switch, not an entitlement boundary — anyone reading the bundle
 * can see it. That is acceptable here only because conversion is entirely
 * client-side and the paywall was always advisory; if server-side entitlement
 * ever gates real work, it must not rely on this.
 */
const PAYWALL_DISABLED = process.env.NEXT_PUBLIC_DISABLE_PAYWALL === 'true';

interface Loaded {
  readonly fileName: string;
  /** Pristine copy; every worker post sends a slice so this is never detached. */
  readonly bytes: ArrayBuffer;
  readonly schema: InferredSchema;
  readonly preview: CsvPreview;
  /** File-level findings from `inspect`. */
  readonly issues: readonly ParseIssue[];
}

interface SubscriptionState {
  readonly configured: boolean;
  readonly signedIn: boolean;
  readonly active: boolean;
}

/** Build the presentational preview from an `inspected` response. */
function toPreview(
  fileName: string,
  byteSize: number,
  schema: InferredSchema,
  rows: readonly (readonly string[])[],
): CsvPreview {
  return {
    fileName,
    byteSize,
    delimiter: schema.delimiter.delimiter,
    // The worker strips preamble and header, so column titles come from the
    // schema rather than from row zero.
    headers: schema.columns.map((column) => column.header),
    rows,
  };
}

/**
 * Seed roles from a bank's known header names.
 *
 * This runs over what the engine already inferred, so it is a correction, not
 * a replacement: a header the preset does not mention keeps the engine's
 * guess. Roles stay single-slot — the last column claiming a role wins and
 * earlier claimants fall back to `ignored` — because the convert request
 * requires that invariant.
 */
function applyPreset(
  columns: readonly DetectedColumn[],
  headerMap: Readonly<Record<string, ColumnRole>>,
): readonly DetectedColumn[] {
  const resolved = resolvePresetRoles(
    columns.map((column) => column.header),
    headerMap,
  );

  return columns.map((column, index) => {
    const role = resolved[index];
    // A header the preset does not mention keeps whatever the engine inferred.
    if (role === undefined) return column;
    // `userAssigned` stays false: this is still a machine guess, so the
    // mapping table keeps showing it as auto-matched rather than user-set.
    return { ...column, role, confidence: role === 'ignored' ? 0 : 1 } satisfies DetectedColumn;
  });
}

export interface BankPreset {
  readonly name: string;
  /** `normaliseHeader(header)` -> role to pre-select. */
  readonly headerMap: Readonly<Record<string, ColumnRole>>;
}

/**
 * Format assertions rendered under the preview grid.
 *
 * Each line states something the emitter actually does — see `app/worker/ofx.ts`
 * for the SGML profile and the INTU.BID tag, and `app/worker/sha1.ts` for the
 * FITID digest — so this row stays a description of the engine rather than a
 * decorative trust badge.
 *
 * The BID line used to read "Intuit BID Registry Token Matching", which
 * claimed more than the emitter does: the tag is a compatibility fallback, not
 * a per-bank registry lookup. Wording corrected rather than left to imply a
 * capability that does not exist.
 */
const COMPLIANCE_ASSERTIONS = [
  'OFX SGML Specification v1.0.2 Compliant',
  'QuickBooks Desktop-compatible Web Connect ID',
  'SHA-1 Transaction Deduplication Protection',
] as const;

export interface StatementWorkbenchProps {
  /** Pre-seeds the mapping selectors from a known bank layout. */
  readonly preset?: BankPreset;
  /** Renders inside a page rather than owning the viewport. */
  readonly embedded?: boolean;
}

export function StatementWorkbench({ preset, embedded = false }: StatementWorkbenchProps = {}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialect, setDialect] = useState<OfxDialect>('ofx');
  const [accountId, setAccountId] = useState('');
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const [guestLimitOpen, setGuestLimitOpen] = useState(false);
  const [guestResetsAt, setGuestResetsAt] = useState<number | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const tour = useOnboardingTour(!embedded);

  // One worker for the session; spawning per file would re-pay module init.
  const clientRef = useRef<StatementWorkerClient | null>(null);
  function client(): StatementWorkerClient {
    clientRef.current ??= new StatementWorkerClient();
    return clientRef.current;
  }

  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  /* -- ingestion ---------------------------------------------------------- */

  const onFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setExportState('idle');
    setExportMessage(null);

    try {
      const bytes = await file.arrayBuffer();
      const response = await client().inspect(bytes);

      if (response.kind === 'failed') {
        setLoaded(null);
        setError(response.issues[0]?.message ?? 'This file could not be read.');
        return;
      }
      if (response.kind !== 'inspected') {
        setLoaded(null);
        setError('Unexpected response from the processing worker.');
        return;
      }

      const columns = preset
        ? applyPreset(response.schema.columns, preset.headerMap)
        : response.schema.columns;
      const schema = { ...response.schema, columns };

      track({ event: 'file_loaded', rowBucket: rowBucket(schema.rowCount) });

      setLoaded({
        fileName: file.name,
        bytes,
        schema,
        preview: toPreview(file.name, file.size, schema, response.preview),
        issues: response.issues,
      });
    } catch (cause) {
      setLoaded(null);
      setError(cause instanceof Error ? cause.message : 'This file could not be read.');
    } finally {
      setBusy(false);
    }
  }, [preset]);

  const onClear = useCallback(() => {
    setLoaded(null);
    setError(null);
    setExportState('idle');
    setExportMessage(null);
  }, []);

  /* -- mapping overrides -------------------------------------------------- */

  /**
   * Overrides are applied to the schema locally rather than by re-posting to
   * the worker: `inspect` re-sniffs from bytes and takes no schema, so a round
   * trip would hand back the engine's own guess and discard the very edit
   * being made. The corrected schema travels with the `convert` request, which
   * is the call that honours it.
   */
  const onAssign = useCallback((index: number, role: ColumnRole) => {
    setLoaded((current) => {
      if (!current) return current;
      const columns = current.schema.columns.map((column) => {
        if (column.index === index) {
          return { ...column, role, confidence: 1, userAssigned: true } satisfies DetectedColumn;
        }
        if (role !== 'ignored' && column.role === role) {
          return {
            ...column,
            role: 'ignored',
            confidence: 0,
            userAssigned: true,
          } satisfies DetectedColumn;
        }
        return column;
      });
      return { ...current, schema: { ...current.schema, columns } };
    });
    setExportState('idle');
    setExportMessage(null);
  }, []);

  const report = useMemo(
    () =>
      loaded
        ? runPreflight({
            preview: loaded.preview,
            columns: loaded.schema.columns,
            totalRows: loaded.schema.rowCount,
            workerIssues: loaded.issues,
          })
        : null,
    [loaded],
  );

  // preflight_pass fires once per loaded file, the first time the gate opens.
  // A ref rather than state so re-running checks on a mapping edit does not
  // emit a second event for the same statement.
  const passReported = useRef(false);
  useEffect(() => {
    if (!loaded) {
      passReported.current = false;
      return;
    }
    if (report?.ready && !passReported.current) {
      passReported.current = true;
      track({ event: 'preflight_pass', rowBucket: rowBucket(loaded.schema.rowCount) });
    }
  }, [loaded, report]);

  /* -- billing gate ------------------------------------------------------- */

  /**
   * Spends one of a guest's daily conversions.
   *
   * Runs before the subscription gate and only for signed-out visitors, so a
   * subscriber never touches the counter. It is advisory — see the module
   * header on `conversion-limiter` for why nothing client-side can be an
   * entitlement boundary in an app that converts in the browser.
   */
  const checkGuestAllowance = useCallback((): boolean => {
    if (subscription?.signedIn) return true;

    const allowance: AnonAllowance = consumeAnonConversion();
    if (allowance.allowed) return true;

    setGuestResetsAt(allowance.resetsAt);
    setGuestLimitOpen(true);
    return false;
  }, [subscription]);

  /** Returns true when conversion may proceed. */
  const checkEntitlement = useCallback(async (rowCount: number): Promise<boolean> => {
    // Free-for-all week: skip the row check and the subscription round trip
    // entirely, so no network request is made just to be ignored.
    if (PAYWALL_DISABLED) return true;
    if (rowCount <= FREE_ROW_LIMIT) return true;

    let state = subscription;
    if (!state) {
      const response = await fetch('/api/subscription');
      if (!response.ok) throw new Error('Could not verify your subscription.');
      state = (await response.json()) as SubscriptionState;
      setSubscription(state);
    }

    // With no Supabase project wired up there is no subscription to read, so
    // billing is not enforced rather than blocking every large file.
    if (!state.configured) return true;
    if (state.active) return true;

    setBillingOpen(true);
    return false;
  }, [subscription]);

  /* -- convert and download ----------------------------------------------- */

  const onExport = useCallback(async () => {
    if (!loaded) return;
    setExportState('working');
    setExportMessage(null);

    try {
      if (!checkGuestAllowance()) {
        setExportState('idle');
        return;
      }

      const allowed = await checkEntitlement(loaded.schema.rowCount);
      if (!allowed) {
        setExportState('idle');
        return;
      }

      const filename = downloadFilename(loaded.fileName, dialect);
      const response = await client().convert({
        bytes: loaded.bytes,
        dialect,
        schema: loaded.schema,
        filename,
        meta: {
          // ACCTID is required by the format; fall back to the file's name so
          // the output is still importable when the user has not supplied one.
          accountId: accountId.trim() || loaded.fileName.replace(/\.[^.]+$/, ''),
          currency: loaded.schema.account.currency,
          scale: loaded.schema.account.scale,
        },
      });

      if (response.kind === 'failed') {
        // The engine's own code is sent, not the human message: the message is
        // prose that may quote file content, the code is a fixed enum.
        track({
          event: 'conversion_failed',
          dialect,
          errorCode: response.issues[0]?.code ?? 'UNKNOWN',
        });
        setExportState('error');
        setExportMessage(response.issues[0]?.message ?? 'Conversion failed.');
        return;
      }
      if (response.kind !== 'converted') {
        setExportState('error');
        setExportMessage('Unexpected response from the processing worker.');
        return;
      }

      downloadBytes(response.bytes, response.filename, mimeForDialect(dialect));

      // Fired only after the worker returned a real document and the download
      // was handed to the browser — not on button click, so a gated or failed
      // export never counts as a conversion.
      trackGoogleConversion('file_converted');
      track({
        event: 'conversion_success',
        dialect,
        rowBucket: rowBucket(response.transactionCount),
      });

      const skipped = response.issues.filter((issue) => issue.level === 'warning').length;
      setExportState('done');
      setExportMessage(
        `Saved ${response.filename} — ${response.transactionCount.toLocaleString()} transactions` +
          (skipped > 0 ? `, ${skipped} row-level warning${skipped === 1 ? '' : 's'}.` : '.'),
      );
    } catch (cause) {
      track({ event: 'conversion_failed', dialect, errorCode: 'worker-exception' });
      setExportState('error');
      setExportMessage(cause instanceof Error ? cause.message : 'Conversion failed.');
    }
  }, [loaded, dialect, accountId, checkGuestAllowance, checkEntitlement]);

  return (
    <div
      className={`flex flex-col bg-zinc-50 ${
        embedded
          ? 'h-[44rem] max-h-[85vh]'
          : // Both global bars are siblings of this subtree, so subtract both.
            'h-[calc(100dvh-var(--header-h)-var(--footer-h))]'
      }`}
    >
      {/*
        `min-w-0` + `shrink-0` on the two groups, and the decorative status
        readouts dropped below sm. Without this the bar collapsed to 76px on a
        390px phone: the title wrapped to two lines, the format string wrapped
        under it, and "parsed locally" ran straight into it with no separator.
      */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          {/* The bank page owns the page-level h1, so this drops to a span. */}
          {embedded ? (
            <span className="truncate text-sm font-medium tracking-tight text-zinc-900">
              {preset ? `${preset.name} converter` : 'Statement Converter'}
            </span>
          ) : (
            <h1 className="whitespace-nowrap text-sm font-medium tracking-tight text-zinc-900">
              Statement Converter
            </h1>
          )}
          <span className={`hidden shrink-0 sm:inline ${CONFIG_LABEL}`}>csv → ofx/qbo/qfx</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={`hidden md:inline ${CONFIG_LABEL}`}>parsed locally</span>
          {embedded ? null : <AuthLink />}
        </div>
      </header>

      {/*
        Sits above the workspace rather than inside the left rail: the dropzone
        is the conversion action, and a paragraph stacked on top of it in a
        17rem column would push it below the fold. Full-width keeps the copy to
        a few lines and leaves the dropzone where it was.

        Suppressed when embedded — the bank pages state the same guarantees in
        their own hero, and repeating the block across 20 static routes would be
        duplicate copy on the pages that carry the search traffic.
      */}
      {embedded ? null : (
        // <article>: a self-contained description of the product, the one block
        // here that would still make sense lifted out of the workspace.
        <article
          aria-labelledby="workbench-summary"
          className="shrink-0 border-b border-zinc-200 bg-zinc-50 px-4 py-3 backdrop-blur-md"
        >
          <h2 id="workbench-summary" className="text-xs font-semibold tracking-tight text-zinc-900">
            Secure Client-Side Financial Data Transcoder
          </h2>
          <p className="mt-1.5 max-w-5xl text-xs leading-relaxed text-zinc-700">
            Format irregular banking statement rows into specification-compliant bookkeeping entries
            instantly. Our isolated local background processing environment completely ensures that
            no financial text, numeric values, or business account names ever touch the network or
            hit an external server.
          </p>
        </article>
      )}

      {/*
        A <section>, not a <main>: both host pages already own the document's
        single `main` landmark (app/dashboard/page.tsx and the bank route), so
        emitting one here nested a second main inside the first on the dashboard
        and on all 20 bank pages — invalid HTML and a duplicate landmark for
        assistive tech.
      */}
      {/*
        Column weights follow the state.

        Before a file exists the only thing that matters is the drop target, so
        it takes a wide column and the preview — which has nothing in it yet —
        gives up the space. The old fixed 17rem rail made the upload the
        smallest element on screen while an empty ledger occupied the middle,
        which inverted the visual weight against the one action a visitor came
        to perform. Once a file is loaded the preview becomes the content and
        the weights swap back.
      */}
      <section
        aria-labelledby="workspace-heading"
        className={`grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 lg:overflow-hidden ${
          loaded
            ? 'lg:grid-cols-[17rem_minmax(0,1fr)_19rem]'
            : 'lg:grid-cols-[26rem_minmax(0,1fr)_17rem]'
        }`}
      >
        {/* Anchors the h3s of the three panels under a single h2 in both the
            standalone and embedded heading outlines. */}
        <h2 id="workspace-heading" className="sr-only">
          Statement conversion workspace
        </h2>

        {/* LEFT — ingestion and mapping rules */}
        <div className="scroll-thin flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
          {/* TARGET 1. The tour resolves `[data-tour]` with querySelector and
              only reads a bounding box, so moving the attribute onto the
              semantic <section> keeps the highlight anchored. */}
          <section data-tour="dropzone" aria-labelledby="ingest-heading">
            <h3 id="ingest-heading" className="sr-only">
              Statement file input
            </h3>
            <FileDropzone
              preview={loaded?.preview ?? null}
              busy={busy}
              error={error}
              onFile={(file) => {
                void onFile(file);
              }}
              onClear={onClear}
            />
          </section>

          {/* TARGET 2 — present in both states so the step always has an anchor. */}
          <div data-tour="mapping">
            {loaded ? (
              <MappingTable
                preview={loaded.preview}
                columns={loaded.schema.columns}
                onAssign={onAssign}
              />
            ) : (
              <section
                aria-labelledby="mapping-placeholder-heading"
                className={`px-3 py-6 text-center ${PANEL}`}
              >
                <h3 id="mapping-placeholder-heading" className="sr-only">
                  Column mapping rules
                </h3>
                <p className={CONFIG_LABEL}>mapping rules</p>
              </section>
            )}
          </div>
        </div>

        {/* CENTRE — live preview matrix */}
        {loaded ? (
          <PreviewGrid preview={loaded.preview} columns={loaded.schema.columns} />
        ) : (
          <PreviewGridEmpty />
        )}

        {/* RIGHT — validation and the export gate */}
        <ValidationPanel
          report={report}
          dialect={dialect}
          onDialectChange={setDialect}
          accountId={accountId}
          onAccountIdChange={setAccountId}
          exportState={exportState}
          exportMessage={exportMessage}
          onExport={() => {
            void onExport();
          }}
        />
      </section>

      {/*
        Verification badges, spanning the full width directly beneath the drop
        workspace rather than nested in the preview column: the assertions cover
        the whole engine, not just the grid, and a full-width row keeps each one
        on a single line instead of wrapping inside a narrow track.
      */}
      <section
        aria-labelledby="compliance-heading"
        className="grid shrink-0 grid-cols-1 gap-px border-t border-zinc-200 bg-zinc-200 sm:grid-cols-3"
      >
        <h3 id="compliance-heading" className="sr-only">
          Output format compliance
        </h3>
        {COMPLIANCE_ASSERTIONS.map((assertion) => (
          <div key={assertion} className="flex items-center gap-2 bg-zinc-50 px-4 py-2">
            <ShieldCheck className="size-3 shrink-0 text-emerald-600" aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-widest leading-tight text-zinc-600">
              [{assertion}]
            </span>
          </div>
        ))}
      </section>

      {embedded ? null : <OnboardingTour controller={tour} />}

      <GuestLimitModal
        open={guestLimitOpen}
        resetsAt={guestResetsAt}
        onClose={() => setGuestLimitOpen(false)}
      />

      <BillingModal
        open={billingOpen}
        rowCount={loaded?.schema.rowCount ?? 0}
        signedIn={subscription?.signedIn ?? false}
        onClose={() => setBillingOpen(false)}
      />
    </div>
  );
}
