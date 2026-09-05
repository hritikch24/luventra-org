-- Subscription state written exclusively by the Stripe webhook.
-- One row per user; the webhook upserts on user_id.

create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  stripe_price_id        text,
  status                 text not null default 'incomplete'
                           check (status in ('active','trialing','past_due','canceled',
                                             'incomplete','unpaid','paused')),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists subscriptions_stripe_subscription_id_idx
  on public.subscriptions (stripe_subscription_id);

alter table public.subscriptions enable row level security;

-- A user may read only their own row. Nobody may write from the client: the
-- webhook uses the service-role key, which bypasses RLS.
drop policy if exists "read own subscription" on public.subscriptions;
create policy "read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);
