-- Cria uma funcao transacional para registrar nota + consumir cota de uso
-- e endurece funcoes legadas com search_path fixo.

CREATE OR REPLACE FUNCTION public.create_note_with_limit(
  p_raw_text TEXT,
  p_title TEXT DEFAULT NULL
)
RETURNS public.notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_today DATE := timezone('utc', now())::date;
  v_profile public.user_profiles%ROWTYPE;
  v_effective_used INTEGER := 0;
  v_effective_title TEXT;
  v_note public.notes%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_raw_text, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A nota precisa ter texto antes de ser salva.';
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
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil do usuario nao foi encontrado.';
  END IF;

  v_effective_used := CASE
    WHEN v_profile.usage_date = v_today THEN COALESCE(v_profile.notes_used_today, 0)
    ELSE 0
  END;

  IF v_effective_used >= COALESCE(v_profile.daily_limit, 10) THEN
    RAISE EXCEPTION 'Limite diario atingido (% notas). Tente novamente amanha.', COALESCE(v_profile.daily_limit, 10);
  END IF;

  v_effective_title := NULLIF(BTRIM(COALESCE(p_title, '')), '');

  IF v_effective_title IS NULL THEN
    v_effective_title := CASE
      WHEN char_length(p_raw_text) > 60 THEN left(p_raw_text, 60) || '...'
      ELSE p_raw_text
    END;
  END IF;

  INSERT INTO public.notes (
    user_id,
    raw_text,
    title
  )
  VALUES (
    v_user_id,
    p_raw_text,
    v_effective_title
  )
  RETURNING *
  INTO v_note;

  UPDATE public.user_profiles
  SET
    notes_used_today = v_effective_used + 1,
    usage_date = v_today
  WHERE id = v_profile.id;

  RETURN v_note;
END;
$$;

REVOKE ALL ON FUNCTION public.create_note_with_limit(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_note_with_limit(TEXT, TEXT) TO authenticated;

DO $$
DECLARE
  target_function RECORD;
BEGIN
  FOR target_function IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS function_args
    FROM pg_proc AS p
    JOIN pg_namespace AS n
      ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('handle_new_user', 'get_admin_user_list', 'is_admin')
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public',
      target_function.schema_name,
      target_function.function_name,
      target_function.function_args
    );
  END LOOP;
END;
$$;
