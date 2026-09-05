import type { Metadata } from 'next';
import { StatementWorkbench } from './StatementWorkbench';
import { PageViewTracker } from '@/app/components/PageViewTracker';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Map a bank CSV export to Date, Description and Amount, then convert it.',
};

export default function DashboardPage() {
  return (
    <main className="min-h-dvh">
      <PageViewTracker surface="dashboard" />
      <StatementWorkbench />
    </main>
  );
}
