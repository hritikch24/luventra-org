'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import type { CsvPreview } from '@/app/lib/preview';

const ACCEPTED = '.csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values';

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
        className="flex items-center gap-2.5 border border-zinc-800/60 bg-zinc-900 px-3 py-2.5 transition-[colors,box-shadow] duration-150 hover:border-zinc-700 hover:shadow-[0_0_20px_rgba(39,39,42,0.6)]"
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
        className={`border border-dashed transition-[colors,box-shadow] duration-150 ${
          dragging
            ? 'border-emerald-500/70 bg-emerald-500/[0.07] shadow-[0_0_24px_rgba(16,185,129,0.22),inset_0_0_20px_rgba(16,185,129,0.06)]'
            : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/70 hover:shadow-[0_0_20px_rgba(39,39,42,0.6)]'
        }`}
      >
        <label
          htmlFor={inputId}
          aria-describedby={hintId}
          className="group flex cursor-pointer flex-col items-center justify-center gap-2 px-4 py-8"
        >
          <Upload
            className={`size-4 transition-colors duration-150 ${
              dragging
                ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.55)]'
                : 'text-zinc-400 group-hover:text-zinc-400'
            }`}
            aria-hidden
          />
          <span
            className={`font-mono text-xs transition-colors duration-150 ${
              dragging ? 'text-emerald-300' : 'text-zinc-400'
            }`}
          >
            {busy ? 'reading…' : dragging ? 'release to load' : 'drop statement'}
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

      <p id={hintId} className="mt-2 text-[0.6875rem] leading-relaxed text-zinc-400">
        Accepts CSV, TSV and delimited TXT exports. The file is read in your browser and is never
        uploaded.
      </p>

      {error ? (
        <p role="alert" className="mt-2 border-l border-red-500/60 bg-red-500/5 px-2 py-1.5 text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
