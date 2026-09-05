import { NextResponse } from 'next/server';
import { createClient } from '@/app/lib/supabase/server';
import { hasSupabaseEnv } from '@/app/lib/supabase/env';

export const dynamic = 'force-dynamic';

/** Statuses that entitle a user to the paid tier. */
const ENTITLED = new Set(['active', 'trialing']);

export interface SubscriptionState {
  /** False when Supabase is not set up, in which case billing is not enforced. */
  readonly configured: boolean;
  readonly signedIn: boolean;
  readonly active: boolean;
  readonly status: string | null;
}

export async function GET() {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({
      configured: false,
      signedIn: false,
      active: false,
      status: null,
    } satisfies SubscriptionState);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({
      configured: true,
      signedIn: false,
      active: false,
      status: null,
    } satisfies SubscriptionState);
  }

  // RLS restricts this to the caller's own row, so no user id filter is
  // strictly required — it is included to keep the intent obvious.
  const { data } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('user_id', user.id)
    .maybeSingle();

  const status: string | null = data?.status ?? null;

  return NextResponse.json({
    configured: true,
    signedIn: true,
    active: status !== null && ENTITLED.has(status),
    status,
  } satisfies SubscriptionState);
}
