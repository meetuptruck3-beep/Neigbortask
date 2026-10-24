-- Apply this migration in the existing Supabase SQL editor before enabling Stripe Connect.
-- Persist only the user -> Stripe account mapping; onboarding status is always read live from Stripe.
create table if not exists public.stripe_connected_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_account_id text not null unique,
  created_at timestamptz not null default now()
);
alter table public.stripe_connected_accounts enable row level security;
drop policy if exists "Users can read their own Stripe account mapping" on public.stripe_connected_accounts;
create policy "Users can read their own Stripe account mapping"
  on public.stripe_connected_accounts for select to authenticated
  using (auth.uid() = user_id);
-- Only server-side service-role code writes account mappings. No browser insert/update/delete policy is granted.

create table if not exists public.stripe_subscriptions (
  stripe_subscription_id text primary key,
  customer_account_id text,
  status text not null,
  price_id text,
  quantity integer not null default 1,
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.stripe_subscriptions enable row level security;
-- TODO: Add a user-scoped SELECT policy after deciding which subscription details sellers may see.
-- This table is written by the server-side webhook only; no browser access is granted here.
