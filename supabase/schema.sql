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

-- ---------------------------------------------------------------------------
-- Telemetry: numeric and enumerated counters only.
--
-- Deliberately incapable of holding statement content. There is no column for
-- a filename, an account number, a payee, an amount or any free text. Row
-- counts are stored as a coarse bucket rather than an exact figure, because an
-- exact count is itself a weak fingerprint of a specific statement.
--
-- `session_id` is a random per-tab value generated in the browser. It is not
-- derived from a user, a cookie or an IP, and it is not joined to auth.users.
-- ---------------------------------------------------------------------------

create table if not exists public.telemetry_events (
  id           bigserial primary key,
  event        text not null
                 check (event in ('page_view','file_loaded','preflight_pass','export')),
  session_id   uuid not null,
  -- Which of our own pages, never a user-supplied path.
  surface      text not null default 'other'
                 check (surface in ('dashboard','bank','other')),
  -- Slug of one of our own bank pages; null elsewhere.
  bank_slug    text,
  -- Output format chosen, for `export` rows.
  dialect      text check (dialect in ('ofx','qbo','qfx')),
  -- Coarse size band, never an exact row count.
  row_bucket   text check (row_bucket in ('1-50','51-200','201-1000','1000+')),
  -- Registrable host of the referrer only (e.g. "google.com"), never a full URL.
  referrer_host text,
  created_at   timestamptz not null default now()
);

create index if not exists telemetry_events_created_at_idx
  on public.telemetry_events (created_at desc);
create index if not exists telemetry_events_session_idx
  on public.telemetry_events (session_id);
create index if not exists telemetry_events_bank_idx
  on public.telemetry_events (bank_slug) where bank_slug is not null;

alter table public.telemetry_events enable row level security;

-- No client may read telemetry; the metrics page uses the service-role key.
-- Writes arrive through the server route, which also uses the service role, so
-- no anon policy is granted here either.
