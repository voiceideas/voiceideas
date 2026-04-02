-- =============================================
-- VoiceIdeas - Setup do Banco de Dados
-- Execute no Supabase SQL Editor (Dashboard)
-- =============================================

-- Tabela de perfis de usuario e cota diaria
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_limit INTEGER NOT NULL DEFAULT 10 CHECK (daily_limit > 0),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ DEFAULT now(),
  notes_used_today INTEGER DEFAULT 0,
  usage_date DATE
);

-- Tabela de pastas
CREATE TABLE IF NOT EXISTS public.folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de notas de voz
CREATE TABLE IF NOT EXISTS public.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  title TEXT,
  folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de ideias organizadas pela IA
CREATE TABLE IF NOT EXISTS public.organized_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_ids UUID[] NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('topicos', 'plano', 'roteiro', 'mapa')),
  title TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabelas de compartilhamento da v0.2
CREATE TABLE IF NOT EXISTS public.organized_idea_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_idea_id UUID NOT NULL REFERENCES public.organized_ideas(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_idea_id, owner_user_id)
);

CREATE TABLE IF NOT EXISTS public.organized_idea_share_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES public.organized_idea_shares(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organized_idea_share_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES public.organized_idea_shares(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_id UUID REFERENCES public.organized_idea_share_invites(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (share_id, user_id)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON public.notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_folder_id ON public.notes(folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON public.notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_organized_ideas_user_id ON public.organized_ideas(user_id);
CREATE INDEX IF NOT EXISTS idx_organized_ideas_created_at ON public.organized_ideas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_organized_ideas_tags ON public.organized_ideas USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_organized_idea_shares_source_idea_id ON public.organized_idea_shares(source_idea_id);
CREATE INDEX IF NOT EXISTS idx_organized_idea_shares_owner_user_id ON public.organized_idea_shares(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_organized_idea_share_invites_share_id ON public.organized_idea_share_invites(share_id);
CREATE INDEX IF NOT EXISTS idx_organized_idea_share_invites_invited_email ON public.organized_idea_share_invites(LOWER(invited_email));
CREATE INDEX IF NOT EXISTS idx_organized_idea_share_members_share_id ON public.organized_idea_share_members(share_id);
CREATE INDEX IF NOT EXISTS idx_organized_idea_share_members_user_id ON public.organized_idea_share_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organized_idea_share_invites_pending_per_email
  ON public.organized_idea_share_invites(share_id, LOWER(invited_email))
  WHERE status = 'pending';

-- Row Level Security (RLS)
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organized_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organized_idea_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organized_idea_share_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organized_idea_share_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (
    user_id,
    daily_limit,
    role,
    notes_used_today,
    usage_date
  )
  VALUES (
    NEW.id,
    10,
    'user',
    0,
    timezone('utc', now())::date
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_user_list()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  daily_limit INTEGER,
  role TEXT,
  created_at TIMESTAMPTZ,
  notes_today BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    up.user_id,
    u.email::TEXT,
    up.daily_limit,
    up.role,
    up.created_at,
    CASE
      WHEN up.usage_date = timezone('utc', now())::date
        THEN COALESCE(up.notes_used_today, 0)::BIGINT
      ELSE 0::BIGINT
    END AS notes_today
  FROM public.user_profiles AS up
  JOIN auth.users AS u
    ON u.id = up.user_id
  ORDER BY up.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_user_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_user_list() TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_user_profile()
RETURNS public.user_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_today DATE := timezone('utc', now())::date;
  v_profile public.user_profiles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;

  INSERT INTO public.user_profiles (
    user_id,
    daily_limit,
    role,
    notes_used_today,
    usage_date
  )
  VALUES (
    v_user_id,
    10,
    'user',
    0,
    v_today
  )
  ON CONFLICT (user_id) DO NOTHING;

  SELECT *
  INTO v_profile
  FROM public.user_profiles
  WHERE user_id = v_user_id;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_user_folders_with_counts()
RETURNS TABLE (
  id UUID,
  user_id UUID,
  name TEXT,
  created_at TIMESTAMPTZ,
  note_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.id,
    f.user_id,
    f.name,
    f.created_at,
    COALESCE(COUNT(n.id), 0)::BIGINT AS note_count
  FROM public.folders AS f
  LEFT JOIN public.notes AS n
    ON n.folder_id = f.id
   AND n.user_id = auth.uid()
  WHERE f.user_id = auth.uid()
  GROUP BY f.id, f.user_id, f.name, f.created_at
  ORDER BY f.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_user_folders_with_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_user_folders_with_counts() TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'on_auth_user_created'
      AND tgrelid = 'auth.users'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_idea_share_owner(target_share_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organized_idea_shares
    WHERE id = target_share_id
      AND owner_user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_idea_share_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_idea_share_owner(UUID) TO authenticated;

-- Policies: cada usuario so ve/edita seus proprios dados
CREATE POLICY "Users can view own notes"
  ON public.notes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notes"
  ON public.notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notes"
  ON public.notes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notes"
  ON public.notes FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own folders" ON public.folders;
CREATE POLICY "Users manage own folders"
  ON public.folders
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.user_profiles;

CREATE POLICY "Users can view own profile"
  ON public.user_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all profiles"
  ON public.user_profiles
  FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can update all profiles"
  ON public.user_profiles
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can view own organized ideas" ON public.organized_ideas;
DROP POLICY IF EXISTS "Users can view owned or shared organized ideas" ON public.organized_ideas;
CREATE POLICY "Users can view own organized ideas"
  ON public.organized_ideas FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own organized ideas"
  ON public.organized_ideas FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own organized ideas"
  ON public.organized_ideas FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own organized ideas"
  ON public.organized_ideas FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owners can view own idea shares" ON public.organized_idea_shares;
DROP POLICY IF EXISTS "Owners can create own idea shares" ON public.organized_idea_shares;
DROP POLICY IF EXISTS "Owners can update own idea shares" ON public.organized_idea_shares;
DROP POLICY IF EXISTS "Owners can delete own idea shares" ON public.organized_idea_shares;
CREATE POLICY "Owners can view own idea shares"
  ON public.organized_idea_shares FOR SELECT
  USING (auth.uid() = owner_user_id);
CREATE POLICY "Owners can create own idea shares"
  ON public.organized_idea_shares FOR INSERT
  WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owners can update own idea shares"
  ON public.organized_idea_shares FOR UPDATE
  USING (auth.uid() = owner_user_id);
CREATE POLICY "Owners can delete own idea shares"
  ON public.organized_idea_shares FOR DELETE
  USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Owners can manage share invites" ON public.organized_idea_share_invites;
CREATE POLICY "Owners can manage share invites"
  ON public.organized_idea_share_invites
  FOR ALL
  USING (public.is_idea_share_owner(share_id))
  WITH CHECK (public.is_idea_share_owner(share_id));

DROP POLICY IF EXISTS "Owners and recipients can view share members" ON public.organized_idea_share_members;
CREATE POLICY "Owners and recipients can view share members"
  ON public.organized_idea_share_members
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.is_idea_share_owner(share_id)
  );

-- =============================================
-- Pipeline de captura segura / drafts / bridge
-- =============================================

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
