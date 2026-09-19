import { AppHeader } from '@/app/components/AppHeader';

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
      <AppHeader />
      {children}
    </>
  );
}
