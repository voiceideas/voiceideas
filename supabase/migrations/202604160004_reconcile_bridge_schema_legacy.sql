-- Reconcile legacy remote schema to the current bridge schema.
-- This migration is idempotent and safe for remotes where bridge_exports already
-- exists in an older shape and migration history is incomplete.

BEGIN;

-- Shared updated_at helper (used by multiple tables).
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- user_settings (missing on legacy remote)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  bardo_bridge_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_user_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_settings_updated_at ON public.user_settings;
CREATE TRIGGER user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_settings_updated_at();

DROP POLICY IF EXISTS "Users can view own settings" ON public.user_settings;
CREATE POLICY "Users can view own settings"
  ON public.user_settings
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own settings" ON public.user_settings;
CREATE POLICY "Users can insert own settings"
  ON public.user_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own settings" ON public.user_settings;
CREATE POLICY "Users can update own settings"
  ON public.user_settings
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- bridge_items (missing on legacy remote)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bridge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('note', 'organized_idea')),
  source_id UUID NOT NULL,
  source_capture_session_id UUID REFERENCES public.capture_sessions(id) ON DELETE SET NULL,
  source_session_mode TEXT NOT NULL CHECK (source_session_mode IN ('safe_capture')),
  content_type TEXT NOT NULL CHECK (content_type IN ('note', 'organized_idea')),
  domain TEXT NOT NULL DEFAULT 'voiceideas' CHECK (domain IN ('voiceideas')),
  scope_type TEXT NOT NULL DEFAULT 'project' CHECK (scope_type IN ('project')),
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_status TEXT NOT NULL DEFAULT 'valid' CHECK (validation_status IN ('valid', 'blocked')),
  validation_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  bridge_status TEXT NOT NULL DEFAULT 'draft' CHECK (bridge_status IN ('draft', 'eligible', 'published', 'consumed', 'blocked')),
  destination_kind TEXT CHECK (destination_kind IN ('vault', 'character', 'lore', 'world')),
  destination_candidates TEXT[] NOT NULL DEFAULT '{}',
  published_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_type = content_type),
  CHECK (bridge_status <> 'published' OR published_at IS NOT NULL),
  CHECK (bridge_status <> 'consumed' OR consumed_at IS NOT NULL)
);

