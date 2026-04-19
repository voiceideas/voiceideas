-- P1.5 — Suporte ao probe de identidade (bridge-identity-check)
--
-- O Bardo precisa verificar se um email possui conta no VoiceIdeas e se essa
-- conta tem o email confirmado, ANTES de iniciar qualquer fluxo de vínculo
-- assistido. Esse probe é app-to-app (x-bridge-secret), não carrega JWT de
-- usuário, portanto o endpoint precisa consultar auth.users — schema que o
-- PostgREST não expõe diretamente.
--
-- Esta função encapsula a leitura mínima necessária:
--   match    — existe usuário com esse email (case-insensitive).
--   verified — match AND email_confirmed_at IS NOT NULL.
--
-- SECURITY DEFINER porque o role de invocação (service_role vindo da EF) não
-- precisa ter SELECT em auth.users para chamar esta função específica; a
-- função vive em public e NÃO retorna id, nem email, nem qualquer dado além
-- dos dois booleans.

CREATE OR REPLACE FUNCTION public.bridge_identity_probe_by_email(p_email text)
RETURNS TABLE (match boolean, verified boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized text;
  found_confirmed_at timestamptz;
  found boolean;
BEGIN
  IF p_email IS NULL THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  normalized := lower(trim(p_email));

  IF normalized = '' THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  SELECT u.email_confirmed_at, true
    INTO found_confirmed_at, found
  FROM auth.users u
  WHERE lower(u.email) = normalized
  LIMIT 1;

  IF NOT COALESCE(found, false) THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, (found_confirmed_at IS NOT NULL);
END;
$$;

-- Apenas service_role pode invocar — é o role que a edge function usa com
-- self-managed auth. Nem authenticated nem anon devem enumerar contas.
REVOKE ALL ON FUNCTION public.bridge_identity_probe_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bridge_identity_probe_by_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.bridge_identity_probe_by_email(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_identity_probe_by_email(text) TO service_role;

COMMENT ON FUNCTION public.bridge_identity_probe_by_email(text) IS
  'P1.5 — Probe de identidade VI ↔ Bardo. Retorna (match, verified) para um email. '
  'Usado EXCLUSIVAMENTE pela edge function bridge-identity-check sob x-bridge-secret. '
  'Não vaza id, email nem timestamps; somente dois booleans.';
