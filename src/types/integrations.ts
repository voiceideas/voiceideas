export type ExternalIntegrationId = 'bardo'

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
}
