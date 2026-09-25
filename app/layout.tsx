import type { Metadata } from 'next';
import './globals.css';
import { GoogleAdsTracker } from './components/GoogleAdsTracker';
import { SiteFooter } from './components/SiteFooter';

/**
 * `metadataBase` resolves the relative canonicals the bank pages declare into
 * absolute URLs. Without it those `alternates.canonical` values emit as paths,
 * which crawlers treat as relative to whatever host served them — so a preview
 * deployment can end up self-canonicalising and competing with production.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Statement Converter',
    template: '%s · Statement Converter',
  },
  description: 'Convert bank CSV exports into OFX, QBO and QFX.',
  // The tool is global; no hreflang split exists yet because there is one
  // English page per bank rather than per-locale variants. Bank pages carry
  // their own canonical.
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-zinc-50">
      <body className="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 antialiased">
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <SiteFooter />
        <GoogleAdsTracker />
      </body>
    </html>
  );
}
