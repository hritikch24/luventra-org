'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

/**
 * Four-step onboarding overlay for the standalone workspace.
 *
 * Targets are found by `data-tour` attribute rather than by ref threading, so
 * a panel can move in the layout without the tour needing to know. Every
 * target wrapper is rendered unconditionally — including before a file is
 * loaded — so no step can point at nothing.
 *
 * The spotlight is one absolutely positioned box with a very large outward
 * box-shadow. That paints the scrim and punches the cutout in a single
 * element, which keeps the highlight pixel-aligned with the target instead of
 * relying on four separately positioned mask panels.
 */

const STORAGE_KEY = 'luventra.tour.v1';

export interface TourStep {
  /** Value of the `data-tour` attribute on the element to highlight. */
  readonly target: string;
  readonly title: string;
  readonly body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: 'dropzone',
    title: 'Step 1 · Load a statement',
    body: 'Drop your messy bank CSV statement here. The file is opened 100% locally in your browser memory thread.',
  },
  {
    target: 'mapping',
    title: 'Step 2 · Check the mapping',
    body: 'Check mapping headers. Our internal heuristics automatically infer Date, Description, and Amount indicators instantly.',
  },
  {
    target: 'validation',
    title: 'Step 3 · Read the checks',
    body: 'Review structural integrity logs. The engine runs live mathematical audits validating running balances and layout anomalies before you export.',
  },
  {
    target: 'export',
    title: 'Step 4 · Export',
    body: 'Trigger your format download. Generate byte-perfect, spec-compliant OFX, QBO, or QFX files that import into QuickBooks, Xero, or Sage flawlessly on the first try.',
  },
];

/** Persisted dismissal. Storage can throw in private mode, so never trust it. */
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
  } catch {
    // Private mode: the tour simply shows again next visit.
  }
}

export interface TourController {
  readonly active: boolean;
  readonly stepIndex: number;
  readonly next: () => void;
  readonly back: () => void;
  readonly dismiss: () => void;
}

/**
 * Owns tour lifecycle. `enabled` is false for the embedded workbench on the
 * bank landing pages: an overlay dropped in front of paid traffic before they
 * have touched anything is a bounce, not an onboarding.
 */
export function useOnboardingTour(enabled: boolean): TourController {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Read storage after mount, never during render: the server has no
  // localStorage, so deciding visibility during render is a hydration
  // mismatch waiting to happen.
  useEffect(() => {
    if (!enabled) return;
    if (readDismissed()) return;
    setActive(true);
  }, [enabled]);

  const dismiss = useCallback(() => {
    setActive(false);
    writeDismissed();
  }, []);

  const next = useCallback(() => {
    setStepIndex((current) => {
      if (current >= TOUR_STEPS.length - 1) {
        setActive(false);
        writeDismissed();
        return current;
      }
      return current + 1;
    });
  }, []);

  const back = useCallback(() => {
    setStepIndex((current) => Math.max(0, current - 1));
  }, []);

  return { active, stepIndex, next, back, dismiss };
}

interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

const CARD_WIDTH = 20;   // rem
const GAP = 0.75;        // rem
const REM = 16;

function measure(target: string): Box | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Places the card beside the target, flipping and clamping to stay on screen. */
function placeCard(box: Box, cardHeight: number): { top: number; left: number } {
  const gap = GAP * REM;
  const cardWidth = CARD_WIDTH * REM;
  const margin = 12;

  let left = box.left + box.width + gap;
  if (left + cardWidth > window.innerWidth - margin) {
    left = box.left - cardWidth - gap;
  }
  if (left < margin) {
    left = Math.min(Math.max(margin, box.left), window.innerWidth - cardWidth - margin);
  }

  let top = box.top;
  if (top + cardHeight > window.innerHeight - margin) {
    top = window.innerHeight - cardHeight - margin;
  }
  if (top < margin) top = margin;

  return { top, left };
}

export function OnboardingTour({ controller }: { readonly controller: TourController }) {
  const { active, stepIndex, next, back, dismiss } = controller;
  const step = TOUR_STEPS[stepIndex];

  const [box, setBox] = useState<Box | null>(null);
  const [card, setCard] = useState<{ top: number; left: number } | null>(null);
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);

  // Layout effect so the spotlight lands on the same frame the overlay paints,
  // rather than flashing at the previous step's position.
  useLayoutEffect(() => {
    if (!active || !step) return;

    const reposition = () => {
      const next = measure(step.target);
      setBox(next);
      if (next) setCard(placeCard(next, cardEl?.offsetHeight ?? 180));
    };

    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [active, step, cardEl]);

  // Escape exits from anywhere, matching the dialogs elsewhere in the app.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, dismiss]);

  if (!active || !step) return null;

  const isLast = stepIndex === TOUR_STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      className="fixed inset-0 z-50"
    >
      {/* Scrim + cutout in one element. Clicking the scrim exits. */}
      {box ? (
        <div
          onClick={dismiss}
          className="pointer-events-auto absolute border border-emerald-500/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.72),0_0_24px_rgba(16,185,129,0.35)] transition-all duration-200"
          style={{
            top: box.top - 4,
            left: box.left - 4,
            width: box.width + 8,
            height: box.height + 8,
          }}
          aria-hidden
        />
      ) : (
        <div onClick={dismiss} className="absolute inset-0 bg-black/72" aria-hidden />
      )}

      <div
        ref={setCardEl}
        style={card ? { top: card.top, left: card.left } : { top: 24, left: 24 }}
        className="absolute w-[20rem] border border-zinc-800 bg-zinc-900 shadow-[0_16px_40px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2">
          <h2 id="tour-title" className="text-xs font-medium text-zinc-100">
            {step.title}
          </h2>
          <span className="font-mono text-[0.625rem] text-zinc-600 tnum">
            {stepIndex + 1}/{TOUR_STEPS.length}
          </span>
        </div>

        <div className="px-3 py-3">
          <p className="text-xs leading-relaxed text-zinc-400">{step.body}</p>

          <div className="mt-3 flex items-center justify-between gap-3">
            {/* High-intensity progress dots, matching the pre-flight panel. */}
            <div className="flex items-center gap-1.5" aria-hidden>
              {TOUR_STEPS.map((entry, index) => (
                <span
                  key={entry.target}
                  className={`size-1.5 rounded-full transition-colors duration-150 ${
                    index === stepIndex
                      ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                      : index < stepIndex
                        ? 'bg-emerald-500/40'
                        : 'bg-zinc-700'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              {stepIndex > 0 ? (
                <button
                  type="button"
                  onClick={back}
                  className="px-2 py-1 text-[0.6875rem] text-zinc-500 transition-colors duration-150 hover:text-zinc-200 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
                >
                  Back
                </button>
              ) : null}
              <button
                type="button"
                onClick={next}
                className="bg-accent px-3 py-1.5 text-[0.6875rem] font-semibold text-white transition-[colors,box-shadow] duration-150 hover:bg-accent-hover hover:shadow-[0_0_18px_rgba(16,185,129,0.45)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
              >
                {isLast ? 'Got it, Close' : 'Next'}
              </button>
            </div>
          </div>

          {/* Always-available exit, on every step including the last. */}
          <button
            type="button"
            onClick={dismiss}
            className="mt-2 w-full border border-zinc-800 py-1 text-[0.625rem] text-zinc-500 transition-colors duration-150 hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
          >
            Skip Tour
          </button>
        </div>
      </div>
    </div>
  );
}
