import Link from 'next/link';
import { Mark } from './Mark';

/**
 * Global application header for the workbench environment.
 *
 * Height is fixed by `--header-h` in globals.css so the full-viewport dashboard
 * can subtract it exactly instead of growing a scrollbar — the same contract
 * `SiteFooter` holds at the bottom of the page. Because the bar is a single
 * non-wrapping row, anything that cannot fit a narrow viewport is dropped at a
 * breakpoint rather than allowed to wrap and break that height.
 *
 * This is a server component: the bar is static chrome, so shipping it as
 * client JS would buy nothing.
 *
 * Mounted by `app/dashboard/layout.tsx` rather than the root layout because
 * `/banks` and `/banks/[bank]` render their own header (a back-link to the bank
 * index plus the auth control), and those pages are the paid-traffic landing
 * surfaces — stacking a second bar on top of theirs would regress the pages
 * that matter most. Mounting this in `app/layout.tsx` is a one-line change if
 * that local header is retired first.
 */

const NAV_LINKS = [
  { label: 'Workbench Utility', href: '/dashboard' },
  { label: 'Specifications Matrix', href: '/banks' },
  { label: 'Security Verification', href: '/privacy' },
] as const;

const NAV_LINK_CLASS =
  'font-mono text-[0.625rem] tracking-wider text-zinc-500 whitespace-nowrap transition-colors duration-150 hover:text-zinc-900 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500';

export function AppHeader() {
  return (
    <header className="flex h-[var(--header-h)] shrink-0 items-center justify-between gap-4 border-b border-zinc-200 bg-zinc-50 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-zinc-900 transition-opacity duration-150 hover:opacity-80 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
        >
          <Mark className="size-4 shrink-0" />
          <span className="truncate font-mono text-[0.6875rem] font-medium tracking-wider">
            LUVENTRA
            {/* The separator belongs to the suffix — shown alone it dangles. */}
            <span className="hidden sm:inline">
              {' '}
              <span className="text-zinc-500">//</span> CORE FILE ENGINE
            </span>
          </span>
        </Link>

        {/* Runtime status. Decorative dot, so the label carries the meaning. */}
        <span className="hidden shrink-0 items-center gap-1.5 lg:flex">
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
          />
          <span className="font-mono text-[0.625rem] tracking-wider text-zinc-500">
            [ NATIVE WEB WORKER RUNTIME WARM ]
          </span>
        </span>
      </div>

      {/* Dropped below md: three long labels cannot share one row with the
          brand on a phone without wrapping, and wrapping would break the fixed
          header height the dashboard subtracts. */}
      <nav
        aria-label="Application sections"
        className="hidden shrink-0 items-center gap-4 md:flex"
      >
        {NAV_LINKS.map(({ label, href }) => (
          <Link key={href} href={href} className={NAV_LINK_CLASS}>
            [ {label} ]
          </Link>
        ))}
      </nav>
    </header>
  );
}
