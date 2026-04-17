-- bridge_items: adiciona timestamp de rejeição (blocked_at).
-- Aditivo e idempotente. Sem CHECK obrigatório — rows legadas em
-- 'blocked' sem timestamp ficam válidas.
--
-- Simetria com consumed_at (que já existe).

alter table public.bridge_items
  add column if not exists blocked_at timestamptz;

comment on column public.bridge_items.blocked_at is
  'Timestamp em que o bridge_item foi marcado como blocked pelo consumidor (Bardo). Nullable para rows legadas. Simétrico a consumed_at.';
