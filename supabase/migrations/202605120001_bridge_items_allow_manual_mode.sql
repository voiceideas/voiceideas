-- VI_BRIDGE.MODES.1 — Permitir manual/contínuo no catálogo bridge_items.
--
-- Estado anterior:
--   bridge_items.source_session_mode era NOT NULL com CHECK constraint
--     (source_session_mode = 'safe_capture'::text)
--   Isso bloqueava qualquer note que não viesse de safe_capture
--   (notas manuais e modo contínuo Web Speech / Tauri / web ficavam fora).
--
-- Estado novo:
--   source_session_mode aceita 'safe_capture' OU 'manual'.
--   'manual' cobre os dois caminhos não-safe-capture (manual unico + contínuo)
--   porque o schema atual de notes NÃO distingue manual de contínuo
--   (nenhuma das duas trajetórias popula source_capture_session_id;
--   ambas inserem direto em notes via caminho cliente).
--
-- Identificação no servidor:
--   notes.source_capture_session_id IS NOT NULL → 'safe_capture'
--   notes.source_capture_session_id IS NULL     → 'manual'
--
-- Não adicionamos um campo novo em notes pra não exigir backfill em base
-- legada. A derivação é determinística a partir do schema existente.
--
-- Migration idempotente: aceita rodar múltiplas vezes sem efeito colateral.

DO $$
BEGIN
  -- Drop antigo (se existir com o nome esperado)
  IF EXISTS (
    SELECT 1
    FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'bridge_items_source_session_mode_check'
  ) THEN
    ALTER TABLE public.bridge_items
      DROP CONSTRAINT bridge_items_source_session_mode_check;
  END IF;

  -- Garante que o constraint novo só é criado se ainda não existir.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'bridge_items'
      AND constraint_name = 'bridge_items_source_session_mode_check'
  ) THEN
    ALTER TABLE public.bridge_items
      ADD CONSTRAINT bridge_items_source_session_mode_check
      CHECK (source_session_mode IN ('safe_capture', 'manual'));
  END IF;
END
$$;

COMMENT ON COLUMN public.bridge_items.source_session_mode IS
  'Origem da nota/ideia: safe_capture (Android Foreground Service) OU manual '
  '(qualquer outro caminho — manual único, contínuo Web Speech, Tauri/desktop). '
  'Derivado em tempo de materialização a partir de notes.source_capture_session_id '
  '(NOT NULL → safe_capture; NULL → manual). Não há campo dedicado em notes '
  'porque manual e contínuo são indistinguíveis no schema atual.';
