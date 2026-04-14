-- user_settings: tabela de configurações do usuário.
-- Separada de user_profiles (que é de quota/role) para manter concerns distintos.
-- bardo_bridge_enabled: consentimento explícito do usuário para exportar para o Bardo.

create table user_settings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references auth.users(id) on delete cascade,
  bardo_bridge_enabled boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- RLS
alter table user_settings enable row level security;

create policy "Users can view own settings"
  on user_settings for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own settings"
  on user_settings for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own settings"
  on user_settings for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Auto-update updated_at
create or replace function update_user_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger user_settings_updated_at
  before update on user_settings
  for each row execute function update_user_settings_updated_at();
