import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerRequest, WorkerResponse } from '../types';
import { PROCESSING_TIMEOUT_MS } from '../guards';
import { BINARY_PAYLOADS, META, MIXED_CURRENCY_COLUMN_CSV, US_CSV, bytes, largeCsv, toUtf16, withUtf8Bom } from './fixtures';

/**
 * Harness for the worker entry point.
 *
 * `index.worker.ts` installs its handlers on `self` at import time, so a stub
 * global has to exist before the module is loaded, and the module registry has
 * to be reset between tests to re-run that side effect.
 */
interface WorkerStub {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  onunhandledrejection: ((event: PromiseRejectionEvent) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
}

let stub: WorkerStub;
let posted: WorkerResponse[];
let transfers: (Transferable[] | undefined)[];

beforeEach(async () => {
  posted = [];
  transfers = [];
  stub = {
    onmessage: null,
    onunhandledrejection: null,
    postMessage: (message, transfer) => {
      posted.push(message);
      transfers.push(transfer);
    },
  };
  vi.stubGlobal('self', stub);
  vi.resetModules();
  await import('../index.worker');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Drives one request through the loop and returns the single response. */
function send(request: unknown): WorkerResponse {
  stub.onmessage?.({ data: request } as MessageEvent<WorkerRequest>);
  expect(posted).toHaveLength(1);
  return posted[0]!;
}

function buffer(text: string): ArrayBuffer {
  const view = bytes(text);
  return view.slice().buffer as ArrayBuffer;
}

describe('message loop wiring', () => {
  it('installs an onmessage handler at import time', () => {
    expect(typeof stub.onmessage).toBe('function');
  });

  it('installs an unhandled-rejection net', () => {
    expect(typeof stub.onunhandledrejection).toBe('function');
  });
});

describe('inspect', () => {
  it('returns the inferred schema and a preview', () => {
    const response = send({ kind: 'inspect', id: 'req-1', bytes: buffer(US_CSV) });
    expect(response.kind).toBe('inspected');
    if (response.kind !== 'inspected') return;
    expect(response.id).toBe('req-1');
    expect(response.schema.delimiter.delimiter).toBe(',');
    expect(response.schema.dateFormat.order).toBe('MDY');
    expect(response.preview).toHaveLength(3);
    expect(response.preview[0]?.[1]).toBe('BLUE BOTTLE COFFEE');
  });

  it('fails cleanly when no date column can be found', () => {
    const response = send({
      kind: 'inspect',
      id: 'req-2',
      bytes: buffer('Foo,Bar\nalpha,bravo\ncharlie,delta\n'),
    });
    expect(response.kind).toBe('failed');
    expect(response.issues.some((i) => i.level === 'error')).toBe(true);
  });
});

describe('convert', () => {
  it('returns the document string, its bytes, and a count', () => {
    const response = send({
      kind: 'convert',
      id: 'req-3',
      bytes: buffer(US_CSV),
      meta: META,
      dialect: 'qbo',
    });
    expect(response.kind).toBe('converted');
    if (response.kind !== 'converted') return;
    expect(response.transactionCount).toBe(3);
    expect(response.filename).toBe('statement.qbo');
    expect(response.document.startsWith('OFXHEADER:100\r\n')).toBe(true);
    expect(response.document).toContain('<INTU.BID>10898');
    expect(response.bytes.byteLength).toBe(response.document.length);
  });

  it('transfers the payload buffer instead of copying it', () => {
    send({ kind: 'convert', id: 'req-4', bytes: buffer(US_CSV), meta: META, dialect: 'ofx' });
    const response = posted[0]!;
    expect(response.kind).toBe('converted');
    if (response.kind !== 'converted') return;
    expect(transfers[0]).toEqual([response.bytes]);
  });

  it('honours a caller-supplied filename', () => {
    const response = send({
      kind: 'convert',
      id: 'req-5',
      bytes: buffer(US_CSV),
      meta: META,
      dialect: 'ofx',
      filename: 'january.ofx',
    });
    expect(response.kind === 'converted' && response.filename).toBe('january.ofx');
  });

  it('reports skipped rows as warnings on an otherwise successful convert', () => {
    const csv = 'Date,Description,Amount\n01/03/2025,GOOD,-1.00\nNOT-A-DATE,BROKEN,-2.00\n01/05/2025,ALSO GOOD,-3.00\n';
    const response = send({
      kind: 'convert',
      id: 'req-6',
      bytes: buffer(csv),
      meta: META,
      dialect: 'ofx',
    });
    expect(response.kind).toBe('converted');
    if (response.kind !== 'converted') return;
    expect(response.transactionCount).toBe(2);
    expect(response.issues.some((i) => i.level === 'warning' && i.code === 'bad-date')).toBe(true);
  });

  it('fails when nothing at all could be parsed', () => {
    const response = send({
      kind: 'convert',
      id: 'req-7',
      bytes: buffer('Date,Description,Amount\nNOT-A-DATE,BROKEN,oops\n'),
      meta: META,
      dialect: 'ofx',
    });
    expect(response.kind).toBe('failed');
    expect(response.issues[0]?.level).toBe('error');
  });

  it('honours a user-corrected schema instead of re-inferring', () => {
    const input = buffer(US_CSV);
    const inspected = send({ kind: 'inspect', id: 'req-8', bytes: input });
    expect(inspected.kind).toBe('inspected');
    if (inspected.kind !== 'inspected') return;

    posted.length = 0;
    // Flip the inferred MDY to DMY, as an override toggle would.
    const corrected = { ...inspected.schema, dateFormat: { ...inspected.schema.dateFormat, order: 'DMY' as const } };
    const response = send({
      kind: 'convert',
      id: 'req-9',
      bytes: buffer(US_CSV),
      meta: META,
      dialect: 'ofx',
      schema: corrected,
    });
    expect(response.kind).toBe('converted');
    if (response.kind !== 'converted') return;
    // 01/03 read as DMY is 3 January -> 20250301, not 20250103.
    expect(response.document).toContain('<DTPOSTED>20250301');
  });
});

describe('failure handling', () => {
  it('rejects a malformed request without an id', () => {
    const response = send({ kind: 'convert' });
    expect(response.kind).toBe('failed');
    expect(response.id).toBe('unknown');
    expect(response.issues[0]?.code).toBe('bad-request');
  });

  it('rejects a null payload', () => {
    const response = send(null);
    expect(response.kind).toBe('failed');
  });

  it('rejects an unknown request kind but keeps the correlation id', () => {
    const response = send({ kind: 'frobnicate', id: 'req-10' });
    expect(response.kind).toBe('failed');
    expect(response.id).toBe('req-10');
    expect(response.issues[0]?.code).toBe('unknown-kind');
  });

  it('catches a throw from the engine and correlates it by id', () => {
    // A detached buffer throws inside the engine, not at the boundary.
    const detached = buffer(US_CSV);
    structuredClone(detached, { transfer: [detached] });
    const response = send({ kind: 'inspect', id: 'req-11', bytes: detached });
    expect(response.kind).toBe('failed');
    expect(response.id).toBe('req-11');
    expect(response.issues[0]?.code).toBe('worker-exception');
    expect(response.issues[0]?.message).toMatch(/\w+: /);
  });

  it('serializes issues as plain structured-cloneable objects', () => {
    const response = send({ kind: 'frobnicate', id: 'req-12' });
    expect(() => structuredClone(response)).not.toThrow();
    for (const issue of response.issues) {
      expect(issue).not.toBeInstanceOf(Error);
      expect(typeof issue.message).toBe('string');
    }
  });

  it('reports an unhandled rejection rather than leaving the UI hanging', () => {
    const event = {
      reason: new Error('boom'),
      preventDefault: vi.fn(),
    } as unknown as PromiseRejectionEvent;
    stub.onunhandledrejection?.(event);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.kind).toBe('failed');
    expect(posted[0]?.issues[0]?.message).toContain('boom');
  });
});

describe('response contract', () => {
  it('emits exactly one response per request', () => {
    send({ kind: 'convert', id: 'req-13', bytes: buffer(US_CSV), meta: META, dialect: 'ofx' });
    expect(posted).toHaveLength(1);
  });

  it('survives a structured-clone round trip, bigints included', () => {
    const response = send({ kind: 'inspect', id: 'req-14', bytes: buffer(US_CSV) });
    expect(() => structuredClone(response)).not.toThrow();
  });
});

describe('hardening at the worker boundary', () => {
  function bufferOf(view: Uint8Array): ArrayBuffer {
    return view.slice().buffer as ArrayBuffer;
  }

  it('rejects a PDF payload before it reaches the parser', () => {
    const response = send({ kind: 'inspect', id: 'h-1', bytes: bufferOf(BINARY_PAYLOADS.pdf!) });
    expect(response.kind).toBe('failed');
    expect(response.issues[0]?.code).toBe('unsupported-content');
    expect(response.issues[0]?.message).toContain('PDF');
  });

  it.each(Object.keys(BINARY_PAYLOADS))('rejects a %s payload on convert', (name) => {
    const response = send({
      kind: 'convert',
      id: `h-${name}`,
      bytes: bufferOf(BINARY_PAYLOADS[name]!),
      meta: META,
      dialect: 'ofx',
    });
    expect(response.kind).toBe('failed');
    expect(response.issues[0]?.code).toBe('unsupported-content');
  });

  it('reports an empty file with its own code', () => {
    const response = send({ kind: 'inspect', id: 'h-2', bytes: new ArrayBuffer(0) });
    expect(response.kind).toBe('failed');
    expect(response.issues[0]?.code).toBe('empty-file');
  });

  it('accepts a BOM-prefixed file and maps its columns', () => {
    const response = send({ kind: 'inspect', id: 'h-3', bytes: bufferOf(withUtf8Bom(US_CSV)) });
    expect(response.kind).toBe('inspected');
    if (response.kind !== 'inspected') return;
    expect(response.schema.columns.map((c) => c.role)).toEqual([
      'date',
      'description',
      'amount',
      'balance',
    ]);
  });

  it('accepts UTF-16 without mistaking its NUL bytes for binary', () => {
    const response = send({ kind: 'inspect', id: 'h-4', bytes: bufferOf(toUtf16(US_CSV, true)) });
    expect(response.kind).toBe('inspected');
  });

  it('fails a multi-currency file instead of silently mixing rates', () => {
    const response = send({
      kind: 'convert',
      id: 'h-5',
      bytes: bufferOf(bytes(MIXED_CURRENCY_COLUMN_CSV)),
      meta: META,
      dialect: 'ofx',
    });
    expect(response.kind).toBe('failed');
    expect(response.issues.some((i) => i.code === 'multi-currency')).toBe(true);
  });

  it('returns a system-timeout response rather than freezing the thread', () => {
    // Advance the clock only AFTER the Deadline is constructed: the first
    // reading is the start time, every later one is past the budget. Offsetting
    // both would leave elapsed at zero and silently prove nothing.
    let calls = 0;
    const realNow = performance.now.bind(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => {
      calls += 1;
      return calls === 1 ? realNow() : realNow() + PROCESSING_TIMEOUT_MS + 1_000;
    });

    const response = send({
      kind: 'convert',
      id: 'h-6',
      bytes: bufferOf(bytes(largeCsv(50_000))),
      meta: META,
      dialect: 'ofx',
    });

    vi.restoreAllMocks();
    expect(response.kind).toBe('failed');
    expect(response.id).toBe('h-6');
    expect(response.issues[0]?.code).toBe('system-timeout');
    expect(response.issues[0]?.message).toContain('15 seconds');
  });

  it('reports a timeout as a clean issue, not a leaked TimeoutError', () => {
    let calls = 0;
    const realNow = performance.now.bind(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => {
      calls += 1;
      return calls === 1 ? realNow() : realNow() + PROCESSING_TIMEOUT_MS + 1_000;
    });

    const response = send({ kind: 'inspect', id: 'h-6b', bytes: bufferOf(bytes(largeCsv(50_000))) });

    vi.restoreAllMocks();
    expect(response.kind).toBe('failed');
    expect(response.issues[0]?.code).toBe('system-timeout');
    expect(() => structuredClone(response)).not.toThrow();
    expect(response.issues[0]).not.toBeInstanceOf(Error);
  });

  it('handles a 100,000 row file end to end', () => {
    const response = send({
      kind: 'convert',
      id: 'h-7',
      bytes: bufferOf(bytes(largeCsv(100_000))),
      meta: META,
      dialect: 'qbo',
    });
    expect(response.kind).toBe('converted');
    if (response.kind !== 'converted') return;
    expect(response.transactionCount).toBe(100_000);
    expect(response.document.endsWith('</OFX>\r\n')).toBe(true);
  });

  it('never leaks an unhandled exception for any hostile payload', () => {
    const payloads: Uint8Array[] = [
      new Uint8Array(0),
      new Uint8Array([0x00]),
      bytes('\uFEFF'),
      bytes(',,,,,\n,,,,,\n'),
      bytes('"unterminated quote\n01/03/2025,A,-1.00\n'),
      ...Object.values(BINARY_PAYLOADS),
    ];
    for (const [index, payload] of payloads.entries()) {
      posted.length = 0;
      expect(() =>
        stub.onmessage?.({
          data: { kind: 'convert', id: `h-fuzz-${index}`, bytes: bufferOf(payload), meta: META, dialect: 'ofx' },
        } as MessageEvent<WorkerRequest>),
      ).not.toThrow();
      expect(posted).toHaveLength(1);
      expect(posted[0]?.issues.every((i) => typeof i.message === 'string')).toBe(true);
    }
  });
});
