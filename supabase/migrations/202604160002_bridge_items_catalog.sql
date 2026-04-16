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

ALTER TABLE public.bridge_items ENABLE ROW LEVEL SECURITY;

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

DROP TRIGGER IF EXISTS touch_bridge_items_updated_at ON public.bridge_items;
CREATE TRIGGER touch_bridge_items_updated_at
  BEFORE UPDATE ON public.bridge_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP POLICY IF EXISTS "Users manage own bridge items" ON public.bridge_items;
CREATE POLICY "Users manage own bridge items"
  ON public.bridge_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
