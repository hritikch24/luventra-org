import type { BankExportProfile } from './seo-banks-data';

/**
 * Market-specific copy for the bank landing pages.
 *
 * Resolved from the profile's `region`, which is static data, so this is a
 * build-time decision and the localised copy ships inside the prerendered
 * HTML. See the note in `app/banks/[bank]/page.tsx` for why this is not done
 * on the client.
 *
 * Claims here are deliberately narrow. "No statement data is transmitted" is a
 * property of the architecture and is true. Anything stronger — a compliance
 * guarantee, an HMRC or tax-authority endorsement, a certification — is not
 * ours to assert and is not stated.
 */

export type Market = 'US' | 'UK' | 'EU';

export interface MarketCopy {
  readonly market: Market;
  readonly currencySymbol: string;
  readonly currencyCode: string;
  /** Accounting packages named first, in local order of relevance. */
  readonly integrations: readonly string[];
  /** The package to lead with in headings and prose. */
  readonly primaryIntegration: string;
  /** Localised label for the sample amount indicator. */
  readonly amountExample: string;
  /** Heading for the data-residency section. */
  readonly residencyTitle: string;
  readonly residencyBody: string;
  /** Short line under the hero, naming local software. */
  readonly integrationLine: string;
}

const US: MarketCopy = {
  market: 'US',
  currencySymbol: '$',
  currencyCode: 'USD',
  integrations: ['QuickBooks', 'Quicken', 'Xero', 'Wave'],
  primaryIntegration: 'QuickBooks',
  amountExample: '$1,234.56',
  residencyTitle: 'Your statement never leaves this browser',
  residencyBody:
    'Conversion runs in a Web Worker inside this page. The file is read with the browser’s own file API, parsed in memory, and handed back as bytes. There is no upload step, so no copy of your statement exists on a server to be retained, logged or breached.',
  integrationLine: 'Imports into QuickBooks, Quicken and Xero.',
};

const UK: MarketCopy = {
  market: 'UK',
  currencySymbol: '£',
  currencyCode: 'GBP',
  integrations: ['Xero', 'QuickBooks', 'FreeAgent', 'Sage'],
  primaryIntegration: 'Xero',
  amountExample: '£1,234.56',
  residencyTitle: 'No statement data leaves your device',
  residencyBody:
    'Conversion runs in a Web Worker inside this page, so your statement is never uploaded. Because none of its contents reach our servers or any third party, there is no transfer of client financial data to a processor when you use this tool — the file, and every account number and payee name in it, stays on the machine that opened it.',
  integrationLine: 'Imports into Xero, QuickBooks, FreeAgent and Sage.',
};

const EU: MarketCopy = {
  ...UK,
  market: 'EU',
  currencySymbol: '€',
  currencyCode: 'EUR',
  amountExample: '€1.234,56',
  integrations: ['Xero', 'QuickBooks', 'Sage', 'Exact'],
  integrationLine: 'Imports into Xero, QuickBooks and Sage.',
};

/** Regions that get the UK/EU treatment rather than the US default. */
export function marketFor(region: BankExportProfile['region']): Market {
  if (region === 'UK') return 'UK';
  if (region === 'EU') return 'EU';
  // CA and AU sit closer to the US layout than to the UK one; they get the
  // default until someone writes copy for them.
  return 'US';
}

export function copyFor(region: BankExportProfile['region']): MarketCopy {
  const market = marketFor(region);
  if (market === 'UK') return UK;
  if (market === 'EU') return EU;
  return US;
}

/** True for the markets whose copy leads with Xero and local currency. */
export function isUkEu(region: BankExportProfile['region']): boolean {
  return marketFor(region) !== 'US';
}
