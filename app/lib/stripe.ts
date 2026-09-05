import Stripe from 'stripe';

/**
 * Shared Stripe client.
 *
 * The API version is pinned to the one this SDK generation targets, so an
 * account-level default change cannot silently alter payload shapes.
 */
let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Missing environment variable STRIPE_SECRET_KEY.');

  cached = new Stripe(key, { apiVersion: '2026-08-26.dahlia' });
  return cached;
}

/** Plan identifiers stored against a user. Keep in step with the SQL enum. */
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'unpaid'
  | 'paused';
