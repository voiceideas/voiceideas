create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  target text,
  ip text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null,
  units integer not null default 0,
  estimated_cost_usd numeric(10,4) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_cost_limit_usd numeric(10,4) not null default 1.00,
  daily_request_limit integer not null default 100
);

alter table public.security_events enable row level security;
alter table public.ai_usage_ledger enable row level security;
alter table public.ai_usage_limits enable row level security;

drop policy if exists "users can read own ai ledger" on public.ai_usage_ledger;
create policy "users can read own ai ledger"
on public.ai_usage_ledger
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can read own ai limits" on public.ai_usage_limits;
create policy "users can read own ai limits"
on public.ai_usage_limits
for select
to authenticated
using (auth.uid() = user_id);
