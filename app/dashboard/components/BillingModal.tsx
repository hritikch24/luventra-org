'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';

export const FREE_ROW_LIMIT = 50;

interface BillingModalProps {
  readonly open: boolean;
  readonly rowCount: number;
  readonly signedIn: boolean;
  readonly onClose: () => void;
}

export function BillingModal({ open, rowCount, signedIn, onClose }: BillingModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `showModal()` gives focus trapping and the top layer for free, which a
  // hand-rolled div overlay would have to reimplement.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function startCheckout() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/checkout', { method: 'POST' });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : 'Could not start checkout.';
        setError(message);
        return;
      }

      const url =
        typeof payload === 'object' && payload !== null && 'url' in payload
          ? String((payload as { url: unknown }).url)
          : null;

      if (!url) {
        setError('Checkout returned no redirect URL.');
        return;
      }
      window.location.href = url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start checkout.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="billing-title"
      className="m-auto w-[22rem] border border-zinc-800 bg-zinc-900 p-0 text-zinc-100 backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2">
        <h2 id="billing-title" className="text-xs font-medium text-zinc-100">
          Upgrade to convert this file
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1 text-zinc-400 transition-colors duration-150 hover:text-zinc-200"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className="px-3 py-3">
        <p className="text-[0.6875rem] leading-relaxed text-zinc-400">
          This statement has{' '}
          <span className="font-mono text-zinc-100 tnum">{rowCount.toLocaleString()}</span>{' '}
          transactions. The free tier converts up to{' '}
          <span className="font-mono text-zinc-100 tnum">{FREE_ROW_LIMIT}</span> per file.
        </p>

        {signedIn ? (
          <button
            type="button"
            onClick={() => void startCheckout()}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 bg-accent px-3 py-2 text-xs font-medium text-white transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Opening checkout…
              </>
            ) : (
              'Continue to checkout'
            )}
          </button>
        ) : (
          <a
            href="/login?next=/dashboard"
            className="mt-3 flex w-full items-center justify-center bg-accent px-3 py-2 text-xs font-medium text-white transition-colors duration-150 hover:bg-accent-hover"
          >
            Sign in to upgrade
          </a>
        )}

        {error ? (
          <p role="alert" className="mt-2 text-[0.6875rem] leading-relaxed text-red-400">
            {error}
          </p>
        ) : null}

        <p className="mt-2 text-[0.625rem] leading-relaxed text-zinc-400">
          Your file never leaves the browser. Only the subscription check and anonymous usage
          counters touch the network, and neither carries statement data.
        </p>
      </div>
    </dialog>
  );
}
