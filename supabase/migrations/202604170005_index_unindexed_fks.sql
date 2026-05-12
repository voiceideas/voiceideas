-- Fix INFO: unindexed_foreign_keys
--
-- Adiciona índices cobrindo os FKs mais quentes do pipeline de captura
-- e os de uso geral (ai_usage, folders, security_events).
-- FKs de baixo volume (invite/member tables) não são priorizados aqui.

-- ─── ai_usage_ledger ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_user_id
  ON public.ai_usage_ledger(user_id);

-- ─── audio_chunks ───────────────────────────────────────────────────────────
-- FK composta (user_id, session_id) — padrão de query do pipeline
CREATE INDEX IF NOT EXISTS idx_audio_chunks_user_session
  ON public.audio_chunks(user_id, session_id);

-- ─── folders ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_folders_user_id
  ON public.folders(user_id);

-- ─── idea_drafts ────────────────────────────────────────────────────────────
-- FK (user_id, session_id)
CREATE INDEX IF NOT EXISTS idx_idea_drafts_user_session
  ON public.idea_drafts(user_id, session_id);

-- FK (user_id, chunk_id)
CREATE INDEX IF NOT EXISTS idx_idea_drafts_user_chunk
  ON public.idea_drafts(user_id, chunk_id);

-- ─── security_events ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_security_events_user_id
  ON public.security_events(user_id);

-- ─── idea_invites ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_idea_invites_accepted_by
  ON public.idea_invites(accepted_by)
  WHERE accepted_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_idea_invites_invited_by
  ON public.idea_invites(invited_by);
