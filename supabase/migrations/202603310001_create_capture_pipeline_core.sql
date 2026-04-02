-- Cria o modelo paralelo de captura segura, fila de processamento,
-- drafts de ideia e ponte de exportacao sem acoplar com as tabelas legadas.

CREATE TABLE IF NOT EXISTS public.capture_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),
  provisional_folder_name TEXT NOT NULL,
  final_folder_name TEXT,
  rename_required BOOLEAN NOT NULL DEFAULT true,
  processing_status TEXT NOT NULL DEFAULT 'captured' CHECK (
    processing_status IN (
      'captured',
      'awaiting-segmentation',
      'segmenting',
      'segmented',
      'awaiting-transcription',
      'transcribing',
      'transcribed',
      'materialized',
      'ready',
      'failed'
    )
  ),
  platform_source TEXT NOT NULL CHECK (platform_source IN ('web', 'macos', 'android', 'ios')),
  raw_storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (
    final_folder_name IS NULL
    OR btrim(final_folder_name) <> ''
  )
);

CREATE TABLE IF NOT EXISTS public.audio_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.capture_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  start_ms BIGINT NOT NULL CHECK (start_ms >= 0),
  end_ms BIGINT NOT NULL CHECK (end_ms > start_ms),
  duration_ms BIGINT NOT NULL CHECK (duration_ms > 0),
  segmentation_reason TEXT NOT NULL CHECK (
    segmentation_reason IN (
      'strong-delimiter',
      'probable-silence',
      'structural-silence',
      'session-end',
      'manual-stop',
      'single-pass',
      'fallback',
      'unknown'
    )
  ),
  queue_status TEXT NOT NULL DEFAULT 'segmented' CHECK (
    queue_status IN (
      'captured',
      'awaiting-segmentation',
      'segmenting',
      'segmented',
      'awaiting-transcription',
      'transcribing',
      'transcribed',
      'materialized',
      'ready',
      'failed'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (duration_ms = (end_ms - start_ms))
);

CREATE TABLE IF NOT EXISTS public.transcription_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID NOT NULL REFERENCES public.audio_chunks(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  transcript_text TEXT,
  raw_response JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (
    status NOT IN ('completed', 'failed')
    OR completed_at IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.idea_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.capture_sessions(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES public.audio_chunks(id) ON DELETE CASCADE,
  transcript_text TEXT NOT NULL,
  cleaned_text TEXT,
  suggested_title TEXT,
  suggested_tags TEXT[] NOT NULL DEFAULT '{}',
  suggested_folder TEXT,
  status TEXT NOT NULL DEFAULT 'drafted' CHECK (status IN ('drafted', 'reviewed', 'exported', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bridge_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_draft_id UUID NOT NULL REFERENCES public.idea_drafts(id) ON DELETE CASCADE,
  destination TEXT NOT NULL CHECK (destination IN ('cenax', 'bardo')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'exporting', 'exported', 'failed')),
  error TEXT,
  exported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    status <> 'exported'
    OR exported_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_capture_sessions_user_id_started_at
  ON public.capture_sessions(user_id, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capture_sessions_id_user_id
  ON public.capture_sessions(id, user_id);

CREATE INDEX IF NOT EXISTS idx_capture_sessions_processing_status
  ON public.capture_sessions(user_id, processing_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_capture_sessions_rename_required
  ON public.capture_sessions(user_id, rename_required, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_capture_sessions_platform_source
  ON public.capture_sessions(platform_source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audio_chunks_session_id_start_ms
  ON public.audio_chunks(session_id, start_ms);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_chunks_id_user_id
  ON public.audio_chunks(id, user_id);

CREATE INDEX IF NOT EXISTS idx_audio_chunks_user_id_created_at
  ON public.audio_chunks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audio_chunks_queue_status
  ON public.audio_chunks(user_id, queue_status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_chunks_unique_range_per_session
  ON public.audio_chunks(session_id, start_ms, end_ms);

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_chunk_id_created_at
  ON public.transcription_jobs(chunk_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_status_created_at
  ON public.transcription_jobs(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transcription_jobs_single_active_per_chunk
  ON public.transcription_jobs(chunk_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_idea_drafts_user_id_created_at
  ON public.idea_drafts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_idea_drafts_session_id_created_at
  ON public.idea_drafts(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_idea_drafts_status_created_at
  ON public.idea_drafts(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_idea_drafts_suggested_tags
  ON public.idea_drafts USING GIN(suggested_tags);

CREATE UNIQUE INDEX IF NOT EXISTS idx_idea_drafts_unique_chunk
  ON public.idea_drafts(chunk_id);

CREATE INDEX IF NOT EXISTS idx_bridge_exports_draft_created_at
  ON public.bridge_exports(idea_draft_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bridge_exports_status_destination
  ON public.bridge_exports(status, destination, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_exports_single_active_per_destination
  ON public.bridge_exports(idea_draft_id, destination)
  WHERE status IN ('pending', 'exporting');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'audio_chunks_session_user_fkey'
      AND conrelid = 'public.audio_chunks'::regclass
  ) THEN
    ALTER TABLE public.audio_chunks
      ADD CONSTRAINT audio_chunks_session_user_fkey
      FOREIGN KEY (session_id, user_id)
      REFERENCES public.capture_sessions(id, user_id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'idea_drafts_session_user_fkey'
      AND conrelid = 'public.idea_drafts'::regclass
  ) THEN
    ALTER TABLE public.idea_drafts
      ADD CONSTRAINT idea_drafts_session_user_fkey
      FOREIGN KEY (session_id, user_id)
      REFERENCES public.capture_sessions(id, user_id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'idea_drafts_chunk_user_fkey'
      AND conrelid = 'public.idea_drafts'::regclass
  ) THEN
    ALTER TABLE public.idea_drafts
      ADD CONSTRAINT idea_drafts_chunk_user_fkey
      FOREIGN KEY (chunk_id, user_id)
      REFERENCES public.audio_chunks(id, user_id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

ALTER TABLE public.capture_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audio_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcription_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_exports ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_capture_session_owner(target_session_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.capture_sessions
    WHERE id = target_session_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_audio_chunk_owner(target_chunk_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.audio_chunks
    WHERE id = target_chunk_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_idea_draft_owner(target_draft_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.idea_drafts
    WHERE id = target_draft_id
      AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_capture_session_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_audio_chunk_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_idea_draft_owner(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_capture_session_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_audio_chunk_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_idea_draft_owner(UUID) TO authenticated;

DROP TRIGGER IF EXISTS touch_capture_sessions_updated_at ON public.capture_sessions;
CREATE TRIGGER touch_capture_sessions_updated_at
  BEFORE UPDATE ON public.capture_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_audio_chunks_updated_at ON public.audio_chunks;
CREATE TRIGGER touch_audio_chunks_updated_at
  BEFORE UPDATE ON public.audio_chunks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_idea_drafts_updated_at ON public.idea_drafts;
CREATE TRIGGER touch_idea_drafts_updated_at
  BEFORE UPDATE ON public.idea_drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_bridge_exports_updated_at ON public.bridge_exports;
CREATE TRIGGER touch_bridge_exports_updated_at
  BEFORE UPDATE ON public.bridge_exports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP POLICY IF EXISTS "Users manage own capture sessions" ON public.capture_sessions;
CREATE POLICY "Users manage own capture sessions"
  ON public.capture_sessions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own audio chunks" ON public.audio_chunks;
CREATE POLICY "Users manage own audio chunks"
  ON public.audio_chunks
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own transcription jobs" ON public.transcription_jobs;
CREATE POLICY "Users view own transcription jobs"
  ON public.transcription_jobs
  FOR SELECT
  USING (public.is_audio_chunk_owner(chunk_id));

DROP POLICY IF EXISTS "Users create own transcription jobs" ON public.transcription_jobs;
CREATE POLICY "Users create own transcription jobs"
  ON public.transcription_jobs
  FOR INSERT
  WITH CHECK (public.is_audio_chunk_owner(chunk_id));

DROP POLICY IF EXISTS "Users update own transcription jobs" ON public.transcription_jobs;
CREATE POLICY "Users update own transcription jobs"
  ON public.transcription_jobs
  FOR UPDATE
  USING (public.is_audio_chunk_owner(chunk_id))
  WITH CHECK (public.is_audio_chunk_owner(chunk_id));

DROP POLICY IF EXISTS "Users delete own transcription jobs" ON public.transcription_jobs;
CREATE POLICY "Users delete own transcription jobs"
  ON public.transcription_jobs
  FOR DELETE
  USING (public.is_audio_chunk_owner(chunk_id));

DROP POLICY IF EXISTS "Users manage own idea drafts" ON public.idea_drafts;
CREATE POLICY "Users manage own idea drafts"
  ON public.idea_drafts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own bridge exports" ON public.bridge_exports;
CREATE POLICY "Users view own bridge exports"
  ON public.bridge_exports
  FOR SELECT
  USING (public.is_idea_draft_owner(idea_draft_id));

DROP POLICY IF EXISTS "Users create own bridge exports" ON public.bridge_exports;
CREATE POLICY "Users create own bridge exports"
  ON public.bridge_exports
  FOR INSERT
  WITH CHECK (public.is_idea_draft_owner(idea_draft_id));

DROP POLICY IF EXISTS "Users update own bridge exports" ON public.bridge_exports;
CREATE POLICY "Users update own bridge exports"
  ON public.bridge_exports
  FOR UPDATE
  USING (public.is_idea_draft_owner(idea_draft_id))
  WITH CHECK (public.is_idea_draft_owner(idea_draft_id));

DROP POLICY IF EXISTS "Users delete own bridge exports" ON public.bridge_exports;
CREATE POLICY "Users delete own bridge exports"
  ON public.bridge_exports
  FOR DELETE
  USING (public.is_idea_draft_owner(idea_draft_id));

INSERT INTO storage.buckets (id, name, public, allowed_mime_types)
VALUES (
  'voice-captures',
  'voice-captures',
  false,
  ARRAY[
    'audio/webm',
    'audio/mp4',
    'audio/m4a',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/aac',
    'audio/x-m4a',
    'audio/3gpp'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Users view own voice capture objects" ON storage.objects;
CREATE POLICY "Users view own voice capture objects"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'voice-captures'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users upload own voice capture objects" ON storage.objects;
CREATE POLICY "Users upload own voice capture objects"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'voice-captures'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users update own voice capture objects" ON storage.objects;
CREATE POLICY "Users update own voice capture objects"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'voice-captures'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'voice-captures'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own voice capture objects" ON storage.objects;
CREATE POLICY "Users delete own voice capture objects"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'voice-captures'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) = auth.uid()::text
  );
