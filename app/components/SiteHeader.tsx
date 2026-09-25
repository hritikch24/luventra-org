import Link from 'next/link';
import { Mark } from './Mark';
import { AuthLink } from './AuthLink';

/**
 * The public site header.
 *
 * Exists because every page except the homepage was a navigational dead end:
 * an audit of the rendered HTML found `href="/"` on exactly one route. A
 * visitor who landed on /login, /privacy, /terms, /banks or a 404 — from a
 * search result, a shared link or the footer — had no way back to the product
 * except editing the URL. The branded lockup is the fix people actually reach
 * for, because a logo in the top-left going home is a convention nobody has to
 * be taught.
 *
 * `/dashboard` and `/banks/[bank]` keep their own headers: the first is the
 * app chrome with the runtime indicator, the second carries a back-link to the
 * bank index. Both had the same bug and both now link home from their lockup.
 */
export function SiteHeader({ showSectionLinks = false }: { readonly showSectionLinks?: boolean }) {
  return (
    <header className="border-b border-zinc-200">
      <div className="mx-auto flex max-w-[80rem] items-center justify-between gap-4 px-6 py-3">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-zinc-900 transition-opacity duration-150 hover:opacity-70 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
        >
          <Mark className="size-4 shrink-0" />
          <span className="font-mono text-[0.6875rem] font-medium tracking-wider">LUVENTRA</span>
        </Link>

        <nav aria-label="Main" className="flex items-center gap-5">
          <Link
            href="/banks"
            className="hidden font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors duration-150 hover:text-zinc-900 sm:inline"
          >
            Supported banks
          </Link>
          {/* Only the homepage has the #how anchor to jump to. */}
          {showSectionLinks ? (
            <Link
              href="/#how"
              className="hidden font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors duration-150 hover:text-zinc-900 sm:inline"
            >
              How it works
            </Link>
          ) : null}
          <AuthLink />
        </nav>
      </div>
    </header>
  );
}
