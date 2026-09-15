/**
 * The brand mark, drawn inline so it inherits colour and never flashes.
 *
 * Same geometry as app/icon.svg — ragged rules resolving to flush ones across
 * the engine seam. See that file for what the shapes mean. Kept as a component
 * rather than an <img> so the two halves can take real palette colours in
 * context instead of being baked into a raster.
 */
export function Mark({ className = 'size-4' }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <g fill="currentColor" opacity="0.55">
        <rect x="6" y="9" width="8" height="3" rx="0.4" />
        <rect x="6" y="14.5" width="4" height="3" rx="0.4" />
        <rect x="6" y="20" width="6.5" height="3" rx="0.4" />
      </g>
      <path d="M16 7.5V24.5" stroke="currentColor" strokeWidth="1" strokeOpacity="0.35" strokeLinecap="round" />
      <g className="fill-emerald-500">
        <rect x="18" y="9" width="8" height="3" rx="0.4" />
        <rect x="18" y="14.5" width="8" height="3" rx="0.4" />
        <rect x="18" y="20" width="8" height="3" rx="0.4" />
      </g>
    </svg>
  );
}
