'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { ANON_DAILY_LIMIT } from '@/app/lib/conversion-limiter';
import { CONFIG_LABEL } from './surface';

interface GuestLimitModalProps {
  readonly open: boolean;
  /** Epoch ms the guest window resets, when known. */
  readonly resetsAt: number | null;
  readonly onClose: () => void;
}

/** "in 7 hours" / "in 24 minutes", or null when the reset time is unknown. */
function untilReset(resetsAt: number | null): string | null {
  if (resetsAt === null) return null;
  const ms = resetsAt - Date.now();
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Shown when a guest's daily conversion allowance is spent.
 *
 * Deliberately not a wall: the dialog is dismissible, Escape closes it, and
 * closing returns the visitor to a workspace with their file still loaded and
 * their mapping intact. The guest flow is the product — this asks at the point
 * the visitor has already had value twice, and accepts no for an answer.
 */
export function GuestLimitModal({ open, resetsAt, onClose }: GuestLimitModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // `showModal()` supplies focus trapping, Escape and the top layer.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const reset = untilReset(resetsAt);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="guest-limit-title"
      className="m-auto w-[24rem] max-w-[calc(100vw-2rem)] border border-zinc-200 bg-white/95 p-0 text-zinc-900 backdrop-blur-md backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
        <h2 id="guest-limit-title" className={CONFIG_LABEL}>
          Guest threshold reached
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1 text-zinc-500 transition-colors duration-150 hover:text-zinc-900 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className="px-4 py-4">
        <p className="text-sm leading-relaxed text-zinc-700">
          Daily guest threshold reached. Create a free account to unlock unlimited conversions.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          Guests get {ANON_DAILY_LIMIT} conversions every 24 hours
          {reset ? `; this one resets ${reset}` : ''}. Your file stays loaded — close this to keep
          working on the mapping.
        </p>

        <div className="mt-4 flex items-center gap-2">
          <Link
            href="/login"
            className="flex-1 bg-zinc-900 px-3 py-2 text-center text-xs font-semibold tracking-tight text-white transition-[colors,box-shadow] duration-150 hover:shadow-[0_0_15px_rgba(16,185,129,0.5)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            Create free account
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="border border-zinc-200 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-zinc-500 transition-colors duration-150 hover:border-zinc-300 hover:text-zinc-900 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
          >
            Not now
          </button>
        </div>
      </div>
    </dialog>
  );
}
