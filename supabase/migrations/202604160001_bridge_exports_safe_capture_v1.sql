ALTER TABLE public.bridge_exports
  ALTER COLUMN idea_draft_id DROP NOT NULL;

ALTER TABLE public.bridge_exports
  ADD COLUMN IF NOT EXISTS content_type TEXT,
  ADD COLUMN IF NOT EXISTS note_id UUID REFERENCES public.notes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS organized_idea_id UUID REFERENCES public.organized_ideas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS validation_status TEXT,
  ADD COLUMN IF NOT EXISTS validation_issues JSONB;

UPDATE public.bridge_exports
SET content_type = 'idea_draft'
WHERE content_type IS NULL;

UPDATE public.bridge_exports
SET validation_status = 'valid'
WHERE validation_status IS NULL;

UPDATE public.bridge_exports
SET validation_issues = '[]'::jsonb
WHERE validation_issues IS NULL;

ALTER TABLE public.bridge_exports
  ALTER COLUMN content_type SET DEFAULT 'idea_draft',
  ALTER COLUMN content_type SET NOT NULL,
  ALTER COLUMN validation_status SET DEFAULT 'valid',
  ALTER COLUMN validation_status SET NOT NULL,
  ALTER COLUMN validation_issues SET DEFAULT '[]'::jsonb,
  ALTER COLUMN validation_issues SET NOT NULL;

ALTER TABLE public.bridge_exports
  DROP CONSTRAINT IF EXISTS bridge_exports_content_type_check,
  DROP CONSTRAINT IF EXISTS bridge_exports_validation_status_check,
  DROP CONSTRAINT IF EXISTS bridge_exports_target_reference_check;

ALTER TABLE public.bridge_exports
  ADD CONSTRAINT bridge_exports_content_type_check
  CHECK (content_type IN ('idea_draft', 'note', 'organized_idea')),
  ADD CONSTRAINT bridge_exports_validation_status_check
  CHECK (validation_status IN ('valid', 'blocked')),
  ADD CONSTRAINT bridge_exports_target_reference_check
  CHECK (
    (content_type = 'idea_draft' AND idea_draft_id IS NOT NULL AND note_id IS NULL AND organized_idea_id IS NULL)
    OR (content_type = 'note' AND note_id IS NOT NULL AND idea_draft_id IS NULL AND organized_idea_id IS NULL)
    OR (content_type = 'organized_idea' AND organized_idea_id IS NOT NULL AND idea_draft_id IS NULL AND note_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_bridge_exports_note_created_at
  ON public.bridge_exports(note_id, created_at DESC)
  WHERE note_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bridge_exports_organized_created_at
  ON public.bridge_exports(organized_idea_id, created_at DESC)
  WHERE organized_idea_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_exports_single_active_note_per_destination
  ON public.bridge_exports(note_id, destination)
  WHERE note_id IS NOT NULL
    AND status IN ('pending', 'exporting');

CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_exports_single_active_organized_per_destination
  ON public.bridge_exports(organized_idea_id, destination)
  WHERE organized_idea_id IS NOT NULL
    AND status IN ('pending', 'exporting');

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

DROP POLICY IF EXISTS "Users view own bridge exports" ON public.bridge_exports;
CREATE POLICY "Users view own bridge exports"
  ON public.bridge_exports
  FOR SELECT
  USING (
    (content_type = 'idea_draft' AND public.is_idea_draft_owner(idea_draft_id))
    OR (content_type = 'note' AND public.is_note_owner(note_id))
    OR (content_type = 'organized_idea' AND public.is_organized_idea_owner(organized_idea_id))
  );

DROP POLICY IF EXISTS "Users create own bridge exports" ON public.bridge_exports;
CREATE POLICY "Users create own bridge exports"
  ON public.bridge_exports
  FOR INSERT
  WITH CHECK (
    (content_type = 'idea_draft' AND public.is_idea_draft_owner(idea_draft_id))
    OR (content_type = 'note' AND public.is_note_owner(note_id))
    OR (content_type = 'organized_idea' AND public.is_organized_idea_owner(organized_idea_id))
  );

DROP POLICY IF EXISTS "Users update own bridge exports" ON public.bridge_exports;
CREATE POLICY "Users update own bridge exports"
  ON public.bridge_exports
  FOR UPDATE
  USING (
    (content_type = 'idea_draft' AND public.is_idea_draft_owner(idea_draft_id))
    OR (content_type = 'note' AND public.is_note_owner(note_id))
    OR (content_type = 'organized_idea' AND public.is_organized_idea_owner(organized_idea_id))
  )
  WITH CHECK (
    (content_type = 'idea_draft' AND public.is_idea_draft_owner(idea_draft_id))
    OR (content_type = 'note' AND public.is_note_owner(note_id))
    OR (content_type = 'organized_idea' AND public.is_organized_idea_owner(organized_idea_id))
  );

DROP POLICY IF EXISTS "Users delete own bridge exports" ON public.bridge_exports;
CREATE POLICY "Users delete own bridge exports"
  ON public.bridge_exports
  FOR DELETE
  USING (
    (content_type = 'idea_draft' AND public.is_idea_draft_owner(idea_draft_id))
    OR (content_type = 'note' AND public.is_note_owner(note_id))
    OR (content_type = 'organized_idea' AND public.is_organized_idea_owner(organized_idea_id))
  );
