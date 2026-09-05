import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'The terms on which Luventra provides its client-side bank statement conversion utility.',
  alternates: { canonical: '/terms' },
};

/**
 * NOT LEGAL ADVICE. Same rule as the privacy page: every factual statement
 * here matches the shipped behaviour (free row limit, Stripe subscription,
 * local-only processing). Placeholders a human must fill before launch: the
 * legal entity name, the governing-law jurisdiction and the contact address.
 */

const CONTACT = 'support@luventra.co';
const FREE_ROW_LIMIT = 50;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium tracking-tight text-zinc-100">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-zinc-400">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="min-h-dvh">
      <div className="mx-auto max-w-[46rem] px-6 py-12">
        <Link
          href="/dashboard"
          className="font-mono text-[0.6875rem] text-zinc-400 transition-colors duration-150 hover:text-zinc-200"
        >
          ← converter
        </Link>

        <h1 className="mt-6 text-2xl font-medium tracking-tight text-zinc-100">
          Terms of Service
        </h1>
        <p className="mt-2 font-mono text-[0.6875rem] text-zinc-400">Last updated 5 September 2026</p>

        <Section title="The service">
          <p>
            Luventra converts bank statement CSV exports into OFX, QBO and QFX files for import
            into accounting software. Conversion runs in your browser; we do not receive your
            statement files. Using the service means you accept these terms.
          </p>
        </Section>

        <Section title="Your responsibilities">
          <p>
            You must have the right to use any file you convert. You are responsible for checking
            the converted output before relying on it — in particular that dates, signs and amounts
            match your statement. Bank export formats change without notice, and an import that
            looks complete can still be wrong.
          </p>
          <p>
            Do not use the service to break the law, to infringe anyone&rsquo;s rights, or to
            attempt to disrupt, overload or reverse-engineer the service.
          </p>
        </Section>

        <Section title="Accounts">
          <p>
            An account is optional. Signing in uses a one-time email link; keep access to your inbox
            secure, since anyone who can read it can sign in as you. You may delete your account at
            any time by contacting us.
          </p>
        </Section>

        <Section title="Free use and paid plans">
          <p>
            Files up to {FREE_ROW_LIMIT} transactions convert without an account or payment. Larger
            files require an active subscription, except during any promotional period we choose to
            run.
          </p>
          <p>
            Subscriptions are billed through Stripe on a recurring basis until cancelled. Cancelling
            stops future renewals and access continues to the end of the paid period. We may change
            pricing for future periods with notice.
          </p>
        </Section>

        <Section title="No professional advice">
          <p>
            Luventra is a file format utility. It is not accounting, tax, bookkeeping or financial
            advice, and it does not check whether your records are correct or complete. You remain
            responsible for your own filings and reconciliations.
          </p>
        </Section>

        <Section title="Availability and changes">
          <p>
            We aim to keep the service available but do not guarantee uninterrupted access. We may
            add, change or withdraw features. If we discontinue the service we will give reasonable
            notice where we can.
          </p>
        </Section>

        <Section title="Warranties and liability">
          <p>
            The service is provided &ldquo;as is&rdquo;, without warranties of any kind, to the
            fullest extent the law allows. We are not liable for indirect or consequential loss, or
            for lost profits, data or goodwill. Where liability cannot be excluded, it is limited to
            the amount you paid us in the twelve months before the claim.
          </p>
          <p>
            Nothing here limits liability that cannot lawfully be limited, including for fraud or
            for death or personal injury caused by negligence. If you are a consumer, your statutory
            rights are unaffected.
          </p>
        </Section>

        <Section title="Termination">
          <p>
            We may suspend or end access if these terms are breached. You may stop using the service
            at any time.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these terms:{' '}
            <a
              href={`mailto:${CONTACT}`}
              className="text-zinc-200 underline underline-offset-2 transition-colors duration-150 hover:text-white"
            >
              {CONTACT}
            </a>
            .
          </p>
        </Section>

        <p className="mt-10 border-l border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[0.6875rem] leading-relaxed text-amber-400/90">
          Operator note, not part of the terms: this is an accurate description of how the product
          behaves, but it is a template rather than reviewed legal drafting. Insert your legal
          entity name and governing jurisdiction, confirm the contact address, and have counsel
          review the liability and consumer-rights wording for the markets you sell into — the UK
          and EU consumer regimes in particular.
        </p>
      </div>
    </main>
  );
}
