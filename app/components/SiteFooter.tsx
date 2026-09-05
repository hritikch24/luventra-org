'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

/**
 * Global compliance footer.
 *
 * Google Ads landing-page policy expects a visitor to be able to find out who
 * operates a site, what it does with their data, and on what terms — from the
 * landing page itself, without hunting. About and Security are inline modals
 * because they are short and the visitor should not lose the converter state
 * they are mid-way through. Privacy and Terms are real routes at /privacy and
 * /terms: a reviewer needs to link to them, and a modal has no URL.
 *
 * Height is fixed by `--footer-h` in globals.css so the full-viewport
 * dashboard can subtract it exactly instead of growing a scrollbar.
 */

type Panel = 'about' | 'security';

const PANELS: Readonly<Record<Panel, { title: string; body: string }>> = {
  about: {
    title: 'About Luventra',
    body: 'Luventra was engineered by systems data architects to strip out the bloat of legacy desktop file converters. We deliver high-speed, spec-compliant formatting utilities with zero friction.',
  },
  security: {
    title: 'Data Provenance Guarantee',
    body: 'Financial statements are parsed and generated 100% locally inside an isolated browser Web Worker container on your local machine. No text bytes, amounts, payees, filenames or account names ever touch the network or any server. We count anonymous usage only: that a conversion happened, the output format, and a coarse size band such as "51-200 rows" — never the statement itself.',
  },
};

function InfoModal({
  panel,
  onClose,
}: {
  readonly panel: Panel | null;
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // `showModal()` supplies focus trapping, Escape handling and the top layer;
  // a div overlay would have to reimplement all three.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (panel && !dialog.open) dialog.showModal();
    if (!panel && dialog.open) dialog.close();
  }, [panel]);

  const content = panel ? PANELS[panel] : null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="info-modal-title"
      className="m-auto w-[26rem] max-w-[calc(100vw-2rem)] border border-zinc-800 bg-zinc-900 p-0 text-zinc-100 backdrop:bg-black/70"
    >
      {content ? (
        <>
          <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2">
            <h2 id="info-modal-title" className="text-xs font-medium text-zinc-100">
              {content.title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1 text-zinc-400 transition-colors duration-150 hover:text-zinc-200 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
          <div className="px-3 py-3">
            <p className="text-xs leading-relaxed text-zinc-400">{content.body}</p>
          </div>
        </>
      ) : null}
    </dialog>
  );
}

const LINK_CLASS =
  'text-[0.6875rem] text-zinc-400 transition-colors duration-150 hover:text-zinc-100 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500';

export function SiteFooter() {
  const [panel, setPanel] = useState<Panel | null>(null);

  return (
    <>
      <footer className="flex h-[var(--footer-h)] shrink-0 items-center justify-between gap-4 border-t border-zinc-800/60 px-4">
        <p className="truncate text-[0.6875rem] text-zinc-400">
          © 2026 luventra.co. Client-side processing utility.
        </p>

        <nav aria-label="Site information" className="flex shrink-0 items-center gap-4">
          <button type="button" onClick={() => setPanel('about')} className={LINK_CLASS}>
            About
          </button>
          <button type="button" onClick={() => setPanel('security')} className={LINK_CLASS}>
            Security
          </button>
          <Link href="/privacy" className={LINK_CLASS}>
            Privacy Policy
          </Link>
          <Link href="/terms" className={LINK_CLASS}>
            Terms of Service
          </Link>
        </nav>
      </footer>

      <InfoModal panel={panel} onClose={() => setPanel(null)} />
    </>
  );
}
