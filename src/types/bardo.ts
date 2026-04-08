import type { AppLocale } from '../lib/i18n'
import type { OrganizationType } from './database'
import type { ExternalIntegrationArtifactType } from './integrations'

export type BardoBridgeArtifactType = ExternalIntegrationArtifactType

export interface BardoBridgeSection {
  title: string
  items: string[]
}

export interface BardoBridgeSourceReference {
  kind: 'note' | 'capture-session' | 'audio-chunk'
  id: string
  title: string | null
}

export interface BardoBridgeArtifactMetadata {
  origin: 'note' | 'organized-idea'
  noteCount: number
  organizationType: OrganizationType | null
}

export interface BardoBridgeArtifact {
  id: string
  type: BardoBridgeArtifactType
  title: string
  summary: string | null
  plainText: string
  tags: string[]
  folders: string[]
  createdAt: string
  sourceNoteIds: string[]
  sections: BardoBridgeSection[]
  sourceReferences: BardoBridgeSourceReference[]
  metadata: BardoBridgeArtifactMetadata
}

export interface BardoBridgePayload {
  schemaVersion: 'voiceideas.bardo-bridge.v1'
  sourceApp: 'voiceideas'
  targetApp: 'bardo'
  locale: AppLocale
  preparedAt: string
  artifact: BardoBridgeArtifact
}

export interface BardoBridgeManifest {
  integrationId: 'bardo'
  schemaVersion: BardoBridgePayload['schemaVersion']
  supportedArtifactTypes: readonly BardoBridgeArtifactType[]
}
