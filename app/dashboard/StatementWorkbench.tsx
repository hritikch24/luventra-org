'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
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
import { PreviewGrid } from './components/PreviewGrid';
import { ValidationPanel, type ExportState } from './components/ValidationPanel';
import { BillingModal, FREE_ROW_LIMIT } from './components/BillingModal';
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
 * for the SGML profile and Intuit BID tag, and `app/worker/sha1.ts` for the
 * FITID digest — so this row stays a description of the engine rather than a
 * decorative trust badge.
 */
const COMPLIANCE_ASSERTIONS = [
  'OFX SGML Spec 1.0.2 Compliant',
  'Intuit BID Tag Synchronization',
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
  }, [loaded, dialect, accountId, checkEntitlement]);

  return (
    <div
      className={`flex flex-col ${
        embedded
          ? 'h-[44rem] max-h-[85vh]'
          : // Both global bars are siblings of this subtree, so subtract both.
            'h-[calc(100dvh-var(--header-h)-var(--footer-h))]'
      }`}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800/60 px-4 py-2.5">
        <div className="flex items-baseline gap-2.5">
          {/* The bank page owns the page-level h1, so this drops to a span. */}
          {embedded ? (
            <span className="text-sm font-medium tracking-tight text-zinc-100">
              {preset ? `${preset.name} converter` : 'Statement Converter'}
            </span>
          ) : (
            <h1 className="text-sm font-medium tracking-tight text-zinc-100">
              Statement Converter
            </h1>
          )}
          <span className="font-mono text-[0.625rem] text-zinc-400">csv → ofx/qbo/qfx</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[0.625rem] text-zinc-400">parsed locally</span>
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
        <section
          aria-labelledby="workbench-summary"
          className="shrink-0 border-b border-zinc-800/60 bg-zinc-900/40 px-4 py-3"
        >
          <h2
            id="workbench-summary"
            className="text-xs font-medium tracking-tight text-zinc-100"
          >
            Deterministic CSV → OFX/QBO/QFX conversion, executed in-browser
          </h2>
          <p className="mt-1.5 max-w-5xl text-xs leading-relaxed text-zinc-300">
            Luventra is a zero-latency financial data formatting instrument designed to fix broken
            spreadsheet rows. We auto-infer column mapping configurations, calculate deterministic
            unique transaction identifiers (FITID), strip dynamic byte order marks (BOM), and parse
            inputs 100% locally inside an isolated client-side thread.
          </p>
        </section>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 lg:grid-cols-[17rem_minmax(0,1fr)_19rem] lg:overflow-hidden">
        {/* LEFT — ingestion and mapping rules */}
        <div className="scroll-thin flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
          {/* TARGET 1 */}
          <div data-tour="dropzone">
            <FileDropzone
              preview={loaded?.preview ?? null}
              busy={busy}
              error={error}
              onFile={(file) => {
                void onFile(file);
              }}
              onClear={onClear}
            />
          </div>

          {/* TARGET 2 — present in both states so the step always has an anchor. */}
          <div data-tour="mapping">
            {loaded ? (
              <MappingTable
                preview={loaded.preview}
                columns={loaded.schema.columns}
                onAssign={onAssign}
              />
            ) : (
              <div className="border border-zinc-800/60 bg-zinc-900/40 px-3 py-6 text-center">
                <p className="font-mono text-[0.6875rem] text-zinc-400">mapping rules</p>
              </div>
            )}
          </div>
        </div>

        {/*
          CENTRE — live preview matrix over the format compliance row.

          A grid, not a flex column: the first track takes the leftover space
          and the assertions row is auto-height, which lets the preview keep its
          own `lg:min-h-0` internal scrolling without threading a flex-1 through
          PreviewGrid's root.
        */}
        <div className="grid gap-3 lg:min-h-0 lg:grid-rows-[minmax(0,1fr)_auto]">
          {loaded ? (
            <PreviewGrid preview={loaded.preview} columns={loaded.schema.columns} />
          ) : (
            <div className="flex items-center justify-center border border-zinc-800/60 bg-zinc-900/40 py-12 lg:py-0">
              <p className="font-mono text-xs text-zinc-400">no statement loaded</p>
            </div>
          )}

          {/* Single-pixel gaps via the parent background, so the row reads as
              one panel split into cells rather than three detached chips. */}
          <section
            aria-label="Format compliance"
            className="grid shrink-0 grid-cols-1 gap-px border border-zinc-800/60 bg-zinc-800/60 sm:grid-cols-3"
          >
            {COMPLIANCE_ASSERTIONS.map((assertion) => (
              <div key={assertion} className="flex items-center gap-2 bg-zinc-900 px-3 py-2">
                <ShieldCheck className="size-3 shrink-0 text-emerald-500" aria-hidden />
                <span className="font-mono text-[0.625rem] leading-tight text-zinc-300">
                  [{assertion}]
                </span>
              </div>
            ))}
          </section>
        </div>

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
      </main>

      {embedded ? null : <OnboardingTour controller={tour} />}

      <BillingModal
        open={billingOpen}
        rowCount={loaded?.schema.rowCount ?? 0}
        signedIn={subscription?.signedIn ?? false}
        onClose={() => setBillingOpen(false)}
      />
    </div>
  );
}
