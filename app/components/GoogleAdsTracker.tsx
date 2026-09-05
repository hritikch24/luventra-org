'use client';

import Script from 'next/script';

/**
 * Google Ads global site tag (gtag.js).
 *
 * Mounted once in the root layout. Renders no DOM of its own, so it cannot
 * shift layout or affect CLS; the only cost is the tag request itself, which
 * is deferred until after hydration.
 *
 * ## What this deliberately does not do
 *
 * The product's whole claim is that a statement never leaves the browser. This
 * file is the one place that talks to a third party, so its API is limited to
 * sending an event *name*. There is no parameter bag, no page path, no file
 * name, no row count — nothing that could carry statement content to Google
 * even by accident. Keep it that way: if a future conversion needs a value,
 * add a narrowly typed field, never a passthrough object.
 *
 * ## Consent
 *
 * The tag boots with Google Consent Mode v2 set to **denied** by default.
 * Half the bank pages target UK and EU users, where ePrivacy/GDPR require
 * consent *before* advertising cookies are set — loading a raw gtag there is a
 * genuine legal exposure, not a nicety. Denied-by-default still sends
 * cookieless pings so Google can model conversions, and `setAdsConsent(true)`
 * upgrades it the moment a consent banner is accepted.
 *
 * Set `NEXT_PUBLIC_ADS_CONSENT_DEFAULT=granted` to opt out of that behaviour
 * (US-only traffic, or where consent is captured before the app loads).
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type ConsentState = 'granted' | 'denied';

type GtagCommand =
  | ['js', Date]
  | ['config', string, Record<string, unknown>?]
  | ['event', string, Record<string, unknown>?]
  | ['consent', 'default' | 'update', Record<string, ConsentState | number>];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: GtagCommand) => void;
  }
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Read as a full static member expression.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` at build time by substituting the
 * literal text. A computed lookup like `process.env[key]` is not substituted
 * and resolves to undefined in the browser, so this must stay written out.
 */
const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

const CONSENT_DEFAULT: ConsentState =
  process.env.NEXT_PUBLIC_ADS_CONSENT_DEFAULT === 'granted' ? 'granted' : 'denied';

/**
 * Accepts the Google tag id formats: `AW-` (Ads), `G-` (GA4), `GT-` (Tag
 * Manager tag), `UA-` (legacy).
 *
 * Validated rather than trusted because the id is interpolated into an inline
 * `<script>`. It comes from build-time env so it is not attacker-controlled
 * today, but a strict shape check costs nothing and closes the injection path
 * permanently — and it catches the far more likely failure, a typo'd id that
 * would otherwise fail silently and lose a week of conversion data.
 */
const TAG_ID_PATTERN = /^(?:AW|G|GT|UA)-[A-Z0-9]+(?:-[A-Z0-9]+)?$/i;

