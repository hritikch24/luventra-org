import { AppHeader } from '@/app/components/AppHeader';

/**
 * `SoftwareApplication` description of the converter, emitted into the
 * dashboard shell so crawlers can read what this surface is without executing
 * the workbench.
 *
 * Two of the values are deliberately not the literal strings from the brief,
 * because the literal forms are not machine-readable and the point of this
 * block is to be parsed:
 *
 *  - `applicationCategory` is an enumeration, so "BusinessApplication /
 *    FinancialApplication" as one slash-joined string matches nothing. It is
 *    emitted as the two valid values instead — and the finance one is spelled
 *    `FinanceApplication` in the vocabulary, not `FinancialApplication`.
 *  - `featureList` is emitted as three entries rather than one comma-joined
 *    sentence, so each capability is a discrete value.
 *
 * There is deliberately no `offers` or `aggregateRating` here: both would need
 * real commercial data, and inventing either to unlock a rich-result badge
 * would be fabricating a claim about the product.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Luventra Automated Client-Side Statement Converter',
  url: `${siteUrl}/dashboard`,
  applicationCategory: ['BusinessApplication', 'FinanceApplication'],
  operatingSystem: 'All modern web browsers (Windows, macOS, Linux)',
  browserRequirements: 'Requires JavaScript and Web Worker support.',
  featureList: [
    'Local Web Worker processing',
    '100% data privacy sandbox',
    'Byte-exact OFX/QBO specs generation',
  ],
  description:
    'Format irregular banking statement rows into specification-compliant bookkeeping entries. ' +
    'Statements are parsed in an isolated client-side thread and never leave the device.',
};

/**
 * Workbench shell.
 *
 * The root layout already supplies the column flex context and the compliance
 * footer; this segment adds the pinned enterprise header above the converter.
 * Both bars are `shrink-0` at a height declared in globals.css, so the page
 * measures exactly `--header-h + 100dvh-minus-both + --footer-h` and never
 * grows a scrollbar. See `StatementWorkbench` for the matching subtraction.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        // Values are static literals from this file, never user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <AppHeader />
      {children}
    </>
  );
}
