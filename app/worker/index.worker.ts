/// <reference lib="webworker" />

/**
 * Worker entry point — the message loop between the UI thread and the parsing
 * engine.
 *
 * Everything expensive lives on this side of the boundary: encoding detection
 * scans up to 64 KiB, Papa Parse walks the whole file twice, and a large
 * statement emits a multi-megabyte string. Doing that on the main thread would
 * jank the drop zone for seconds on a big export.
 *
 * ## Contract
 *
 * The UI posts a `WorkerRequest` and gets exactly one `WorkerResponse` back,
 * correlated by `id`. There are two verbs:
 *
 *  - `inspect` — sniff the bytes, return the inferred schema plus a preview so
 *    the user can confirm or override the column mapping.
 *  - `convert` — parse and emit, returning both the document string and its
 *    bytes.
 *
 * ## Failure policy
 *
 * The engine distinguishes two kinds of bad news, and so does this loop:
 *
 *  - A *row-level* problem (unparseable date, missing amount) is a `warning`
 *    on an otherwise successful response. One bad line in a 900-row statement
 *    must not cost the user the other 899.
 *  - A *file-level* problem (no date column, zero rows, a thrown exception)
 *    produces `kind: 'failed'` with serialized issues.
 *
 * Nothing escapes as a raw `Error`: a structured-clone of an Error loses its
 * stack across the boundary in some browsers, and an unhandled rejection in a
 * worker surfaces to the UI as a bare `ErrorEvent` with no correlation id — so
 * every path is funnelled into a `ParseIssue[]` the UI can render verbatim.
 */

import { inferSchema, parseTransactions, readRows } from './parser';
import { buildDocument, toBytes } from './emitter';
import { Deadline, PROCESSING_TIMEOUT_MS, TimeoutError, validateContentType } from './guards';
import type {
  AccountIdentity,
  InferredSchema,
  OfxDialect,
  ParseIssue,
  SchemaMeta,
  WorkerRequest,
  WorkerResponse,
} from './types';

declare const self: DedicatedWorkerGlobalScope;

/** Rows returned with an `inspect` response for the mapping preview table. */
const PREVIEW_ROWS = 20;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Flattens any thrown value into a serializable issue.
 *
 * Workers can be handed anything as a throw — a DOMException from
 * `TextDecoder`, a string from a transpiled library, a plain object. Only the
 * message survives structured clone reliably, so it is extracted here rather
 * than trusted to the boundary.
 */
function toIssue(error: unknown, code: string): ParseIssue {
  if (error instanceof TimeoutError) {
    return {
      level: 'error',
      code: 'system-timeout',
      message: `Processing timed out after ${PROCESSING_TIMEOUT_MS / 1000} seconds. The file may be corrupted or unusually large.`,
    };
  }
  if (error instanceof Error) {
    return { level: 'error', code, message: `${error.name}: ${error.message}` };
  }
  if (typeof error === 'string') {
    return { level: 'error', code, message: error };
  }
  return { level: 'error', code, message: `Unexpected failure: ${String(error)}` };
}

