import { BARDO_SUPPORTED_ARTIFACT_TYPES } from './bardoBridge'
import type { TranslationKey } from './i18n'
import type { BridgeExportDestination } from '../types/bridge'
import type {
  ExternalIntegrationDefinition,
  ExternalIntegrationArtifactType,
  ExternalIntegrationId,
  IntegrationPreferences,
} from '../types/integrations'

export const INTEGRATION_PREFERENCES_STORAGE_KEY = 'voiceideas.integration-preferences.v1'

export const EXTERNAL_INTEGRATION_DEFINITIONS: readonly ExternalIntegrationDefinition[] = [
  {
    id: 'bardo',
    label: 'Bardo',
    description: 'Mostra uma opcao opcional de preparar notas e resultados organizados para um destino externo.',
    supportedArtifactTypes: BARDO_SUPPORTED_ARTIFACT_TYPES,
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

export function getIntegrationArtifactLabelKey(artifactType: ExternalIntegrationArtifactType): TranslationKey {
  switch (artifactType) {
    case 'raw-note':
      return 'integrations.artifact.rawNote'
    case 'organized-idea':
      return 'integrations.artifact.organizedIdea'
    case 'consolidated-idea':
      return 'integrations.artifact.consolidatedIdea'
  }
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
