/**
 * Pre-flight guards: content-type validation and processing deadlines.
 *
 * These run before and during the parsing pipeline to keep two classes of
 * hostile input from reaching it:
 *
 *  - **Wrong file entirely.** A user drops a PDF or an .xlsx onto the drop
 *    zone. Papa Parse will happily "parse" the binary into thousands of junk
 *    rows, the inference stage will pick a delimiter out of the noise, and the
 *    user gets an incomprehensible mapping screen instead of "that's a PDF".
 *  - **Pathological content.** A crafted or corrupted file that drives the
 *    parser into a very long — or unbounded — run, freezing the worker.
 */

import type { ParseIssue } from './types';

/* ========================================================================== */
/* Limits                                                                     */
/* ========================================================================== */

/** Wall-clock budget for one request before it is abandoned. */
export const PROCESSING_TIMEOUT_MS = 15_000;

/**
 * Largest payload accepted, in bytes.
 *
 * A statement CSV is measured in megabytes at worst. This exists so a 2 GB
 * file cannot exhaust worker memory during `TextDecoder.decode`, which
 * allocates the entire string up front and cannot be chunked.
 */
export const MAX_INPUT_BYTES = 128 * 1024 * 1024;

/** Bytes inspected when sniffing for binary content. */
const SNIFF_BYTES = 4096;

/* ========================================================================== */
/* Deadline                                                                   */
/* ========================================================================== */

/** Thrown when a request exceeds `PROCESSING_TIMEOUT_MS`. */
export class TimeoutError extends Error {
  readonly elapsedMs: number;

  constructor(elapsedMs: number) {
    super(`Processing exceeded the ${PROCESSING_TIMEOUT_MS} ms limit (stopped at ${elapsedMs} ms).`);
    this.name = 'TimeoutError';
    this.elapsedMs = elapsedMs;
  }
}

/** Monotonic clock; `performance` is present in workers but not every runner. */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * A cooperative processing budget.
 *
 * **Cooperative is the operative word.** A worker is single-threaded, so
 * nothing inside it can preempt a synchronous loop — no timer fires, no
 * message is read, while the stack is busy. A deadline therefore only works if
 * the hot loops ask about it, which is why `check()` is called at row
 * boundaries throughout the parser and inside Papa Parse's `step` callback
 * (where `parser.abort()` can actually stop the parse mid-file).
 *
 * The main thread should still keep `worker.terminate()` as a backstop for the
 * pathological case where a single row takes forever; that lives on the UI
 * side of the boundary and is not this module's job.
 */
export class Deadline {
  private readonly startedAt: number;
  private readonly budgetMs: number;

  constructor(budgetMs: number = PROCESSING_TIMEOUT_MS) {
    this.budgetMs = budgetMs;
    this.startedAt = now();
  }

  elapsedMs(): number {
    return Math.round(now() - this.startedAt);
  }

  /** True once the budget is spent. Cheap enough to call per row. */
  expired(): boolean {
    return now() - this.startedAt >= this.budgetMs;
  }

  /** Throws `TimeoutError` if the budget is spent; otherwise returns. */
  check(): void {
    if (this.expired()) throw new TimeoutError(this.elapsedMs());
  }
}

/** A deadline that never expires, for callers that do not want the guard. */
export const NO_DEADLINE = new Deadline(Number.POSITIVE_INFINITY);

/* ========================================================================== */
/* Content-type validation                                                    */
/* ========================================================================== */

export type ContentKind = 'text' | 'binary' | 'empty';

export interface ContentInspection {
  readonly kind: ContentKind;
  /** Human-readable format name when a magic number matched, else null. */
  readonly format: string | null;
  /** Why it was judged binary; null for text. */
  readonly reason: string | null;
}

/**
 * Magic-number signatures for formats users mistake for a CSV export.
 *
 * `.xlsx`/`.ods` are ZIP containers and `.xls`/`.doc` are OLE2, so both are
 * caught by their container signature rather than needing a parser.
 */
