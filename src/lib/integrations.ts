import type { BridgeExportDestination } from '../types/bridge'
import type {
  ExternalIntegrationDefinition,
  ExternalIntegrationId,
  IntegrationPreferences,
} from '../types/integrations'

export const INTEGRATION_PREFERENCES_STORAGE_KEY = 'voiceideas.integration-preferences.v1'

export const EXTERNAL_INTEGRATION_DEFINITIONS: readonly ExternalIntegrationDefinition[] = [
  {
    id: 'bardo',
    label: 'Bardo',
    description: 'Mostra uma opcao opcional de enviar notas salvas para um destino externo.',
  },
]

export const DEFAULT_INTEGRATION_PREFERENCES: IntegrationPreferences = {
  externalIntegrationsEnabled: false,
  integrations: {
    bardo: {
      enabled: false,
    },
  },
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeIntegrationPreferences(input: unknown): IntegrationPreferences {
  if (!isPlainObject(input)) {
    return DEFAULT_INTEGRATION_PREFERENCES
  }

  const integrationsRecord = isPlainObject(input.integrations) ? input.integrations : {}

  return {
    externalIntegrationsEnabled: input.externalIntegrationsEnabled === true,
    integrations: {
      bardo: {
        enabled: isPlainObject(integrationsRecord.bardo) && integrationsRecord.bardo.enabled === true,
      },
    },
  }
}

export function getBridgeDestinationLabel(destination: BridgeExportDestination) {
  return destination === 'bardo' ? 'Bardo' : 'Cenax'
}

export function getDestinationIntegrationId(destination: BridgeExportDestination): ExternalIntegrationId | null {
  if (destination === 'bardo') {
    return 'bardo'
  }

  return null
}

export function isDestinationIntegrationVisible(
  destination: BridgeExportDestination,
  preferences: IntegrationPreferences,
) {
  const integrationId = getDestinationIntegrationId(destination)

  if (!integrationId) {
    return false
  }

  return preferences.externalIntegrationsEnabled && preferences.integrations[integrationId].enabled
}
