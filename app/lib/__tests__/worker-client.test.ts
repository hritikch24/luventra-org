import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROCESSING_TIMEOUT_MS } from '@/app/worker/guards';
import type { WorkerResponse } from '@/app/worker/types';

/**
 * Tests for the main-thread termination backstop.
 *
 * The worker's own deadline is cooperative and cannot fire when the thread is
 * genuinely wedged, so this watchdog is the only thing standing between a
 * pathological file and a permanently frozen UI. It is exercised here against
 * a fake `Worker` that can be made to hang on demand.
 */

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  terminated = false;
  readonly posted: unknown[] = [];
  /** When true, postMessage silently swallows the request, as a wedge does. */
  hang = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown, _transfer?: Transferable[]): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Simulates the worker replying to the request with the given id. */
  respond(id: string, extra: Partial<WorkerResponse> = {}): void {
    this.onmessage?.({
      data: { kind: 'failed', id, issues: [], ...extra } as WorkerResponse,
    } as MessageEvent<WorkerResponse>);
  }
}

let StatementWorkerClient: typeof import('../worker-client').StatementWorkerClient;
let WorkerTimeoutError: typeof import('../worker-client').WorkerTimeoutError;
let WORKER_WATCHDOG_MS: number;

beforeEach(async () => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.useFakeTimers();
  vi.resetModules();
  const mod = await import('../worker-client');
  StatementWorkerClient = mod.StatementWorkerClient;
  WorkerTimeoutError = mod.WorkerTimeoutError;
  WORKER_WATCHDOG_MS = mod.WORKER_WATCHDOG_MS;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Starts a request and attaches a rejection handler immediately.
 *
 * With fake timers the watchdog fires inside `advanceTimersByTimeAsync`, which
 * is before a trailing `expect(...).rejects` would attach its handler -- Node
 * sees an unhandled rejection in the gap. Capturing eagerly closes it.
 */
function capture(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (value) => value,
    (error: unknown) => error,
  );
}

function buffer(): ArrayBuffer {
  return new TextEncoder().encode('Date,Description,Amount\n').slice().buffer as ArrayBuffer;
}

describe('watchdog budget', () => {
  it('sits exactly one second past the worker deadline', () => {
    expect(WORKER_WATCHDOG_MS).toBe(PROCESSING_TIMEOUT_MS + 1_000);
    expect(WORKER_WATCHDOG_MS).toBe(16_000);
  });
});

describe('hard kill on a wedged worker', () => {
  it('terminates the thread when no response arrives in time', async () => {
    const client = new StatementWorkerClient();
    const settled = capture(client.inspect(buffer()));
    const worker = FakeWorker.instances[0]!;

    expect(worker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(WORKER_WATCHDOG_MS);

    expect(await settled).toBeInstanceOf(WorkerTimeoutError);
    expect(worker.terminated).toBe(true);
  });

  it('does not fire one tick early', async () => {
    const client = new StatementWorkerClient();
    const promise = client.inspect(buffer());
    const worker = FakeWorker.instances[0]!;

    await vi.advanceTimersByTimeAsync(WORKER_WATCHDOG_MS - 1);
    expect(worker.terminated).toBe(false);

    // Settle it so the pending rejection does not leak into the next test.
    worker.respond('req-1');
    await expect(promise).resolves.toMatchObject({ kind: 'failed' });
  });

  it('gives the user an actionable message rather than a generic error', async () => {
    const client = new StatementWorkerClient();
    const settled = capture(client.inspect(buffer()));
    await vi.advanceTimersByTimeAsync(WORKER_WATCHDOG_MS);

    const error = (await settled) as Error;
    expect(error.name).toBe('WorkerTimeoutError');
    expect(error.message).toMatch(/did not finish within 16 seconds/);
    expect(error.message).toMatch(/re-exporting|splitting/);
  });

  it('fails sibling requests too, since termination is indiscriminate', async () => {
    const client = new StatementWorkerClient();
    const first = capture(client.inspect(buffer()));
    const second = capture(client.inspect(buffer()));

    await vi.advanceTimersByTimeAsync(WORKER_WATCHDOG_MS);

    expect(await first).toBeInstanceOf(WorkerTimeoutError);
    expect(await second).toBeInstanceOf(WorkerTimeoutError);
  });

  it('spawns a fresh worker for the next request after a kill', async () => {
    const client = new StatementWorkerClient();
    const settled = capture(client.inspect(buffer()));
    await vi.advanceTimersByTimeAsync(WORKER_WATCHDOG_MS);
    expect(await settled).toBeInstanceOf(WorkerTimeoutError);

    expect(FakeWorker.instances).toHaveLength(1);
    const next = client.inspect(buffer());
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1]!.terminated).toBe(false);

    FakeWorker.instances[1]!.respond('req-2');
    await expect(next).resolves.toMatchObject({ kind: 'failed' });
  });
});

