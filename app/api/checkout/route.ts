import { NextResponse, type NextRequest } from 'next/server';
import { getStripe } from '@/app/lib/stripe';
import { createClient } from '@/app/lib/supabase/server';

/**
 * Creates a Stripe Checkout session for the signed-in user.
 *
 * Runtime note: this was specified to run on Vercel Edge, but the Edge runtime
 * is deprecated in Next 16 (`export const runtime = 'edge'` emits a build
 * deprecation warning and is slated for removal). It therefore runs on the
 * default Node runtime. Re-add the export if you need Edge deliberately and
 * are willing to accept the warning.
 */
export async function POST(request: NextRequest) {
  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : 'Stripe is not configured.' },
      { status: 500 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: 'Missing STRIPE_PRICE_ID.' }, { status: 500 });
  }

  const origin = request.headers.get('origin') ?? request.nextUrl.origin;

  try {
    // Reuse the customer we already recorded, so a returning subscriber does
    // not accumulate duplicate Stripe customers.
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    const customerId: string | undefined = existing?.stripe_customer_id ?? undefined;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/dashboard?checkout=cancelled`,
      client_reference_id: user.id,
      // The webhook is the only writer of subscription state, so it needs the
      // user id on the event itself.
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },
      ...(customerId ? { customer: customerId } : { customer_email: user.email }),
    });

    if (!session.url) {
      return NextResponse.json({ error: 'Stripe returned no checkout URL.' }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Could not start checkout.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
