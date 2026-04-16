import type { CapturePlatformSource } from './capture'
import type { BardoBridgePayload } from './bardo'

// ───────────────────────────────────────────────────────────────
// Legacy / generic bridge types (upstream)
// ───────────────────────────────────────────────────────────────

export type BridgeExportDestination = 'cenax' | 'bardo'
export type BridgeExportStatus = 'pending' | 'exporting' | 'exported' | 'failed'
export type BridgeExportContentType = 'idea_draft' | 'note' | 'organized_idea'
export type BridgeExportValidationStatus = 'valid' | 'blocked'
export type BridgeExportScopeType = 'project'

export interface IdeaBridgePayload {
  source: 'voiceideas'
  sourceSessionId: string
  sourceChunkId: string
  platformSource: CapturePlatformSource
  title: string
  text: string
  rawText: string
  tags: string[]
  folder: string | null
  audioUrl: string | null
  confidence: number | null
  createdAt: string
  destination: BridgeExportDestination
}

export interface PersistedIdeaBridgePayload {
  source: 'voiceideas'
  source_session_id: string
  source_chunk_id: string
  platform_source: CapturePlatformSource
  title: string
  text: string
  raw_text: string
  tags: string[]
  folder: string | null
  audio_url: string | null
  confidence: number | null
  created_at: string
  destination: BridgeExportDestination
}

export interface BridgeExportValidationIssue {
  code: string
  message: string
}

export type BridgeExportDeliveryPayload = IdeaBridgePayload | BardoBridgePayload | Record<string, unknown>

export interface BridgeExportPayload {
  bridgeVersion: 'voiceideas.bridge-export.v1'
  domain: 'voiceideas'
  destination: BridgeExportDestination
  contentType: BridgeExportContentType
  contentId: string
  scopeType: BridgeExportScopeType
  sourceSessionMode: 'safe_capture' | null
  sourceSessionIds: string[]
  validationStatus: BridgeExportValidationStatus
  validationIssues: BridgeExportValidationIssue[]
  deliveryPayload: BridgeExportDeliveryPayload | null
}

