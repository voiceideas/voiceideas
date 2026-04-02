import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_INTEGRATION_PREFERENCES,
  EXTERNAL_INTEGRATION_DEFINITIONS,
  INTEGRATION_PREFERENCES_STORAGE_KEY,
  normalizeIntegrationPreferences,
} from '../../lib/integrations'
import { IntegrationSettingsContext, type IntegrationSettingsContextValue } from '../../context/integrationSettingsContext'
import type { ExternalIntegrationId, IntegrationPreferences } from '../../types/integrations'

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
  const [preferences, setPreferences] = useState<IntegrationPreferences>(readPersistedPreferences)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(INTEGRATION_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  }, [preferences])

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
        setPreferences((current) => ({
          ...current,
          externalIntegrationsEnabled: enabled,
        }))
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
      },
      resetIntegrationPreferences: () => {
        setPreferences(DEFAULT_INTEGRATION_PREFERENCES)
      },
    }
  }, [preferences])

  return (
    <IntegrationSettingsContext.Provider value={value}>
      {children}
    </IntegrationSettingsContext.Provider>
  )
}
