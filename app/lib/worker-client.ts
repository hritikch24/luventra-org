'use client';

import type { WorkerRequest, WorkerResponse } from '@/app/worker/types';
import { PROCESSING_TIMEOUT_MS } from '@/app/worker/guards';

/**
 * Promise-shaped wrapper over the worker's message loop.
 *
 * The protocol is one response per request correlated by `id`, so the natural
 * shape on this side is a promise per post rather than a global `onmessage`
 * reducer. A single long-lived worker is reused across requests: spawning one
 * per file would re-pay module init (Papa Parse, jschardet) every drop.
 */

/**
 * Main-thread hard deadline, one second past the worker's own budget.
 *
 * The worker's `Deadline` is *cooperative*: it fires only when a loop stops to
 * ask. That covers every loop the engine owns, but a worker is
 * single-threaded, so a pathological single row, a runaway regex, or a bug in
 * a dependency can wedge the thread somewhere that never checks. In that state
 * the worker cannot report its own timeout -- it cannot do anything at all,
 * including read its message queue.
 *
 * Only the main thread can break that, and only with `terminate()`, which
 * stops the thread mid-instruction. The extra second lets the cooperative path
 * win whenever it can: a clean `system-timeout` response names the file and
 * keeps the worker warm for the next drop, whereas termination throws away the
 * module init too. Killing at exactly 15s would race the better outcome.
 */
export const WORKER_WATCHDOG_MS = PROCESSING_TIMEOUT_MS + 1_000;

/**
 * Raised when the watchdog had to kill the worker.
 *
 * A distinct type so the UI can tell "this file defeated the engine" apart
 * from an ordinary parse failure, and say something the user can act on.
 */
export class WorkerTimeoutError extends Error {
  constructor() {
    super(
      `Processing did not finish within ${Math.round(WORKER_WATCHDOG_MS / 1000)} seconds and was stopped. ` +
        'The file may be corrupted, or far larger than a normal statement. ' +
        'Try re-exporting it from your bank, or splitting it into smaller date ranges.',
    );
    this.name = 'WorkerTimeoutError';
  }
}

type Pending = {
  readonly resolve: (response: WorkerResponse) => void;
  readonly reject: (error: Error) => void;
  /** Watchdog handle, cleared the moment the request settles. */
  readonly watchdog: ReturnType<typeof setTimeout>;
};

export class StatementWorkerClient {
  #worker: Worker | null = null;
  #pending = new Map<string, Pending>();
  #counter = 0;

  /** Lazily spawn, so nothing is constructed during SSR or before first use. */
  #ensure(): Worker {
    if (this.#worker) return this.#worker;

    // `new URL(..., import.meta.url)` is the form the bundler statically
    // detects; a computed path would not be bundled as a worker entry.
    const worker = new Worker(new URL('../worker/index.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = this.#pending.get(response.id);
      if (!pending) return; // A stale response for a superseded request.
      this.#settle(response.id);
      pending.resolve(response);
    };

    // A worker-level error has no correlation id, so it can only be reported by
    // failing everything outstanding -- otherwise those promises never settle.
    worker.onerror = (event: ErrorEvent) => {
      this.#failAll(new Error(event.message || 'The processing worker crashed.'));
    };

    worker.onmessageerror = () => {
      this.#failAll(new Error('The processing worker sent a message that could not be read.'));
    };

    this.#worker = worker;
    return worker;
  }

  #nextId(): string {
    this.#counter += 1;
    return `req-${this.#counter}`;
  }

  /** Drops a settled request and cancels its watchdog. */
  #settle(id: string): void {
    const pending = this.#pending.get(id);
    if (pending === undefined) return;
    clearTimeout(pending.watchdog);
    this.#pending.delete(id);
  }

  /**
   * Rejects every outstanding request. Used whenever the worker as a whole is
   * gone or untrustworthy, since per-request recovery is impossible then.
   */
  #failAll(error: Error): void {
    const outstanding = [...this.#pending.values()];
    for (const pending of this.#pending.values()) clearTimeout(pending.watchdog);
    this.#pending.clear();
    for (const pending of outstanding) pending.reject(error);
  }

  /**
   * The hard kill. Terminates mid-instruction, discards the instance so the
   * next request spawns a fresh one, and fails everything in flight.
   *
   * Termination is indiscriminate -- it takes down sibling requests that were
   * behaving. That is unavoidable: the thread is wedged, so there is no way to
   * run only the healthy work, and leaving the UI frozen is strictly worse.
   */
  #hardKill(error: Error): void {
    this.#worker?.terminate();
    this.#worker = null;
    this.#failAll(error);
  }

  /** Sniff a file: schema, preview rows and any file-level issues. */
  inspect(bytes: ArrayBuffer): Promise<WorkerResponse> {
    // Send a copy and transfer that, so the caller's buffer is never detached
    // and can be reused for the later convert.
    const copy = bytes.slice(0);
    return this.#post({ kind: 'inspect', id: this.#nextId(), bytes: copy }, copy);
  }

  /** Parse and emit. Pass the user-corrected schema to honour their overrides. */
  convert(request: Omit<Extract<WorkerRequest, { kind: 'convert' }>, 'kind' | 'id'>): Promise<WorkerResponse> {
    const copy = request.bytes.slice(0);
    return this.#post({ ...request, kind: 'convert', id: this.#nextId(), bytes: copy }, copy);
  }

  #post(request: WorkerRequest, transfer: ArrayBuffer): Promise<WorkerResponse> {
    const worker = this.#ensure();
    return new Promise<WorkerResponse>((resolve, reject) => {
      // Armed before the post, not after: `postMessage` on a wedged worker
      // returns normally, so there is no later point that is guaranteed to run.
      const watchdog = setTimeout(() => {
        this.#hardKill(new WorkerTimeoutError());
      }, WORKER_WATCHDOG_MS);

      this.#pending.set(request.id, { resolve, reject, watchdog });

      try {
        worker.postMessage(request, [transfer]);
      } catch (cause) {
        this.#settle(request.id);
        reject(cause instanceof Error ? cause : new Error('Could not reach the worker.'));
      }
    });
  }

  /** Public teardown, e.g. from a React effect cleanup on unmount. */
  terminate(): void {
    this.#hardKill(new Error('Worker terminated.'));
  }
}

/** Triggers a local download of `bytes` without ever leaving the browser. */
export function downloadBytes(bytes: ArrayBuffer, filename: string, mimeType: string): void {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously can cancel the download in some browsers; one turn
  // of the event loop is enough for the navigation to have been queued.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** OFX and its Intuit variants are SGML; the dialect only changes the suffix. */
export function mimeForDialect(dialect: string): string {
  switch (dialect) {
    case 'qbo':
      return 'application/vnd.intu.qbo';
    case 'qfx':
      return 'application/vnd.intu.qfx';
    default:
      return 'application/x-ofx';
  }
}

/**
 * `chase statement (2024).csv` -> `chase_statement_2024_converted.ofx`.
 * Keeps the source name recognisable in a downloads folder full of exports.
 */
export function downloadFilename(sourceName: string, dialect: string): string {
  const base = sourceName.replace(/\.[^.]+$/, '');
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `${slug === '' ? 'statement' : slug}_converted.${dialect}`;
}
