import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isAdsConfigured, setAdsConsent, trackGoogleConversion } from '../GoogleAdsTracker';

/**
 * The event API is called from inside user flows — a successful export, a
 * completed checkout. Its contract is that it can never be the reason one of
 * those breaks, so every failure path must be a silent no-op rather than a
 * throw. These tests exercise each of those paths.
 */

type GtagArgs = unknown[];

let calls: GtagArgs[];

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Installs a working `window.gtag` that records what it was handed. */
function installGtag(impl?: (...args: GtagArgs) => void): void {
  vi.stubGlobal('window', {
    gtag: (...args: GtagArgs) => {
      calls.push(args);
      impl?.(...args);
    },
  });
}

describe('trackGoogleConversion', () => {
  it('is a no-op during server rendering', () => {
    // `window` is genuinely absent under the node environment, which is the
    // exact condition a client component hits on its server pass.
    expect(typeof globalThis.window).toBe('undefined');
    expect(trackGoogleConversion('sign_up')).toBe(false);
  });

  it('is a no-op when the tag never loaded', () => {
    // The common real case: an ad blocker removed gtag.js, or the env var is
    // unset so the tag was never injected at all.
    vi.stubGlobal('window', {});
    expect(trackGoogleConversion('sign_up')).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('is a no-op when gtag is present but not callable', () => {
    vi.stubGlobal('window', { gtag: 'not a function' });
    expect(trackGoogleConversion('sign_up')).toBe(false);
  });

  it('forwards the event to gtag when the tag is live', () => {
    installGtag();
    expect(trackGoogleConversion('conversion')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('event');
    expect(calls[0]?.[1]).toBe('conversion');
  });

  it('trims the event name and rejects an empty one', () => {
    installGtag();
    expect(trackGoogleConversion('  purchase  ')).toBe(true);
    expect(calls[0]?.[1]).toBe('purchase');

    expect(trackGoogleConversion('   ')).toBe(false);
    expect(trackGoogleConversion('')).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('swallows a throw from third-party gtag rather than breaking the caller', () => {
    // gtag.js is code we do not control and an extension may have replaced it
    // with a stub that throws. That is not the app's failure to propagate.
    installGtag(() => {
      throw new Error('gtag exploded');
    });
    expect(() => trackGoogleConversion('conversion')).not.toThrow();
    expect(trackGoogleConversion('conversion')).toBe(false);
  });

  it('sends no payload beyond the event name and tag scope', () => {
    // The privacy guarantee: this API cannot carry statement content to a
    // third party, because there is nowhere to put it.
    installGtag();
    trackGoogleConversion('conversion');
    const payload = calls[0]?.[2] as Record<string, unknown> | undefined;
    const keys = payload === undefined ? [] : Object.keys(payload);
    expect(keys.every((key) => key === 'send_to')).toBe(true);
  });
});

describe('setAdsConsent', () => {
  it('is a no-op when the tag is absent', () => {
    vi.stubGlobal('window', {});
    expect(setAdsConsent(true)).toBe(false);
  });

  it('sends a Consent Mode update granting all four signals', () => {
    installGtag();
    expect(setAdsConsent(true)).toBe(true);
    expect(calls[0]?.[0]).toBe('consent');
    expect(calls[0]?.[1]).toBe('update');
    expect(calls[0]?.[2]).toEqual({
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted',
    });
  });

  it('sends denied for all four signals on reject', () => {
    installGtag();
    setAdsConsent(false);
    expect(calls[0]?.[2]).toEqual({
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
    });
  });

  it('does not throw when gtag throws', () => {
    installGtag(() => {
      throw new Error('nope');
    });
    expect(() => setAdsConsent(true)).not.toThrow();
    expect(setAdsConsent(true)).toBe(false);
  });
});

describe('tag id validation', () => {
  it('reports unconfigured when no id is set', () => {
    // The suite runs with no NEXT_PUBLIC_GOOGLE_ADS_ID, which is the state a
    // fresh clone and every preview deployment is in.
    expect(isAdsConfigured()).toBe(false);
  });

  it('still fires nothing when unconfigured but gtag exists', () => {
    // Another script on the page could define gtag. An event must still be
    // scoped correctly rather than attributed to someone else's tag.
    installGtag();
    expect(trackGoogleConversion('conversion')).toBe(true);
    expect(calls[0]?.[2]).toEqual({});
  });
});
