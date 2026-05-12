-- P1.3 — Account linking mínimo VI ↔ Bardo
--
-- Introduz vínculo explícito entre a conta VoiceIdeas (auth.users.id) e a
-- conta Bardo (bardo_user_id opaco fornecido pelo Bardo). Substitui a
-- suposição implícita de identidade por email na ponte legacy.
--
-- Identidade:
--   vi_user_id      — uuid da conta VoiceIdeas (FK auth.users).
--   bardo_user_id   — identificador opaco do Bardo (text, não assume uuid).
--   bardo_email     — snapshot do email usado no vínculo; NÃO é autoridade.
--
-- Estado:
--   link_status = 'active'  — vínculo operacional.
--   link_status = 'revoked' — revogado pelo usuário VI ou pelo Bardo.
--
-- Regra operacional (enforçada por partial unique):
--   para um mesmo par (vi_user_id, bardo_user_id) só pode existir um
--   vínculo ativo por vez. Revogar + relincar é permitido (novo row).

CREATE TABLE IF NOT EXISTS public.bardo_account_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vi_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bardo_user_id  text NOT NULL,
  bardo_email    text NULL,
  link_status    text NOT NULL DEFAULT 'active'
                   CHECK (link_status IN ('active', 'revoked')),
  linked_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bardo_account_links_bardo_user_id_not_blank
    CHECK (length(btrim(bardo_user_id)) > 0),

  CONSTRAINT bardo_account_links_revoked_consistency
    CHECK (
      (link_status = 'active'  AND revoked_at IS NULL) OR
      (link_status = 'revoked' AND revoked_at IS NOT NULL)
    )
);

-- ─── Índices ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bardo_account_links_vi_user
  ON public.bardo_account_links(vi_user_id);

CREATE INDEX IF NOT EXISTS idx_bardo_account_links_bardo_user
  ON public.bardo_account_links(bardo_user_id);

-- Só um vínculo ativo por par (vi_user_id, bardo_user_id)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bardo_account_links_active
  ON public.bardo_account_links(vi_user_id, bardo_user_id)
  WHERE link_status = 'active';

-- Lookup rápido de vínculo ativo por bardo_user_id (caminho quente do
-- consumer legacy)
CREATE INDEX IF NOT EXISTS idx_bardo_account_links_active_by_bardo_user
  ON public.bardo_account_links(bardo_user_id)
  WHERE link_status = 'active';

-- ─── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_bardo_account_links_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bardo_account_links_set_updated_at ON public.bardo_account_links;
CREATE TRIGGER bardo_account_links_set_updated_at
  BEFORE UPDATE ON public.bardo_account_links
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_bardo_account_links_set_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.bardo_account_links ENABLE ROW LEVEL SECURITY;

-- Usuário VI vê os próprios vínculos (ativos ou revogados).
DROP POLICY IF EXISTS "Users can view own bardo account links" ON public.bardo_account_links;
CREATE POLICY "Users can view own bardo account links"
  ON public.bardo_account_links
  FOR SELECT
  TO authenticated
  USING (vi_user_id = (SELECT auth.uid()));

-- Usuário VI cria vínculo apenas em nome próprio. Criação normalmente
-- ocorre via Edge Function (service role); essa policy cobre o caso
-- direto caso exista UI client-side futura.
DROP POLICY IF EXISTS "Users can insert own bardo account links" ON public.bardo_account_links;
CREATE POLICY "Users can insert own bardo account links"
  ON public.bardo_account_links
  FOR INSERT
  TO authenticated
  WITH CHECK (vi_user_id = (SELECT auth.uid()));

-- Usuário VI pode revogar os próprios vínculos (UPDATE limitado ao
-- campo link_status/revoked_at na aplicação; no RLS só garantimos
-- a posse do registro).
DROP POLICY IF EXISTS "Users can update own bardo account links" ON public.bardo_account_links;
CREATE POLICY "Users can update own bardo account links"
  ON public.bardo_account_links
  FOR UPDATE
  TO authenticated
  USING (vi_user_id = (SELECT auth.uid()))
  WITH CHECK (vi_user_id = (SELECT auth.uid()));

-- Usuário VI pode apagar os próprios vínculos (cleanup manual).
DROP POLICY IF EXISTS "Users can delete own bardo account links" ON public.bardo_account_links;
CREATE POLICY "Users can delete own bardo account links"
  ON public.bardo_account_links
  FOR DELETE
  TO authenticated
  USING (vi_user_id = (SELECT auth.uid()));

-- service_role mantém acesso total automaticamente (bypassa RLS).

COMMENT ON TABLE public.bardo_account_links IS
  'Vínculo explícito entre conta VoiceIdeas (vi_user_id) e conta Bardo (bardo_user_id). Substitui identidade implícita por email na ponte.';
COMMENT ON COLUMN public.bardo_account_links.bardo_user_id IS
  'Identificador opaco do Bardo (texto). Autoridade do lado Bardo — VI apenas persiste o valor emitido pelo Bardo no momento do aceite.';
COMMENT ON COLUMN public.bardo_account_links.bardo_email IS
  'Snapshot do email usado no vínculo. Não é fonte de autorização — mantido só para auditoria.';
