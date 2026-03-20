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
