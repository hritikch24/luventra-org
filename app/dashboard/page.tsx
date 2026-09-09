import type { Metadata } from 'next';
import { StatementWorkbench } from './StatementWorkbench';
import { PageViewTracker } from '@/app/components/PageViewTracker';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Map a bank CSV export to Date, Description and Amount, then convert it.',
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
