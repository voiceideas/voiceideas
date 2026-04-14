-- bridge_exports: tabela que armazena envelopes Bridge V1 prontos para consumo pelo Bardo.
-- Cada row é um snapshot imutável do payload gerado pelo VoiceIdeas.
-- Identidade cross-projeto: owner_email (normalizado trim+lower) — não auth.uid().
-- Idempotência: UNIQUE(owner_email, content_hash) impede duplicatas exatas.

-- Status lifecycle:
--   pending  → criado, aguardando fetch do Bardo
--   fetched  → Bardo leu via Edge Function
--   expired  → TTL expirado (futuro, via cron)

create type bridge_export_status as enum ('pending', 'fetched', 'expired');

create table bridge_exports (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  owner_email   text not null,
  payload       jsonb not null,
  content_hash  text not null,        -- SHA-256 hex do payload serializado
  status        bridge_export_status not null default 'pending',
  created_at    timestamptz not null default now(),
  fetched_at    timestamptz,

  -- Idempotência: mesmo email + mesmo hash = mesma exportação
  constraint bridge_exports_idempotency unique (owner_email, content_hash)
);

-- Índices para queries frequentes
create index bridge_exports_owner_email_status_idx
  on bridge_exports (owner_email, status)
  where status = 'pending';

create index bridge_exports_owner_user_idx
  on bridge_exports (owner_user_id);

-- RLS
alter table bridge_exports enable row level security;

-- Usuário pode inserir suas próprias exportações
create policy "Users can insert own bridge exports"
  on bridge_exports for insert
  to authenticated
  with check (owner_user_id = auth.uid());

-- Usuário pode ver suas próprias exportações
create policy "Users can view own bridge exports"
  on bridge_exports for select
  to authenticated
  using (owner_user_id = auth.uid());

-- Usuário pode deletar suas próprias exportações
create policy "Users can delete own bridge exports"
  on bridge_exports for delete
  to authenticated
  using (owner_user_id = auth.uid());

-- Service role (Edge Function) pode ler e atualizar qualquer row
-- (via supabaseServiceRoleKey — bypassa RLS automaticamente)

-- Comentário: update de status (pending→fetched) é feito pela Edge Function
-- com service role, não pelo usuário diretamente.
