-- VI_BRIDGE.UX_STATE_AND_PREFS.1 — preferência server-side de integrações externas.
--
-- Antes:
--   * `user_settings.bardo_bridge_enabled` (server-side) controlava se o
--     toggle da Bardo aparecia em listas/contexts antigos.
--   * `IntegrationPreferences.externalIntegrationsEnabled` vivia APENAS em
--     localStorage (`voiceideas.integration-preferences.v1`) — limpar storage
--     desligava integrações silenciosamente.
--   * Dois sistemas em paralelo (server-side `bardo_bridge_enabled` vs
--     client-side `externalIntegrationsEnabled` + `integrations.bardo.enabled`)
--     não conversavam. Dependendo do caminho de UI, a flag certa não era
--     consultada.
--
-- Esta migration introduz o campo server-side que faltava:
--   `user_settings.external_integrations_enabled` (bool, NOT NULL, default false)
--
-- A semântica "ativa" para mostrar bridge no VI passa a ser:
--   external_integrations_enabled AND bardo_bridge_enabled
-- onde ambos vivem no servidor. localStorage continua válido apenas como
-- cache transitório/bootstrap pré-login.
--
-- Idempotente.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_settings'
      AND column_name = 'external_integrations_enabled'
  ) THEN
    ALTER TABLE public.user_settings
      ADD COLUMN external_integrations_enabled boolean NOT NULL DEFAULT false;
  END IF;
END
$$;

COMMENT ON COLUMN public.user_settings.external_integrations_enabled IS
  'VI_BRIDGE.UX_STATE_AND_PREFS.1 — flag mestre server-side. Desligado, '
  'nenhuma integração externa aparece, mesmo que bardo_bridge_enabled=true. '
  'Equivale ao toggle "Enable external integrations" em Settings.';
