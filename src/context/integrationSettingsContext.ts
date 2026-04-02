import { createContext } from 'react'
import { EXTERNAL_INTEGRATION_DEFINITIONS } from '../lib/integrations'
import type { ExternalIntegrationId, IntegrationPreferences } from '../types/integrations'

export interface IntegrationSettingsContextValue {
  preferences: IntegrationPreferences
  definitions: typeof EXTERNAL_INTEGRATION_DEFINITIONS
  areExternalIntegrationsEnabled: boolean
  hasActiveExternalIntegrations: boolean
  isIntegrationEnabled: (integrationId: ExternalIntegrationId) => boolean
  isIntegrationActive: (integrationId: ExternalIntegrationId) => boolean
  setExternalIntegrationsEnabled: (enabled: boolean) => void
  setIntegrationEnabled: (integrationId: ExternalIntegrationId, enabled: boolean) => void
  resetIntegrationPreferences: () => void
}

export const IntegrationSettingsContext = createContext<IntegrationSettingsContextValue | null>(null)
