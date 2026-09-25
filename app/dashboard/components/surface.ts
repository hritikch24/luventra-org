/**
 * The workbench's surface and type scale, defined once.
 *
 * Every panel in the workspace is the same object seen from a different angle:
 * a matte translucent card, a hairline rule, a monospace configuration label,
 * and a tight structural title. Those four decisions were previously restated
 * as literal class strings in five components, which is how a scale drifts —
 * one panel at `bg-white`, another at `bg-zinc-50`, three different
 * header treatments. Naming them makes the instrument read as one machine.
 *
 * The aesthetic target is a precision console: dense, matte, hairline-ruled.
 * Hierarchy is carried by *treatment* — mono versus sans, tracking, weight —
 * rather than by brightness alone, which is what made the earlier passes read
 * flat no matter how far the greys were pushed.
 */

/** Translucent card over the zinc-950 canvas. The blur is what gives depth. */
export const PANEL = 'border border-zinc-200 bg-white/80 backdrop-blur-md';

/** A panel's title strip. */
export const PANEL_HEADER =
  'flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-3 py-2';

/**
 * Configuration header — the small monospace legend above a group of controls.
 * Deliberately dim: the wide tracking and mono face carry the emphasis, so
 * brightness is free to stay low and let real data sit above it in the visual
 * order.
 */
export const CONFIG_LABEL = 'font-mono text-[11px] uppercase tracking-widest text-zinc-500';

/** Structural title — sans, tight, bright. Names a thing rather than a group. */
export const TITLE = 'font-medium tracking-tight text-zinc-900';

/** Numeric or status metadata sitting opposite a title in a header strip. */
export const META = 'font-mono text-[10px] tracking-wide text-zinc-500 tnum';

/** Column heading inside a data matrix. */
export const COLUMN_LABEL =
  'font-mono text-[10px] font-medium uppercase tracking-widest text-zinc-500';

/** A bordered token, e.g. an accepted file extension. */
export const PILL =
  'border border-zinc-200 bg-zinc-50/60 px-2 py-1 font-mono text-[10px] tracking-widest text-zinc-600';
