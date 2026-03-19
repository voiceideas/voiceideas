-- Versiona objetos base usados pelo app e adiciona RPCs seguras
-- para perfil de usuario e contagem agregada de pastas.

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_limit INTEGER NOT NULL DEFAULT 10 CHECK (daily_limit > 0),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ DEFAULT now(),
  notes_used_today INTEGER DEFAULT 0,
  usage_date DATE
);

CREATE TABLE IF NOT EXISTS public.folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS folder_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notes_folder_id_fkey'
      AND conrelid = 'public.notes'::regclass
  ) THEN
    ALTER TABLE public.notes
      ADD CONSTRAINT notes_folder_id_fkey
      FOREIGN KEY (folder_id)
      REFERENCES public.folders(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id
  ON public.user_profiles(user_id);

CREATE INDEX IF NOT EXISTS idx_notes_folder_id
  ON public.notes(folder_id);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

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

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_user_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_user_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_user_folders_with_counts() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_user_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile() TO authenticated;
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
