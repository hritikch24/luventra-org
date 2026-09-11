import type { BankExportProfile } from './seo-banks-data';
import { copyFor } from './market-context';

/**
 * Per-bank question and answer pairs.
 *
 * These exist for extraction, not decoration. An answer engine quoting a page
 * lifts a short span that answers the question on its own, so every answer
 * below is written to stand alone: it names the bank, states the specific fact,
 * and does not depend on the surrounding page for context. "It uses MM/DD/YYYY"
 * is useless once detached; "Chase exports dates as MM/DD/YYYY" survives.
 *
 * Every value is derived from the verified profile in `seo-banks-data.ts` — the
 * same table that drives the converter's own column pre-selection — so an
 * answer cannot describe a layout the engine does not actually implement. None
 * of this is generated prose about the product; it is the export's real shape.
 */

export interface FaqEntry {
  readonly question: string;
  readonly answer: string;
}

export function bankFaq(profile: BankExportProfile): readonly FaqEntry[] {
  const copy = copyFor(profile.region);
  const target = copy.primaryIntegration;
  const hasHeaderRow = profile.sampleHeaders.length > 0;

  const entries: FaqEntry[] = [
    {
      question: `How do I convert a ${profile.name} CSV statement to ${target}?`,
      answer:
        `Export your ${profile.legalName} ${profile.accountKind} transactions as CSV, then drop the ` +
        `file into the Luventra converter. The ${profile.name} column layout is pre-selected, so the ` +
        `Date, Description and Amount fields map automatically. Generate a QBO, OFX or QFX file and ` +
        `import it into ${target}. The statement is parsed inside your own browser, so the file is ` +
        `never uploaded.`,
    },
    {
      question: `Why does my ${profile.name} CSV fail to import into ${target}?`,
      answer: `${profile.commonGotcha}`,
    },
    {
      question: `What date format does a ${profile.name} export use?`,
      answer:
        `${profile.name} exports dates in ${profile.dateFormat} format. Luventra reads that order ` +
        `directly and rewrites each date into the OFX timestamp format that ${target} expects, so ` +
        `days and months are not transposed on import.`,
    },
    {
      question: `How does ${profile.name} represent debits and credits in its CSV?`,
      answer:
        `${profile.amountConvention} Luventra normalises this into a single signed amount per ` +
        `transaction before writing the QBO or OFX file, which is what ${target} expects.`,
    },
    {
      question: `Is my ${profile.name} statement uploaded to a server?`,
      answer:
        `No. The ${profile.name} CSV is parsed and converted entirely inside an isolated Web Worker ` +
        `in your own browser. No transaction text, amounts, payee names, account numbers or file ` +
        `names are transmitted to Luventra or any third party, and no copy of the statement is ` +
        `stored anywhere.`,
    },
  ];

  entries.push({
    question: `Does a ${profile.name} CSV export include a header row?`,
    answer: hasHeaderRow
      ? `Yes. A ${profile.name} export starts with a header row: ${profile.sampleHeaders.join(', ')}. ` +
        `Luventra matches those column names automatically, so the mapping is already correct when ` +
        `the file loads.`
      : `No. A ${profile.name} export ships its rows with no header line, so a naive importer reads ` +
        `the first transaction as column titles and silently drops it. Luventra detects the missing ` +
        `header and maps the columns by position instead, keeping every row.`,
  });

  return entries;
}

/** `FAQPage` structured data for one bank, mirroring the visible Q&A. */
export function bankFaqSchema(profile: BankExportProfile) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: bankFaq(profile).map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
}
