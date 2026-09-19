import type { Metadata } from 'next';
import { StatementWorkbench } from './StatementWorkbench';
import { PageViewTracker } from '@/app/components/PageViewTracker';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Map a bank CSV export to Date, Description and Amount, then convert it.',
  /*
   * Not indexed, deliberately.
   *
   * Since / became a real landing page it carries the same converter plus the
   * explanation, the privacy case, the steps and every bank link. This route
   * is the same tool with none of that, so leaving both indexable put two
   * near-duplicate pages in competition for the same queries and split the
   * signals between them — on a domain that is already struggling to get
   * crawled at all.
   *
   * `follow` is kept: a crawler that lands here should still traverse to
   * /banks and the bank pages rather than treating this as a dead end.
   */
  robots: { index: false, follow: true },
};

export default function DashboardPage() {
  return (
    // Not `min-h-dvh`: the header and footer are laid out as siblings, so
    // forcing a full viewport here would push the page past 100dvh by exactly
    // the height of both bars and scroll. The workbench sizes itself.
    <main className="flex min-h-0 flex-1 flex-col">
      <PageViewTracker surface="dashboard" />
      <StatementWorkbench />
    </main>
  );
}