const SIGNATURES: readonly { readonly bytes: readonly number[]; readonly format: string }[] = [
  { bytes: [0x25, 0x50, 0x44, 0x46], format: 'PDF' },
  { bytes: [0x50, 0x4b, 0x03, 0x04], format: 'ZIP or Office document (.xlsx/.ods/.docx)' },
  { bytes: [0x50, 0x4b, 0x05, 0x06], format: 'empty ZIP archive' },
  { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], format: 'legacy Office document (.xls/.doc)' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], format: 'PNG image' },
  { bytes: [0xff, 0xd8, 0xff], format: 'JPEG image' },
  { bytes: [0x47, 0x49, 0x46, 0x38], format: 'GIF image' },
  { bytes: [0x1f, 0x8b], format: 'gzip archive' },
  { bytes: [0x42, 0x5a, 0x68], format: 'bzip2 archive' },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], format: '7-Zip archive' },
  { bytes: [0x52, 0x61, 0x72, 0x21], format: 'RAR archive' },
  { bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65], format: 'SQLite database' },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], format: 'ELF executable' },
  { bytes: [0xca, 0xfe, 0xba, 0xbe], format: 'Mach-O or Java class file' },
  { bytes: [0x00, 0x61, 0x73, 0x6d], format: 'WebAssembly module' },
];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

/** UTF-16 text is full of NUL bytes, so its BOM must suppress the NUL check. */
function hasUtf16Bom(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  const [a, b] = [bytes[0], bytes[1]];
  return (a === 0xff && b === 0xfe) || (a === 0xfe && b === 0xff);
}

/**
 * Decides whether the payload is plausibly text before any parsing happens.
 *
 * Two independent tests, because neither alone is sufficient: a magic-number
 * check names the common wrong-file cases precisely, and a NUL/control-byte
 * density check catches everything else — a truncated download, a raw disk
 * block, an encrypted blob.
 *
 * A NUL byte is the decisive signal. It cannot appear in any text encoding
 * this pipeline supports (UTF-16 excepted, hence the BOM guard), and it is the
 * conventional binary marker used by `git` and `file` for the same reason.
 */
export function inspectContent(bytes: Uint8Array): ContentInspection {
  if (bytes.length === 0) {
    return { kind: 'empty', format: null, reason: 'The file is empty.' };
  }

  for (const signature of SIGNATURES) {
    if (startsWith(bytes, signature.bytes)) {
      return {
        kind: 'binary',
        format: signature.format,
        reason: `The file looks like a ${signature.format}, not a CSV or text export.`,
      };
    }
  }

  if (hasUtf16Bom(bytes)) {
    return { kind: 'text', format: null, reason: null };
  }

  const sample = bytes.subarray(0, Math.min(bytes.length, SNIFF_BYTES));
  let control = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const byte = sample[i]!;
    if (byte === 0x00) {
      return {
        kind: 'binary',
        format: null,
        reason: 'The file contains NUL bytes, so it is not a text export.',
      };
    }
    // Everything below 0x20 except tab, LF, CR, and form feed.
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) {
      control += 1;
    }
  }

  // Threshold, not zero tolerance: a stray 0x1a (DOS end-of-file) or a shell
  // colour escape in a piped export should not sink an otherwise fine file.
  if (control / sample.length > 0.05) {
    return {
      kind: 'binary',
      format: null,
      reason: `${Math.round((control / sample.length) * 100)}% of the leading bytes are control characters, so this is not a text export.`,
    };
  }

  return { kind: 'text', format: null, reason: null };
}

/**
 * Gate for the pipeline: returns a fatal issue when the payload must not be
 * parsed, or null when it may proceed.
 */
export function validateContentType(bytes: Uint8Array): ParseIssue | null {
  if (bytes.length > MAX_INPUT_BYTES) {
    return {
      level: 'error',
      code: 'file-too-large',
      message: `The file is ${Math.round(bytes.length / 1024 / 1024)} MB; the limit is ${MAX_INPUT_BYTES / 1024 / 1024} MB.`,
    };
  }

  const inspection = inspectContent(bytes);
  if (inspection.kind === 'text') return null;

  return {
    level: 'error',
    code: inspection.kind === 'empty' ? 'empty-file' : 'unsupported-content',
    message: inspection.reason ?? 'The file is not a supported text export.',
  };
}