export interface BridgeExport {
  id: string
  contentType: BridgeExportContentType
  ideaDraftId: string | null
  noteId: string | null
  organizedIdeaId: string | null
  destination: BridgeExportDestination
  payload: BridgeExportPayload
  status: BridgeExportStatus
  validationStatus: BridgeExportValidationStatus
  validationIssues: BridgeExportValidationIssue[]
  error: string | null
  exportedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateBridgeExportInput {
  contentType: BridgeExportContentType
  ideaDraftId?: string | null
  noteId?: string | null
  organizedIdeaId?: string | null
  destination: BridgeExportDestination
  payload: BridgeExportPayload
  status?: BridgeExportStatus
  validationStatus?: BridgeExportValidationStatus
  validationIssues?: BridgeExportValidationIssue[]
  error?: string | null
  exportedAt?: string | null
}

export interface UpdateBridgeExportInput {
  payload?: BridgeExportPayload
  status?: BridgeExportStatus
  validationStatus?: BridgeExportValidationStatus
  validationIssues?: BridgeExportValidationIssue[]
  error?: string | null
  exportedAt?: string | null
}

export interface BridgeExportFilters {
  ideaDraftId?: string
  noteId?: string
  organizedIdeaId?: string
  contentType?: BridgeExportContentType
  destination?: BridgeExportDestination
  status?: BridgeExportStatus
  limit?: number
}
// ───────────────────────────────────────────────────────────────
// Bridge V1 contract types — producer side (VoiceIdeas -> Bardo)
// ───────────────────────────────────────────────────────────────

/**
 * Tipos provisorios do contrato Bridge V1 — lado produtor (VoiceIdeas).
 *
 * ATENCAO: Copia parcial do contrato canonico em cenax/src/types/bridge.ts.
 * Estes tipos devem ser cross-validados contra `parseBridgeExportV1` do Bardo
 * apos qualquer alteracao. A fonte de verdade e o Bardo.
 *
 * Inclui apenas o subconjunto necessario para montar o payload de exportacao.
 * Tipos editoriais do Bardo (NoteStatus, DecisionReason, VaultBridgeMetadata,
 * PromotionRecord, AuditEvent) NAO estao aqui — nao pertencem ao produtor.
 *
 * @see cenax/src/types/bridge.ts — contrato canonico
 * @see cenax/src/schemas/bridgeV1.ts — parser/validator autoritativo
 */

// Enums / unioes fundamentais

export type Nature =
  | 'character'
  | 'scene'
  | 'world_trait'
  | 'culture_trait'
  | 'fact'
  | 'claim'
  | 'source'
  | 'episode_idea'
  | 'theme'
  | 'question'
  | 'unknown'

export type Maturity =
  | 'raw'
  | 'skeletal'
  | 'developing'
  | 'structured'
  | 'validated'

export type Domain = 'fiction' | 'documentary' | 'hybrid'

export type ScopeType = 'project' | 'season' | 'episode' | 'unknown'

export type SuggestedDestination =
  | 'vault'
  | 'characters'
  | 'participants'
  | 'scenes'
  | 'lore'
  | 'documentary_claims'
  | 'documentary_sources'
  | 'episode_workspace'
  | 'season_planning'

export type ValidationStatus = 'valid' | 'needs_review' | 'blocked'

export type VaultIntent =
  | 'waiting_maturity'
  | 'waiting_structure'
  | 'waiting_validation'
  | 'user_parked'
  | 'ambiguous_nature'

// Structured data — discriminated union por nature

export type StructuredData =
  | { nature: 'character'; name: string | null; description: string; role_hint: string | null; status: string | null }
  | { nature: 'scene'; setting: string | null; action: string; intent: string | null; scene_context: string | null }
  | { nature: 'world_trait'; description: string; scope: string | null; impact: string | null }
  | { nature: 'culture_trait'; description: string; scope: string | null; impact: string | null }
  | { nature: 'fact'; text: string; claim_status: string | null; sources_mentioned: string[] }
  | { nature: 'claim'; text: string; claim_status: string | null; sources_mentioned: string[] }
  | { nature: 'source'; source_type: string; description: string; provenance: string | null }
  | { nature: 'episode_idea'; premise: string; value_proposition: string | null; relates_to: string | null }
  | { nature: 'theme'; text: string; exploration: string | null }
  | { nature: 'question'; text: string; exploration: string | null }
  | { nature: 'unknown'; free_text: string }

// Sub-objetos compartilhados

export interface AnalysisHints {
  vas_relevant: boolean
  visual_seed: boolean
  high_reuse_asset: boolean
  controversial: boolean
}

export interface BridgeOrigin {
  capture_id: string
  note_ids: string[]
  organized_idea_id: string | null
}

export interface ClassifierInfo {
  engine: string
  version: string
  ai_model: string | null
}

// PAYLOAD — shape do JSON enviado para o Bardo (snake_case wire format)

/**
 * Item individual no envelope Bridge V1.
 * Wire format: snake_case — o parser do Bardo converte para camelCase.
 */
export interface BridgeItemV1Wire {
  source_note_id: string
  source_lineage_ids: string[]
  content_hash: string
  origin: BridgeOrigin
  domain: Domain
  scope_type: ScopeType
  nature: Nature
  additional_natures: Nature[]
  maturity: Maturity
  suggested_destination: SuggestedDestination
  vault_intent: VaultIntent | null
  validation_status: ValidationStatus
  confidence: number
  title: string
  summary: string
  raw_text: string
  tags: string[]
  analysis_hints: AnalysisHints
  structured_data: StructuredData
}

/**
 * Envelope Bridge V1 completo — formato wire (snake_case).
 * E o JSON que vai na coluna `payload` da tabela `bridge_exports`.
 */
export interface BridgeExportV1Wire {
  bridge_version: string
  magic: typeof BRIDGE_MAGIC
  source_app: typeof BRIDGE_SOURCE_APP
  target_app: typeof BRIDGE_TARGET_APP
  export_id: string
  exported_at: string
  classifier: ClassifierInfo
  project_hint: string | null
  items: BridgeItemV1Wire[]
}

// Constantes do contrato

export const BRIDGE_MAGIC = 'BARDO_BRIDGE_V1' as const
export const BRIDGE_VERSION = '1.0.0' as const
export const BRIDGE_SOURCE_APP = 'voiceideas' as const
export const BRIDGE_TARGET_APP = 'bardo' as const

// Tipo da row na tabela bridge_exports (V1)

export type BridgeExportV1Status = 'pending' | 'fetched' | 'expired'

export interface BridgeExportRow {
  id: string
  owner_user_id: string
  owner_email: string
  payload: BridgeExportV1Wire
  content_hash: string
  status: BridgeExportV1Status
  created_at: string
  fetched_at: string | null
}

export interface BridgeExportEligibility {
  contentType: Exclude<BridgeExportContentType, 'idea_draft'>
  contentId: string
  destination: BridgeExportDestination
  eligible: boolean
  sourceSessionMode: 'safe_capture' | null
  sourceSessionIds: string[]
  validationStatus: BridgeExportValidationStatus
  validationIssues: BridgeExportValidationIssue[]
  reason: string | null
}
