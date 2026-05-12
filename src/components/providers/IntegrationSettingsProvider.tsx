/**
 * IntegrationSettingsProvider — fonte única de verdade para preferências
 * de integrações externas (Bardo, futuros destinos).
 *
 * VI_BRIDGE.UX_STATE_AND_PREFS.1 (2026-05-12):
 *   Antes esse provider lia/escrevia 100% em localStorage
 *   (`voiceideas.integration-preferences.v1`). Limpeza de storage
 *   desligava integrações silenciosamente, mesmo com vínculo ativo
 *   server-side em `bardo_account_links`.
 *
 *   Agora a SOURCE OF TRUTH é `user_settings` no Supabase:
 *     - external_integrations_enabled (flag mestre)
 *     - bardo_bridge_enabled (toggle do destino Bardo)
 *
 *   localStorage continua sendo gravado, mas funciona apenas como CACHE
 *   transitório enquanto o servidor não respondeu (boot / SSR / offline).
 *   Após login + fetch do user_settings, os valores do server SOBRESCREVEM
 *   o cache local.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_INTEGRATION_PREFERENCES,
  EXTERNAL_INTEGRATION_DEFINITIONS,
  INTEGRATION_PREFERENCES_STORAGE_KEY,
  normalizeIntegrationPreferences,
} from '../../lib/integrations'
import { IntegrationSettingsContext, type IntegrationSettingsContextValue } from '../../context/integrationSettingsContext'
import type { ExternalIntegrationId, IntegrationPreferences } from '../../types/integrations'
import { useUserSettings } from '../../hooks/useUserSettings'
import { useAuth } from '../../hooks/useAuth'

function readPersistedPreferences() {
  if (typeof window === 'undefined') {
    return DEFAULT_INTEGRATION_PREFERENCES
  }

  try {
    const raw = window.localStorage.getItem(INTEGRATION_PREFERENCES_STORAGE_KEY)
    if (!raw) {
      return DEFAULT_INTEGRATION_PREFERENCES
    }

    return normalizeIntegrationPreferences(JSON.parse(raw))
  } catch {
    return DEFAULT_INTEGRATION_PREFERENCES
  }
}

export function IntegrationSettingsProvider({ children }: { children: ReactNode }) {
  // Cache local como bootstrap.
  const [preferences, setPreferences] = useState<IntegrationPreferences>(readPersistedPreferences)
  const { user } = useAuth()
  const {
    settings: userSettings,
    loading: userSettingsLoading,
    externalIntegrationsEnabled: serverExternalEnabled,
    bardoBridgeEnabled: serverBardoEnabled,
    setExternalIntegrationsEnabled: persistExternalEnabled,
    setBardoBridgeEnabled: persistBardoEnabled,
  } = useUserSettings()

  // Sempre que o server responde, alinhamos o estado local + cache localStorage.
  useEffect(() => {
    if (!user || userSettingsLoading || !userSettings) return
    setPreferences({
      externalIntegrationsEnabled: serverExternalEnabled,
      integrations: {
        bardo: { enabled: serverBardoEnabled },
      },
    })
  }, [user, userSettingsLoading, userSettings, serverExternalEnabled, serverBardoEnabled])

  // Cache só pra acelerar próximo boot — não é mais fonte de verdade.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(INTEGRATION_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  }, [preferences])

  // Cross-tab sync via storage event continua útil enquanto não houver
  // realtime do Supabase neste provider.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== INTEGRATION_PREFERENCES_STORAGE_KEY) {
        return
      }

      try {
        setPreferences(normalizeIntegrationPreferences(event.newValue ? JSON.parse(event.newValue) : null))
      } catch {
        setPreferences(DEFAULT_INTEGRATION_PREFERENCES)
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const value = useMemo<IntegrationSettingsContextValue>(() => {
    const isIntegrationEnabled = (integrationId: ExternalIntegrationId) =>
      preferences.integrations[integrationId].enabled

    const isIntegrationActive = (integrationId: ExternalIntegrationId) =>
      preferences.externalIntegrationsEnabled && isIntegrationEnabled(integrationId)

    const hasActiveExternalIntegrations = EXTERNAL_INTEGRATION_DEFINITIONS.some((integration) =>
      isIntegrationActive(integration.id),
    )

    return {
      preferences,
      definitions: EXTERNAL_INTEGRATION_DEFINITIONS,
      areExternalIntegrationsEnabled: preferences.externalIntegrationsEnabled,
      hasActiveExternalIntegrations,
      isIntegrationEnabled,
      isIntegrationActive,
      setExternalIntegrationsEnabled: (enabled: boolean) => {
        // Atualização otimista do local + persistência server-side.
        // Se a chamada server falhar, o próximo refetch reconciliará.
        setPreferences((current) => ({
          ...current,
          externalIntegrationsEnabled: enabled,
        }))
        if (user) {
          void persistExternalEnabled(enabled)
        }
      },
      setIntegrationEnabled: (integrationId: ExternalIntegrationId, enabled: boolean) => {
        setPreferences((current) => ({
          ...current,
          integrations: {
            ...current.integrations,
            [integrationId]: {
              enabled,
            },
          },
        }))
        if (user && integrationId === 'bardo') {
          void persistBardoEnabled(enabled)
        }
      },
      resetIntegrationPreferences: () => {
        setPreferences(DEFAULT_INTEGRATION_PREFERENCES)
        if (user) {
          void persistExternalEnabled(DEFAULT_INTEGRATION_PREFERENCES.externalIntegrationsEnabled)
          void persistBardoEnabled(DEFAULT_INTEGRATION_PREFERENCES.integrations.bardo.enabled)
        }
      },
    }
  }, [preferences, user, persistExternalEnabled, persistBardoEnabled])

  return (
    <IntegrationSettingsContext.Provider value={value}>
      {children}
    </IntegrationSettingsContext.Provider>
  )
}
