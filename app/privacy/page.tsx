import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'What Luventra does and does not collect. Bank statements are parsed entirely in your browser and are never uploaded.',
  alternates: { canonical: '/privacy' },
};

/**
 * NOT LEGAL ADVICE — this is a factual description of the system's actual data
 * flows, written so it can be handed to a lawyer as a starting point. Every
 * claim here was checked against the code:
 *
 *   - statements never leave the browser  -> app/worker/*, app/lib/worker-client.ts
 *   - email + session                     -> app/login, app/auth/callback
 *   - card data handled by Stripe         -> app/api/checkout
 *   - subscription row contents           -> supabase/schema.sql
 *   - ad event carries a name only        -> app/components/GoogleAdsTracker.tsx
 *   - usage counters hold no content      -> app/api/telemetry/route.ts, supabase/schema.sql
 *
 * If any of those change, change this page in the same commit. A privacy
 * policy that overstates protection is worse than none at all.
 *
 * Placeholders a human must fill before launch: the contact address and the
 * governing-law jurisdiction.
 */

const CONTACT = 'privacy@luventra.co';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium tracking-tight text-zinc-100">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-zinc-400">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh">
      <div className="mx-auto max-w-[46rem] px-6 py-12">
        <Link
          href="/dashboard"
          className="font-mono text-[0.6875rem] text-zinc-400 transition-colors duration-150 hover:text-zinc-200"
        >
          ← converter
        </Link>

        <h1 className="mt-6 text-2xl font-medium tracking-tight text-zinc-100">Privacy Policy</h1>
        <p className="mt-2 font-mono text-[0.6875rem] text-zinc-400">Last updated 5 September 2026</p>

        <Section title="The short version">
          <p>
            Your bank statements are never uploaded. They are read, parsed and converted entirely
            inside your own browser, and the converted file is produced on your machine. We cannot
            see your transactions, balances, account numbers or payee names, because they never
            reach us.
          </p>
          <p>
            We do collect the small amount of data needed to run accounts, billing, advertising
            and anonymous usage counting, described in full below.
          </p>
        </Section>

        <Section title="Statement files — not collected">
          <p>
            When you select or drop a CSV, the file is read using the browser&rsquo;s file API and
            handed to a Web Worker running in the same tab. Parsing, validation and generating the
            OFX, QBO or QFX output all happen there. The download is created from an in-memory blob
            on your device.
          </p>
          <p>
            No part of the file is transmitted to us or to any third party. Closing the tab discards
            it. We keep no copy, so there is nothing for us to disclose, retain or lose.
          </p>
        </Section>

        <Section title="What we do collect">
          <p>
            <strong className="text-zinc-200">Account.</strong> If you sign in, we store your email
            address so we can identify your account. Authentication uses a one-time link; we never
            ask for or store a password. Sessions are kept in cookies set on your device. Our
            authentication and database provider is Supabase.
          </p>
          <p>
            <strong className="text-zinc-200">Billing.</strong> Payments are processed by Stripe. We
            never see or store your card details. We store your Stripe customer and subscription
            identifiers, the plan you are on, your subscription status and its renewal date, so we
            know what you are entitled to.
          </p>
          <p>
            <strong className="text-zinc-200">Usage limit checks.</strong> When a file exceeds the
            free row limit, your browser asks our server whether your subscription is active. That
            request identifies your account. It does not include the file, its contents, its name or
            its size.
          </p>
          <p>
            <strong className="text-zinc-200">Advertising and analytics.</strong> We use Google Ads
            conversion tracking. When a conversion is recorded, the only thing sent is an event name
            — no filename, row count, amounts or payee names. Google may set cookies and receive
            your IP address and page URL, subject to consent below.
          </p>
          <p>
            <strong className="text-zinc-200">Anonymous usage counters.</strong> We record that a
            page was viewed, that a file was loaded, that the checks passed and that an export
            happened, together with which of our own pages you were on, the output format you
            chose and a coarse size band such as &ldquo;51&ndash;200 rows&rdquo;. These rows are
            keyed to a random identifier generated per browser tab, which is discarded when the
            tab closes and is never linked to your account. The table that stores them has no
            column capable of holding a filename, an amount, a payee or an account number.
          </p>
          <p>
            <strong className="text-zinc-200">Server logs.</strong> Our hosting provider records
            standard request logs, which can include IP address, user agent and requested URL.
          </p>
        </Section>

        <Section title="Cookies and consent">
          <p>
            Cookies strictly needed to keep you signed in are set only once you sign in. Advertising
            and analytics storage defaults to <em>denied</em> for visitors in the UK, the EEA and
            Switzerland, and is only enabled if you consent. Elsewhere it is enabled by default. You
            can clear cookies at any time in your browser.
          </p>
        </Section>

        <Section title="Sharing">
          <p>
            We do not sell personal data. We share only what is necessary with the providers that
            operate the service: Supabase (accounts and database), Stripe (payments) and Google
            (advertising measurement), plus our hosting provider. Your statement contents are shared
            with none of them, because we never receive them.
          </p>
        </Section>

        <Section title="Retention and your rights">
          <p>
            Account and subscription records are kept while your account exists and for as long as
            tax and accounting rules require us to keep billing records. Depending on where you
            live, you may have the right to access, correct, export or delete your personal data,
            and to object to or restrict its processing.
          </p>
          <p>
            To exercise any of these, or to delete your account, contact{' '}
            <a
              href={`mailto:${CONTACT}`}
              className="text-zinc-200 underline underline-offset-2 transition-colors duration-150 hover:text-white"
            >
              {CONTACT}
            </a>
            .
          </p>
        </Section>

        <Section title="Children">
          <p>The service is intended for business use and is not directed at children.</p>
        </Section>

        <Section title="Changes">
          <p>
            If we change what we collect, we will update this page and its date. Material changes
            will be signposted in the product.
          </p>
        </Section>

        <p className="mt-10 border-l border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[0.6875rem] leading-relaxed text-amber-400/90">
          Operator note, not part of the policy: this text describes the system accurately as built,
          but it has not been reviewed by a lawyer. Confirm the contact address, name your governing
          jurisdiction, and have counsel check it against UK GDPR, EU GDPR and any state privacy
          laws that apply to you before relying on it for compliance.
        </p>
      </div>
    </main>
  );
}