describe('the cooperative path is allowed to win', () => {
  it('lets a worker-reported system-timeout resolve normally', async () => {
    const client = new StatementWorkerClient();
    const promise = client.inspect(buffer());
    const worker = FakeWorker.instances[0]!;

    // The worker notices its own 15s budget and reports it at 15s.
    await vi.advanceTimersByTimeAsync(PROCESSING_TIMEOUT_MS);
    worker.respond('req-1', {
      kind: 'failed',
      issues: [{ level: 'error', code: 'system-timeout', message: 'timed out' }],
    });

    const response = await promise;
    expect(response.kind).toBe('failed');
    expect(response.issues[0]?.code).toBe('system-timeout');

    // The watchdog must have been disarmed, and the worker kept warm.
    await vi.advanceTimersByTimeAsync(WORKER_WATCHDOG_MS * 2);
    expect(worker.terminated).toBe(false);
  });

  it('disarms the watchdog on an ordinary successful response', async () => {
    const client = new StatementWorkerClient();
    const promise = client.inspect(buffer());
    const worker = FakeWorker.instances[0]!;

    worker.respond('req-1');
    await promise;

    await vi.advanceTimersByTimeAsync(WORKER_WATCHDOG_MS * 2);
    expect(worker.terminated).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('reuses one warm worker across sequential requests', async () => {
    const client = new StatementWorkerClient();
    for (let i = 1; i <= 3; i += 1) {
      const promise = client.inspect(buffer());
      FakeWorker.instances[0]!.respond(`req-${i}`);
      await promise;
    }
    expect(FakeWorker.instances).toHaveLength(1);
  });
});

describe('other failure paths still settle', () => {
  it('rejects and disarms on a worker-level error event', async () => {
    const client = new StatementWorkerClient();
    const promise = client.inspect(buffer());
    const worker = FakeWorker.instances[0]!;

    const settled = capture(promise);
    worker.onerror?.({ message: 'boom' } as ErrorEvent);
    expect((await settled) as Error).toHaveProperty('message', 'boom');

    // No lingering watchdog should fire against an already-settled request.
    await vi.advanceTimersByTimeAsync(WORKER_WATCHDOG_MS * 2);
    expect(worker.terminated).toBe(false);
  });

  it('rejects on an unreadable message', async () => {
    const client = new StatementWorkerClient();
    const settled = capture(client.inspect(buffer()));
    FakeWorker.instances[0]!.onmessageerror?.();
    expect(((await settled) as Error).message).toMatch(/could not be read/);
  });

  it('ignores a stale response for an unknown id', async () => {
    const client = new StatementWorkerClient();
    const promise = client.inspect(buffer());
    const worker = FakeWorker.instances[0]!;

    expect(() => worker.respond('req-does-not-exist')).not.toThrow();
    worker.respond('req-1');
    await expect(promise).resolves.toBeDefined();
  });

  it('explicit terminate() rejects everything in flight', async () => {
    const client = new StatementWorkerClient();
    const settled = capture(client.inspect(buffer()));
    const worker = FakeWorker.instances[0]!;

    client.terminate();
    expect((await settled) as Error).toHaveProperty('message', 'Worker terminated.');
    expect(worker.terminated).toBe(true);
  });

  it('survives terminate() with nothing in flight', () => {
    const client = new StatementWorkerClient();
    expect(() => client.terminate()).not.toThrow();
  });
});