/** `SchemaMeta` carries the account fields the CSV itself cannot know. */
function accountFromMeta(meta: SchemaMeta): AccountIdentity {
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

function defaultFilename(dialect: OfxDialect): string {
  return `statement.${dialect}`;
}

/** Posts a response, transferring the payload buffer instead of copying it. */
function reply(response: WorkerResponse): void {
  if (response.kind === 'converted') {
    self.postMessage(response, [response.bytes]);
    return;
  }
  self.postMessage(response);
}

/* -------------------------------------------------------------------------- */
/* Handlers                                                                   */
/* -------------------------------------------------------------------------- */

function handleInspect(id: string, bytes: ArrayBuffer, deadline: Deadline): WorkerResponse {
  const view = new Uint8Array(bytes);

  // Cheapest possible rejection: a wrong-format payload never reaches the
  // parser, so it cannot produce a plausible-looking schema out of noise.
  const rejection = validateContentType(view);
  if (rejection !== null) {
    return { kind: 'failed', id, issues: [rejection] };
  }
  // The account identity does not affect inference; only the currency scale
  // reaches the number parser, and a preview never parses amounts.
  const placeholder: AccountIdentity = {
    bankId: '',
    accountId: '',
    accountType: 'CHECKING',
    currency: 'USD',
    scale: 2,
    institution: 'BANK',
    fid: '0000',
  };

  const { schema, issues } = inferSchema(view, placeholder, deadline);
  if (issues.some((issue) => issue.level === 'error')) {
    return { kind: 'failed', id, issues };
  }

  const { rows } = readRows(view, deadline);
  return {
    kind: 'inspected',
    id,
    schema,
    preview: rows.slice(0, PREVIEW_ROWS),
    issues,
  };
}

function handleConvert(
  id: string,
  bytes: ArrayBuffer,
  meta: SchemaMeta,
  dialect: OfxDialect,
  suppliedSchema: InferredSchema | undefined,
  filename: string | undefined,
  deadline: Deadline,
): WorkerResponse {
  const view = new Uint8Array(bytes);

  const rejection = validateContentType(view);
  if (rejection !== null) {
    return { kind: 'failed', id, issues: [rejection] };
  }

  const account = accountFromMeta(meta);

  // Re-infer only when the UI did not send back a (possibly user-corrected)
  // schema. Honouring the supplied one is what makes the override UI work.
  let schema: InferredSchema;
  const issues: ParseIssue[] = [];
  if (suppliedSchema === undefined) {
    const inferred = inferSchema(view, account, deadline);
    schema = inferred.schema;
    issues.push(...inferred.issues);
  } else {
    // The account travels with the request, not the stored schema, so a user
    // editing the account number does not require a re-sniff.
    schema = { ...suppliedSchema, account };
  }

  if (issues.some((issue) => issue.level === 'error')) {
    return { kind: 'failed', id, issues };
  }

  const parsed = parseTransactions(view, schema, deadline);
  issues.push(...parsed.issues);

  // A row-level error (a currency collision found deep in the file) is fatal
  // even though rows parsed: emitting would silently relabel foreign amounts.
  const fatal = issues.filter((issue) => issue.level === 'error');
  if (fatal.length > 0) {
    return { kind: 'failed', id, issues };
  }

  if (parsed.transactions.length === 0) {
    return {
      kind: 'failed',
      id,
      issues: [
        {
          level: 'error',
          code: 'no-transactions',
          message: 'No transactions could be parsed from this file.',
        },
        ...issues,
      ],
    };
  }

  const document = buildDocument(parsed.transactions, meta, dialect);
  const payload = toBytes(document);
  // Hand over a standalone buffer: `payload.buffer` may be a view into a
  // larger allocation, and transferring that would detach more than intended.
  const buffer = payload.slice().buffer as ArrayBuffer;

  return {
    kind: 'converted',
    id,
    document,
    bytes: buffer,
    filename: filename ?? defaultFilename(dialect),
    transactionCount: parsed.transactions.length,
    issues,
  };
}

/* -------------------------------------------------------------------------- */
/* Message loop                                                               */
/* -------------------------------------------------------------------------- */

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const request = event.data;

  // Guard before reading `id`: a malformed post would otherwise throw inside
  // the catch's own error reporting.
  if (request === null || typeof request !== 'object' || typeof request.id !== 'string') {
    self.postMessage({
      kind: 'failed',
      id: 'unknown',
      issues: [
        { level: 'error', code: 'bad-request', message: 'Malformed worker request: missing id.' },
      ],
    } satisfies WorkerResponse);
    return;
  }

  // Captured before the switch: in the default branch `request` is narrowed to
  // `never`, so its `id` is no longer reachable through the union.
  const id = request.id;
  // One budget per request, started before any work: the guard covers decode,
  // inference and emit together, not each stage separately.
  const deadline = new Deadline(PROCESSING_TIMEOUT_MS);

  try {
    switch (request.kind) {
      case 'inspect':
        reply(handleInspect(request.id, request.bytes, deadline));
        return;
      case 'convert':
        reply(
          handleConvert(
            request.id,
            request.bytes,
            request.meta,
            request.dialect,
            request.schema,
            request.filename,
            deadline,
          ),
        );
        return;
      default:
        reply({
          kind: 'failed',
          id,
          issues: [
            {
              level: 'error',
              code: 'unknown-kind',
              message: `Unknown request kind: ${String((request as { kind?: unknown }).kind)}`,
            },
          ],
        });
    }
  } catch (error) {
    // Any throw from the engine lands here and comes back correlated by id,
    // so a failure shows up on the right file rather than as a global error.
    reply({ kind: 'failed', id, issues: [toIssue(error, 'worker-exception')] });
  }
};

/**
 * Last-resort net for anything that escapes the handler — a rejected promise
 * in a future async path, say. Without this the UI would see an `ErrorEvent`
 * with no id and leave its spinner running forever.
 */
self.onunhandledrejection = (event: PromiseRejectionEvent): void => {
  event.preventDefault();
  self.postMessage({
    kind: 'failed',
    id: 'unknown',
    issues: [toIssue(event.reason, 'unhandled-rejection')],
  } satisfies WorkerResponse);
};

export {};