ALTER TABLE public.bridge_items ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS touch_bridge_items_updated_at ON public.bridge_items;
CREATE TRIGGER touch_bridge_items_updated_at
  BEFORE UPDATE ON public.bridge_items
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.is_bridge_item_owner(target_bridge_item_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bridge_items
    WHERE id = target_bridge_item_id
      AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_bridge_item_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_bridge_item_owner(UUID) TO authenticated;

DROP POLICY IF EXISTS "Users manage own bridge items" ON public.bridge_items;
CREATE POLICY "Users manage own bridge items"
  ON public.bridge_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_items_unique_source
  ON public.bridge_items(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_bridge_items_user_status_created_at
  ON public.bridge_items(user_id, bridge_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bridge_items_validation_created_at
  ON public.bridge_items(user_id, validation_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bridge_items_destination_created_at
  ON public.bridge_items(user_id, destination_kind, created_at DESC)
  WHERE destination_kind IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bridge_items_content_type_created_at
  ON public.bridge_items(user_id, content_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bridge_items_source_capture_session
  ON public.bridge_items(source_capture_session_id, created_at DESC)
  WHERE source_capture_session_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- bridge_exports legacy reconciliation
-- -----------------------------------------------------------------------------
ALTER TABLE public.bridge_exports
  ADD COLUMN IF NOT EXISTS content_type TEXT,
  ADD COLUMN IF NOT EXISTS note_id UUID REFERENCES public.notes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS organized_idea_id UUID REFERENCES public.organized_ideas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS validation_status TEXT,
  ADD COLUMN IF NOT EXISTS validation_issues JSONB,
  ADD COLUMN IF NOT EXISTS bridge_item_id UUID REFERENCES public.bridge_items(id) ON DELETE SET NULL;

-- Legacy rows are idea_draft exports.
UPDATE public.bridge_exports
SET content_type = 'idea_draft'
WHERE content_type IS NULL;

UPDATE public.bridge_exports
SET validation_status = 'valid'
WHERE validation_status IS NULL;

UPDATE public.bridge_exports
SET validation_issues = '[]'::jsonb
WHERE validation_issues IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bridge_exports'
      AND column_name = 'idea_draft_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.bridge_exports ALTER COLUMN idea_draft_id DROP NOT NULL';
  END IF;
END;
$$;

ALTER TABLE public.bridge_exports
  ALTER COLUMN content_type SET DEFAULT 'idea_draft',
  ALTER COLUMN content_type SET NOT NULL,
  ALTER COLUMN validation_status SET DEFAULT 'valid',
  ALTER COLUMN validation_status SET NOT NULL,
  ALTER COLUMN validation_issues SET DEFAULT '[]'::jsonb,
  ALTER COLUMN validation_issues SET NOT NULL;

ALTER TABLE public.bridge_exports
  DROP CONSTRAINT IF EXISTS bridge_exports_check,
  DROP CONSTRAINT IF EXISTS bridge_exports_status_check,
  DROP CONSTRAINT IF EXISTS bridge_exports_destination_check,
  DROP CONSTRAINT IF EXISTS bridge_exports_content_type_check,
  DROP CONSTRAINT IF EXISTS bridge_exports_validation_status_check,
  DROP CONSTRAINT IF EXISTS bridge_exports_target_reference_check;

ALTER TABLE public.bridge_exports
  ADD CONSTRAINT bridge_exports_status_check
  CHECK (status IN ('pending', 'exporting', 'exported', 'failed')),
  ADD CONSTRAINT bridge_exports_destination_check
  CHECK (destination IN ('cenax', 'bardo')),
  ADD CONSTRAINT bridge_exports_content_type_check
  CHECK (content_type IN ('idea_draft', 'note', 'organized_idea')),
  ADD CONSTRAINT bridge_exports_validation_status_check
  CHECK (validation_status IN ('valid', 'blocked')),
  ADD CONSTRAINT bridge_exports_target_reference_check
  CHECK (
    (content_type = 'idea_draft' AND idea_draft_id IS NOT NULL AND note_id IS NULL AND organized_idea_id IS NULL)
    OR (content_type = 'note' AND note_id IS NOT NULL AND idea_draft_id IS NULL AND organized_idea_id IS NULL)
    OR (content_type = 'organized_idea' AND organized_idea_id IS NOT NULL AND idea_draft_id IS NULL AND note_id IS NULL)
  ),
  ADD CONSTRAINT bridge_exports_exported_at_required_when_exported
  CHECK (status <> 'exported' OR exported_at IS NOT NULL);

CREATE OR REPLACE FUNCTION public.is_note_owner(target_note_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.notes
    WHERE id = target_note_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_organized_idea_owner(target_idea_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organized_ideas
    WHERE id = target_idea_id
      AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_note_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_organized_idea_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_note_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_organized_idea_owner(UUID) TO authenticated;

ALTER TABLE public.bridge_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own bridge exports" ON public.bridge_exports;
DROP POLICY IF EXISTS "Users create own bridge exports" ON public.bridge_exports;
DROP POLICY IF EXISTS "Users update own bridge exports" ON public.bridge_exports;
DROP POLICY IF EXISTS "Users delete own bridge exports" ON public.bridge_exports;
DROP POLICY IF EXISTS "Users can view own bridge exports" ON public.bridge_exports;
DROP POLICY IF EXISTS "Users can insert own bridge exports" ON public.bridge_exports;
DROP POLICY IF EXISTS "Users can update own bridge exports" ON public.bridge_exports;
DROP POLICY IF EXISTS "Users can delete own bridge exports" ON public.bridge_exports;

CREATE POLICY "Users view own bridge exports"
  ON public.bridge_exports
  FOR SELECT
  USING (
    (content_type = 'idea_draft' AND public.is_idea_draft_owner(idea_draft_id))
    OR (content_type = 'note' AND public.is_note_owner(note_id))
    OR (content_type = 'organized_idea' AND public.is_organized_idea_owner(organized_idea_id))
    OR (bridge_item_id IS NOT NULL AND public.is_bridge_item_owner(bridge_item_id))
  );

CREATE POLICY "Users create own bridge exports"
  ON public.bridge_exports
  FOR INSERT
  WITH CHECK (
    (
      (content_type = 'idea_draft' AND public.is_idea_draft_owner(idea_draft_id))
      OR (content_type = 'note' AND public.is_note_owner(note_id))
      OR (content_type = 'organized_idea' AND public.is_organized_idea_owner(organized_idea_id))
    )
    AND (bridge_item_id IS NULL OR public.is_bridge_item_owner(bridge_item_id))
  );

CREATE POLICY "Users update own bridge exports"
  ON public.bridge_exports
  FOR UPDATE
  USING (
    (content_type = 'idea_draft' AND public.is_idea_draft_owner(idea_draft_id))
    OR (content_type = 'note' AND public.is_note_owner(note_id))
    OR (content_type = 'organized_idea' AND public.is_organized_idea_owner(organized_idea_id))
    OR (bridge_item_id IS NOT NULL AND public.is_bridge_item_owner(bridge_item_id))
  )
  WITH CHECK (
    (
      (content_type = 'idea_draft' AND public.is_idea_draft_owner(idea_draft_id))
      OR (content_type = 'note' AND public.is_note_owner(note_id))
      OR (content_type = 'organized_idea' AND public.is_organized_idea_owner(organized_idea_id))
      OR (bridge_item_id IS NOT NULL AND public.is_bridge_item_owner(bridge_item_id))
    )
    AND (bridge_item_id IS NULL OR public.is_bridge_item_owner(bridge_item_id))
  );

CREATE POLICY "Users delete own bridge exports"
  ON public.bridge_exports
  FOR DELETE
  USING (
    (content_type = 'idea_draft' AND public.is_idea_draft_owner(idea_draft_id))
    OR (content_type = 'note' AND public.is_note_owner(note_id))
    OR (content_type = 'organized_idea' AND public.is_organized_idea_owner(organized_idea_id))
    OR (bridge_item_id IS NOT NULL AND public.is_bridge_item_owner(bridge_item_id))
  );

CREATE INDEX IF NOT EXISTS idx_bridge_exports_draft_created_at
  ON public.bridge_exports(idea_draft_id, created_at DESC)
  WHERE idea_draft_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bridge_exports_note_created_at
  ON public.bridge_exports(note_id, created_at DESC)
  WHERE note_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bridge_exports_organized_created_at
  ON public.bridge_exports(organized_idea_id, created_at DESC)
  WHERE organized_idea_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bridge_exports_status_destination
  ON public.bridge_exports(status, destination, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bridge_exports_bridge_item_created_at
  ON public.bridge_exports(bridge_item_id, created_at DESC)
  WHERE bridge_item_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_bridge_exports_single_active_per_destination'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX idx_bridge_exports_single_active_per_destination
        ON public.bridge_exports(idea_draft_id, destination)
        WHERE idea_draft_id IS NOT NULL
          AND status IN ('pending', 'exporting');
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'Skipped idx_bridge_exports_single_active_per_destination due to duplicates.';
    END;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_bridge_exports_single_active_note_per_destination'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX idx_bridge_exports_single_active_note_per_destination
        ON public.bridge_exports(note_id, destination)
        WHERE note_id IS NOT NULL
          AND status IN ('pending', 'exporting');
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'Skipped idx_bridge_exports_single_active_note_per_destination due to duplicates.';
    END;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_bridge_exports_single_active_organized_per_destination'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX idx_bridge_exports_single_active_organized_per_destination
        ON public.bridge_exports(organized_idea_id, destination)
        WHERE organized_idea_id IS NOT NULL
          AND status IN ('pending', 'exporting');
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'Skipped idx_bridge_exports_single_active_organized_per_destination due to duplicates.';
    END;
  END IF;
END;
$$;

COMMIT;
