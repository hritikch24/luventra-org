import { describe, expect, it, vi } from 'vitest';

import {
  Deadline,
  MAX_INPUT_BYTES,
  NO_DEADLINE,
  PROCESSING_TIMEOUT_MS,
  TimeoutError,
  inspectContent,
  validateContentType,
} from '../guards';
import { inferSchema, parseTransactions } from '../parser';
import { ACCOUNT, BINARY_PAYLOADS, US_CSV, bytes, largeCsv, toUtf16 } from './fixtures';

describe('content-type validation', () => {
  it('accepts a plain CSV', () => {
    expect(inspectContent(bytes(US_CSV)).kind).toBe('text');
    expect(validateContentType(bytes(US_CSV))).toBeNull();
  });

  it('accepts tabs, CR, LF and form feed as legitimate text bytes', () => {
    expect(inspectContent(bytes('a\tb\r\nc\n\fd')).kind).toBe('text');
  });

  it('accepts high-byte text such as Windows-1252 accents', () => {
    expect(inspectContent(new Uint8Array([0x43, 0x41, 0x46, 0xc9, 0x0a])).kind).toBe('text');
  });

  it.each([
    ['pdf', 'PDF'],
    ['xlsx', 'ZIP'],
    ['xls', 'legacy Office'],
    ['png', 'PNG'],
    ['jpeg', 'JPEG'],
    ['gzip', 'gzip'],
    ['sqlite', 'SQLite'],
  ])('names a %s payload in the rejection message', (key, expected) => {
    const inspection = inspectContent(BINARY_PAYLOADS[key]!);
    expect(inspection.kind).toBe('binary');
    expect(inspection.format).toContain(expected);
    expect(validateContentType(BINARY_PAYLOADS[key]!)?.code).toBe('unsupported-content');
  });

  it('rejects any payload containing a NUL byte', () => {
    const nulled = new Uint8Array([0x44, 0x61, 0x74, 0x65, 0x00, 0x41]);
    expect(inspectContent(nulled).kind).toBe('binary');
    expect(inspectContent(nulled).reason).toContain('NUL');
  });

  it('does not mistake UTF-16 text for binary despite its NUL bytes', () => {
    // UTF-16LE ASCII is half NUL bytes; only the BOM distinguishes it from a
    // binary blob, so the BOM check must run before the NUL check.
    for (const littleEndian of [true, false]) {
      expect(inspectContent(toUtf16(US_CSV, littleEndian)).kind).toBe('text');
      expect(validateContentType(toUtf16(US_CSV, littleEndian))).toBeNull();
    }
  });

  it('rejects a high density of control characters', () => {
    const noisy = new Uint8Array(1000);
    for (let i = 0; i < noisy.length; i += 1) noisy[i] = i % 2 === 0 ? 0x41 : 0x01;
    expect(inspectContent(noisy).kind).toBe('binary');
  });

  it('tolerates a stray control character in otherwise good text', () => {
    const text = bytes(`${US_CSV}`);
    expect(inspectContent(text).kind).toBe('text');
  });

  it('classifies an empty payload distinctly from a binary one', () => {
    expect(inspectContent(new Uint8Array(0)).kind).toBe('empty');
    expect(validateContentType(new Uint8Array(0))?.code).toBe('empty-file');
  });

  it('rejects a payload above the size cap without reading it', () => {
    // A sparse allocation: length is what the guard checks, so this costs
    // nothing to materialise beyond the virtual mapping.
    const huge = new Uint8Array(MAX_INPUT_BYTES + 1);
    const issue = validateContentType(huge);
    expect(issue?.code).toBe('file-too-large');
    expect(issue?.level).toBe('error');
  });

  it('returns issues as structured objects, never thrown errors', () => {
    for (const payload of Object.values(BINARY_PAYLOADS)) {
      expect(() => validateContentType(payload)).not.toThrow();
      const issue = validateContentType(payload)!;
      expect(issue.level).toBe('error');
      expect(typeof issue.message).toBe('string');
    }
  });
});

describe('processing deadline', () => {
  it('defaults to the documented 15 second budget', () => {
    expect(PROCESSING_TIMEOUT_MS).toBe(15_000);
  });

  it('does not fire while inside budget', () => {
    const deadline = new Deadline(10_000);
    expect(deadline.expired()).toBe(false);
    expect(() => deadline.check()).not.toThrow();
  });

  it('throws TimeoutError once the budget is spent', () => {
    const deadline = new Deadline(0);
    expect(deadline.expired()).toBe(true);
    expect(() => deadline.check()).toThrow(TimeoutError);
  });

  it('reports elapsed time on the error', () => {
    const deadline = new Deadline(0);
    try {
      deadline.check();
      expect.unreachable('check() should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).elapsedMs).toBeGreaterThanOrEqual(0);
      expect((error as TimeoutError).name).toBe('TimeoutError');
    }
  });

  it('never expires when NO_DEADLINE is used', () => {
    expect(NO_DEADLINE.expired()).toBe(false);
    expect(() => NO_DEADLINE.check()).not.toThrow();
  });

  it('aborts a large parse mid-file rather than running to completion', () => {
    // The guard is only real if it can interrupt work already in progress:
    // a synchronous bulk parse would ignore the budget entirely.
    const input = bytes(largeCsv(200_000));
    const deadline = new Deadline(1);
    expect(() => inferSchema(input, ACCOUNT, deadline)).toThrow(TimeoutError);
  });

  it('interrupts parseTransactions on a long row loop', () => {
    const input = bytes(largeCsv(200_000));
    const { schema } = inferSchema(input, ACCOUNT);
    expect(() => parseTransactions(input, schema, new Deadline(1))).toThrow(TimeoutError);
  });

  it('stops the parse mid-file instead of finishing it and complaining after', () => {
    // The distinction this pins down: a bulk parse would run the whole file to
    // completion and only then notice the budget was blown -- the thread stays
    // frozen for the full duration, which is exactly what the guard exists to
    // prevent. Aborting through Papa's step callback stops the work early.
    //
    // The threshold is self-calibrating against a full parse measured on this
    // same machine, so it does not encode any absolute timing assumption.
    const input = bytes(largeCsv(300_000));

    const beforeFull = performance.now();
    inferSchema(input, ACCOUNT);
    const fullParseMs = performance.now() - beforeFull;

    // Let the delimiter sniff pass, then expire the clock so the step loop
    // is what trips the deadline.
    let calls = 0;
    const realNow = performance.now.bind(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => {
      calls += 1;
      return calls <= 8 ? realNow() : realNow() + PROCESSING_TIMEOUT_MS + 1_000;
    });

    const beforeAborted = realNow();
    expect(() => inferSchema(input, ACCOUNT, new Deadline())).toThrow(TimeoutError);
    const abortedMs = realNow() - beforeAborted;
    vi.restoreAllMocks();

    expect(abortedMs).toBeLessThan(fullParseMs / 2);
  }, 60_000);

  it('completes normal work well inside the real budget', () => {
    const input = bytes(largeCsv(100_000));
    const deadline = new Deadline(PROCESSING_TIMEOUT_MS);
    const { schema } = inferSchema(input, ACCOUNT, deadline);
    const { transactions } = parseTransactions(input, schema, deadline);
    expect(transactions).toHaveLength(100_000);
    expect(deadline.expired()).toBe(false);
  });
});
