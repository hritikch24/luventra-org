'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import type { CsvPreview } from '@/app/lib/preview';
import { PILL } from './surface';

const ACCEPTED = '.csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values';

/** Shown as pills; mirrors the extensions in ACCEPTED. */
const ACCEPTED_LABELS = ['.CSV', '.TSV', '.TXT'] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)}${units[unit]}`;
}

function delimiterLabel(delimiter: string): string {
  switch (delimiter) {
    case ',':
      return 'CSV';
    case ';':
      return 'SSV';
    case '\t':
      return 'TSV';
    case '|':
      return 'PSV';
    default:
      return 'DSV';
  }
}

interface FileDropzoneProps {
  readonly preview: CsvPreview | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onFile: (file: File) => void;
  readonly onClear: () => void;
}

export function FileDropzone({ preview, busy, error, onFile, onClear }: FileDropzoneProps) {
  const inputId = useId();
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  // Drag events bubble from every child, so depth-count instead of toggling
  // on enter/leave — otherwise the highlight strobes as the cursor moves.
  const dragDepth = useRef(0);

  const take = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  if (preview) {
    return (
      <div
        role="region"
        aria-label="Loaded statement file"
        className="flex items-center gap-2.5 border border-zinc-800 bg-zinc-900 px-3 py-2.5 transition-[colors,box-shadow] duration-150 hover:border-zinc-700 hover:shadow-[0_0_20px_rgba(39,39,42,0.6)]"
      >
        <FileText className="size-4 shrink-0 text-zinc-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-zinc-100">{preview.fileName}</p>
          <p className="mt-1 font-mono text-[0.6875rem] text-zinc-400 tnum">
            {formatBytes(preview.byteSize)} · {preview.rows.length.toLocaleString()}×
            {preview.headers.length} · {delimiterLabel(preview.delimiter)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Remove file"
          className="shrink-0 p-1 text-zinc-400 transition-colors duration-150 hover:text-zinc-200 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div role="region" aria-label="Statement file input" aria-describedby={hintId}>
      {/*
        The placement zone.

        No dashed box and no upload glyph: at rest this is a plain matte plane
        held by a hairline, with corner registration marks cut into it — the
        way a drop target is indicated on an instrument rather than in a stock
        upload widget. The emerald ring is spent exclusively on the one moment
        it carries information: a file is over the target and will be taken if
        released. Nothing else in the zero state competes for that colour.
      */}
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          take(event.dataTransfer.files);
        }}
        className={`relative transition-[colors,box-shadow] duration-150 ${
          dragging
            ? 'bg-emerald-500/[0.06] ring-1 ring-emerald-400/70 shadow-[0_0_0_1px_rgba(16,185,129,0.25),inset_0_0_28px_rgba(16,185,129,0.08)]'
            : 'border border-zinc-800/60 bg-zinc-950/40 hover:border-zinc-700 hover:bg-zinc-900/40'
        }`}
      >
        {/* Registration marks. Four 8px corner rules, drawn only at rest so the
            drag ring reads as a single uninterrupted outline. */}
        {dragging ? null : (
          <>
            <span aria-hidden className="pointer-events-none absolute left-0 top-0 size-2 border-l border-t border-zinc-700" />
            <span aria-hidden className="pointer-events-none absolute right-0 top-0 size-2 border-r border-t border-zinc-700" />
            <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 size-2 border-b border-l border-zinc-700" />
            <span aria-hidden className="pointer-events-none absolute bottom-0 right-0 size-2 border-b border-r border-zinc-700" />
          </>
        )}

        <label
          htmlFor={inputId}
          aria-describedby={hintId}
          className="group flex cursor-pointer flex-col items-center gap-4 px-5 py-10"
        >
          <span
            className={`flex size-11 items-center justify-center rounded-full border transition-colors duration-150 ${
              dragging
                ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300 group-hover:border-emerald-500/50 group-hover:text-emerald-300'
            }`}
          >
            <Upload className="size-5" aria-hidden />
          </span>

          <span className="flex flex-col items-center gap-1 text-center">
            <span
              className={`text-sm font-medium tracking-tight transition-colors duration-150 ${
                dragging ? 'text-emerald-300' : 'text-zinc-50'
              }`}
            >
              {busy ? 'Reading your file…' : dragging ? 'Release to load' : 'Drop your statement here'}
            </span>
            <span className="text-xs text-zinc-400">
              {busy ? 'Parsing in your browser' : 'or choose a file from your computer'}
            </span>
          </span>

          {/*
            A real button, not a hint that the panel is clickable.
            The previous zero state was a dim bordered box reading "PLACE
            STATEMENT" in 11px mono caps with no icon and no control — it read
            as a status label, so visitors did not know a file went there. This
            is a <span> inside the <label>, so the whole panel still opens the
            picker and there is no nested interactive element.
          */}
          <span
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold tracking-tight transition-[colors,box-shadow] duration-150 ${
              dragging
                ? 'bg-emerald-400 text-zinc-950'
                : 'bg-white text-zinc-950 group-hover:shadow-[0_0_15px_rgba(16,185,129,0.45)]'
            }`}
          >
            Choose file
          </span>

          <span className="flex items-center gap-1.5">
            {ACCEPTED_LABELS.map((label) => (
              <span
                key={label}
                className={`${PILL} transition-colors duration-150 ${
                  dragging ? 'border-emerald-500/40 text-emerald-300/90' : ''
                }`}
              >
                {label}
              </span>
            ))}
          </span>

          <input
            id={inputId}
            type="file"
            accept={ACCEPTED}
            className="sr-only"
            onChange={(event) => {
              take(event.target.files);
              // Reset so the same file can be picked again after a clear.
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {/* Trust microcopy. Sits under the target, ruled off by a left hairline
          so it reads as an annotation on the zone rather than body copy. */}
      <p
        id={hintId}
        className="mt-2 border-l border-zinc-800 pl-2.5 text-[11px] leading-relaxed text-zinc-400"
      >
        Data is parsed entirely in local memory via client-side Web Workers. Zero server uploads.
        Impenetrable compliance.
      </p>

      {error ? (
        <p role="alert" className="mt-2 border-l border-red-500/60 bg-red-500/5 px-2 py-1.5 text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