function resolveTagId(): string | null {
  const id = ADS_ID?.trim();
  if (!id) return null;
  if (!TAG_ID_PATTERN.test(id)) {
    if (process.env.NODE_ENV !== 'production') {
      // Dev-only: in production this must stay silent rather than logging a
      // config value to the console of every visitor.
      console.warn(
        `[GoogleAdsTracker] NEXT_PUBLIC_GOOGLE_ADS_ID is not a valid tag id: ${JSON.stringify(id)}. ` +
          'Expected something like "AW-123456789". The tag was not loaded.',
      );
    }
    return null;
  }
  return id;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export interface GoogleAdsTrackerProps {
  /**
   * Load the tag outside production too. Off by default so local development
   * and preview deployments never pollute conversion data with test traffic.
   */
  readonly enableInDevelopment?: boolean;
}

/**
 * Injects gtag.js. Returns null — it renders nothing.
 *
 * `afterInteractive` is the right strategy for an ads tag: it loads early
 * enough to catch a conversion on a short session, but after hydration, so it
 * never competes with the app's own JavaScript for the critical path.
 * `beforeInteractive` would block first paint for a script that has nothing to
 * do with rendering; `lazyOnload` waits for idle and can miss a fast bounce,
 * which is exactly the traffic paid ads produce.
 */
export function GoogleAdsTracker({ enableInDevelopment = false }: GoogleAdsTrackerProps = {}) {
  const tagId = resolveTagId();
  if (tagId === null) return null;
  if (process.env.NODE_ENV !== 'production' && !enableInDevelopment) return null;

  return (
    <>
      {/*
        The remote tag. `async` is implied by the strategy, but stated so the
        intent survives a strategy change.
      */}
      <Script
        id="google-ads-tag"
        strategy="afterInteractive"
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagId)}`}
      />
      {/*
        The bootstrap. This must run for gtag() to queue commands, and consent
        defaults must be set BEFORE `config` — a config that lands first sets
        cookies under the old, unrestricted behaviour.

        `tagId` is safe to interpolate: it has passed TAG_ID_PATTERN, so it
        contains only alphanumerics and hyphens and cannot terminate the script
        element or introduce syntax.
      */}
      <Script id="google-ads-init" strategy="afterInteractive">
        {`
window.dataLayer = window.dataLayer || [];
function gtag(){window.dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
gtag('consent', 'default', {
  ad_storage: '${CONSENT_DEFAULT}',
  ad_user_data: '${CONSENT_DEFAULT}',
  ad_personalization: '${CONSENT_DEFAULT}',
  analytics_storage: '${CONSENT_DEFAULT}'
});
gtag('js', new Date());
gtag('config', '${tagId}');
        `.trim()}
      </Script>
    </>
  );
}

export default GoogleAdsTracker;

/* -------------------------------------------------------------------------- */
/* Event API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Fires a conversion event, or does nothing.
 *
 * Every call site is inside a user flow that must not break because an ad
 * blocker ate the tag, the env var is unset, or this ran during SSR. So every
 * failure path here is a silent no-op returning `false` rather than a throw —
 * a conversion ping is never worth interrupting a user's export.
 *
 * Returns whether the event was actually handed to gtag, which makes the
 * no-op observable in tests without any of the callers having to care.
 */
export function trackGoogleConversion(eventName: string): boolean {
  // `typeof window` rather than a truthiness check: this module is imported by
  // client components that still render once on the server.
  if (typeof window === 'undefined') return false;

  // Belt-and-braces with the try/catch below, which would also swallow the
  // TypeError from calling a missing gtag. Kept explicit because a blocked or
  // unconfigured tag is the *expected* state on a large share of sessions, and
  // routing an expected path through an exception is both wasteful and noisy
  // in devtools. The catch is for genuine third-party faults.
  const gtag = window.gtag;
  if (typeof gtag !== 'function') return false;

  const name = eventName.trim();
  if (name === '') return false;

  const tagId = resolveTagId();

  try {
    // `send_to` scopes the event to this specific tag. Without it, an account
    // with several tags on the page attributes the conversion to all of them.
    gtag('event', name, tagId === null ? {} : { send_to: tagId });
    return true;
  } catch {
    // gtag.js is third-party code that an extension may have replaced with a
    // stub. Its failure is not the app's failure.
    return false;
  }
}

/**
 * Updates Consent Mode after a consent banner is answered.
 *
 * Call with `true` on accept and `false` on reject. Safe to call before the
 * tag has loaded: the command queues on `dataLayer` and applies on boot.
 */
export function setAdsConsent(granted: boolean): boolean {
  if (typeof window === 'undefined') return false;

  const gtag = window.gtag;
  if (typeof gtag !== 'function') return false;

  const state: ConsentState = granted ? 'granted' : 'denied';
  try {
    gtag('consent', 'update', {
      ad_storage: state,
      ad_user_data: state,
      ad_personalization: state,
      analytics_storage: state,
    });
    return true;
  } catch {
    return false;
  }
}

/** True when a valid tag id is configured. Useful for gating a consent banner. */
export function isAdsConfigured(): boolean {
  return resolveTagId() !== null;
}
