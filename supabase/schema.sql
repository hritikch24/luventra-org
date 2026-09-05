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
-- Telemetry.
--
-- Holds counters plus coarse visitor origin. It still has no column able to
-- hold statement content: no filename, amount, payee or account number, and
-- row counts are coarse bands rather than exact figures.
--
-- `ip` IS personal data under UK/EU GDPR. It is stored to count unique
-- visitors and must therefore have a retention limit and a lawful basis. The
-- purge helper at the bottom of this file exists for that reason — schedule
-- it. Anyone holding the /metrics key can read this table.
-- ---------------------------------------------------------------------------

create table if not exists public.telemetry_events (
  id           bigserial primary key,
  event        text not null
                 check (event in ('visitor_landed','file_loaded','preflight_pass',
                                  'conversion_success','conversion_failed','user_logged_in')),
  session_id   uuid not null,
  surface      text not null default 'other'
                 check (surface in ('dashboard','bank','other')),
  bank_slug    text,
  dialect      text check (dialect in ('ofx','qbo','qfx')),
  row_bucket   text check (row_bucket in ('1-50','51-200','201-1000','1000+')),
  referrer_host text,
  -- ISO-3166-1 alpha-2 from the edge, e.g. "GB". Never a city or coordinate.
  country      text check (country is null or country ~ '^[A-Z]{2}$'),
  -- Visitor IP, for unique-visitor counts. Personal data: purge on schedule.
  ip           inet,
  -- Client engine, inferred from the User-Agent and mapped to a closed set.
  -- The raw header is never stored: it is a strong fingerprinting vector.
  browser      text,
  os           text,
  -- Structural failure reason for conversion_failed, e.g. TIMEOUT_EXCEEDED.
  error_code   text,
  created_at   timestamptz not null default now()
);

-- Existing deployments: add the new columns without dropping data.
alter table public.telemetry_events add column if not exists country text;
alter table public.telemetry_events add column if not exists ip inet;
alter table public.telemetry_events add column if not exists error_code text;
alter table public.telemetry_events add column if not exists browser text;
alter table public.telemetry_events add column if not exists os text;

create index if not exists telemetry_events_created_at_idx
  on public.telemetry_events (created_at desc);
create index if not exists telemetry_events_session_idx
  on public.telemetry_events (session_id);
create index if not exists telemetry_events_bank_idx
  on public.telemetry_events (bank_slug) where bank_slug is not null;
create index if not exists telemetry_events_event_idx
  on public.telemetry_events (event, created_at desc);

alter table public.telemetry_events enable row level security;

-- No client policy is granted: reads and writes both go through server code
-- holding the service-role key.

-- Retention. Ninety days is longer than any dashboard range offered, and
-- keeping raw IPs past that has no analytical value. Schedule with pg_cron:
--   select cron.schedule('purge-telemetry','0 3 * * *',
--     $$select public.purge_old_telemetry()$$);
create or replace function public.purge_old_telemetry()
returns void language sql security definer as $$
  delete from public.telemetry_events where created_at < now() - interval '90 days';
$$;
