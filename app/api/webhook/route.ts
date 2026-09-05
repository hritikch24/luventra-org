import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, type SubscriptionStatus } from '@/app/lib/stripe';
import { createAdminClient } from '@/app/lib/supabase/server';

/**
 * Stripe webhook listener.
 *
 * Explicitly on the Node runtime: signature verification needs the raw request
 * body and Node's crypto, and this must not be pre-parsed by any body helper.
 */
export const runtime = 'nodejs';
/** Never cache or statically evaluate a webhook. */
export const dynamic = 'force-dynamic';

/** Events that change what a user is entitled to. */
const HANDLED = new Set<string>([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

function toIso(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
}

/** Stripe types the id as `string | expandable`, so narrow it once. */
function idOf(value: string | { id: string } | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : value.id;
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Missing STRIPE_WEBHOOK_SECRET.' }, { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  // Raw text, not request.json() — any re-serialisation breaks the signature.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Invalid signature.';
    return NextResponse.json({ error: `Signature verification failed: ${message}` }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    // Acknowledge so Stripe stops retrying events we deliberately ignore.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  try {
    const supabase = createAdminClient();

    // A switch on `event.type` is what discriminates Stripe's event union;
    // narrowing by early-return leaves `event.data.object` as the full union.
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.user_id ?? session.client_reference_id;
        const subscriptionId = idOf(session.subscription);

        if (!userId || !subscriptionId) {
          return NextResponse.json(
            { error: 'Checkout session carried no user id or subscription.' },
            { status: 400 },
          );
        }

        // Fetch the subscription for its real status and period end, rather
        // than assuming "active" from the session alone.
        const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
        const item = subscription.items.data[0];

        const { error } = await supabase.from('subscriptions').upsert(
          {
            user_id: userId,
            stripe_customer_id: idOf(session.customer),
            stripe_subscription_id: subscription.id,
            stripe_price_id: item?.price.id ?? null,
            status: subscription.status as SubscriptionStatus,
            current_period_end: toIso(item?.current_period_end),
            cancel_at_period_end: subscription.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );

        if (error) throw new Error(error.message);
        return NextResponse.json({ received: true, user_id: userId });
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.user_id;
        const item = subscription.items.data[0];

        const record = {
          stripe_customer_id: idOf(subscription.customer),
          stripe_subscription_id: subscription.id,
          stripe_price_id: item?.price.id ?? null,
          status: (event.type === 'customer.subscription.deleted'
            ? 'canceled'
            : subscription.status) as SubscriptionStatus,
          current_period_end: toIso(item?.current_period_end),
          cancel_at_period_end: subscription.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        };

        // Prefer the user id on the subscription; fall back to matching the
        // existing row by subscription id when metadata is absent (e.g. the
        // plan was changed from the Stripe dashboard).
        const { error } = userId
          ? await supabase
              .from('subscriptions')
              .upsert({ user_id: userId, ...record }, { onConflict: 'user_id' })
          : await supabase
              .from('subscriptions')
              .update(record)
              .eq('stripe_subscription_id', subscription.id);

        if (error) throw new Error(error.message);
        return NextResponse.json({ received: true });
      }

      default:
        return NextResponse.json({ received: true, ignored: event.type });
    }
  } catch (cause) {
    // Return 500 so Stripe retries a genuinely failed write.
    const message = cause instanceof Error ? cause.message : 'Webhook handler failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
