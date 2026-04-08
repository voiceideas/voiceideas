export type ExternalIntegrationId = 'bardo'
export type ExternalIntegrationArtifactType = 'raw-note' | 'organized-idea' | 'consolidated-idea'

export interface ExternalIntegrationPreference {
  enabled: boolean
}

export interface IntegrationPreferences {
  externalIntegrationsEnabled: boolean
  integrations: Record<ExternalIntegrationId, ExternalIntegrationPreference>
}

export interface ExternalIntegrationDefinition {
  id: ExternalIntegrationId
  label: string
  description: string
  supportedArtifactTypes: readonly ExternalIntegrationArtifactType[]
}
