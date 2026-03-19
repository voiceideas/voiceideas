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
    COALESCE(nc.cnt, 0) AS notes_today
  FROM public.user_profiles AS up
  JOIN auth.users AS u
    ON u.id = up.user_id
  LEFT JOIN (
    SELECT
      n.user_id,
      COUNT(*)::BIGINT AS cnt
    FROM public.notes AS n
    WHERE n.created_at >= CURRENT_DATE::TIMESTAMPTZ
    GROUP BY n.user_id
  ) AS nc
    ON nc.user_id = up.user_id
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
