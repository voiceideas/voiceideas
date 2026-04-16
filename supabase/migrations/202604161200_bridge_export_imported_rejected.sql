-- bridge_exports: evolução da máquina de estados para suportar a distinção
-- entre imported e rejected no VI (reviewer requerimento do Bardo consumer
-- EXECUTE, PLAN v4 + mini-PLAN v2).
--
-- Antes desta migration:
--   enum bridge_export_status = ('pending', 'fetched', 'expired')
--   colunas: created_at (NN), fetched_at (nullable)
--
-- Depois desta migration:
--   enum bridge_export_status =
--     ('pending', 'fetched', 'expired', 'imported', 'rejected')
--   colunas: created_at (NN), fetched_at (nullable, legado),
--            imported_at (nullable, NOVO),
--            rejected_at (nullable, NOVO)
--
-- Estados ativos a partir de agora:
--   pending   → criado pelo produtor (VoiceIdeas)
--   imported  → Bardo marcou como importado via EF
--   rejected  → Bardo marcou como rejeitado via EF
--   expired   → reservado para TTL futuro (cron)
--
-- Estado legado (mantido por compat, não setado daqui em diante):
--   fetched   → rows antigas que o Bardo consumiu antes desta migration
--               (Postgres não permite ALTER TYPE DROP VALUE)
--
-- A migration é idempotente:
--   - ADD VALUE IF NOT EXISTS (nativo do Postgres)
--   - ADD COLUMN IF NOT EXISTS (nativo do Postgres)
--
-- Nota técnica (ALTER TYPE em transação):
--   Em Postgres 12+ ALTER TYPE ADD VALUE pode rodar em transação
--   desde que nenhum statement subsequente use o novo valor na
--   mesma transação. Não há INSERT/UPDATE aqui, só DDL, então é
--   seguro rodar tudo num único arquivo de migration.

-- ── Enum values novos ──

alter type bridge_export_status add value if not exists 'imported';
alter type bridge_export_status add value if not exists 'rejected';

-- ── Colunas de timestamp para os novos estados ──

alter table bridge_exports
  add column if not exists imported_at timestamptz;

alter table bridge_exports
  add column if not exists rejected_at timestamptz;

-- ── Documentação (comment) ──

comment on type bridge_export_status is
  'Estados do ciclo de vida de um export bridge VI → Bardo. Ativos: pending, imported, rejected, expired. Legado (compat, não setado): fetched.';

comment on column bridge_exports.fetched_at is
  'Timestamp do antigo estado fetched — legado, preservado para rows criadas antes da migration 202604161200. Novas rows usam imported_at ou rejected_at.';

comment on column bridge_exports.imported_at is
  'Timestamp em que o Bardo marcou este export como importado.';

comment on column bridge_exports.rejected_at is
  'Timestamp em que o Bardo marcou este export como rejeitado.';
