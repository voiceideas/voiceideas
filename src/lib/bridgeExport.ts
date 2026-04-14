/**
 * Bridge export service — monta o payload V1 e persiste na tabela bridge_exports.
 *
 * Responsabilidades:
 *   1. Construir BridgeExportV1Wire a partir de notas + metadados do usuário
 *   2. Calcular SHA-256 do payload (Web Crypto API)
 *   3. Normalizar owner_email: trim().toLowerCase()
 *   4. Inserir na tabela bridge_exports com idempotência via content_hash
 *
 * @see types/bridge.ts — tipos provisórios do contrato V1
 */

import { supabase } from './supabase'
import type { Note } from '../types/database'
import type {
  BridgeExportV1Wire,
  BridgeItemV1Wire,
  Nature,
  Maturity,
  SuggestedDestination,
  Domain,
  ScopeType,
  StructuredData,
  AnalysisHints,
} from '../types/bridge'
import {
  BRIDGE_MAGIC,
  BRIDGE_VERSION,
  BRIDGE_SOURCE_APP,
  BRIDGE_TARGET_APP,
} from '../types/bridge'

// ───────────────────────────────────────────────────────────────
// Configuração do item (preenchida pelo modal SendToBardo)
// ───────────────────────────────────────────────────────────────

export interface BridgeItemConfig {
  note: Note
  nature: Nature
  maturity: Maturity
  suggestedDestination: SuggestedDestination
  domain: Domain
  scopeType: ScopeType
  title: string
  summary: string
  tags: string[]
  structuredData: StructuredData
}

// ───────────────────────────────────────────────────────────────
// SHA-256 via Web Crypto API
// ───────────────────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ───────────────────────────────────────────────────────────────
// Defaults para campos que o VoiceIdeas não preenche nativamente
// ───────────────────────────────────────────────────────────────

const DEFAULT_ANALYSIS_HINTS: AnalysisHints = {
  vas_relevant: false,
  visual_seed: false,
  high_reuse_asset: false,
  controversial: false,
}

// ───────────────────────────────────────────────────────────────
// Builders
// ───────────────────────────────────────────────────────────────

function buildBridgeItem(config: BridgeItemConfig): BridgeItemV1Wire {
  return {
    source_note_id: config.note.id,
    source_lineage_ids: [config.note.id], // V1: 1 nota = 1 linhagem
    content_hash: '', // preenchido depois pelo envelope builder
    origin: {
      capture_id: config.note.id,
      note_ids: [config.note.id],
      organized_idea_id: null,
    },
    domain: config.domain,
    scope_type: config.scopeType,
    nature: config.nature,
    additional_natures: [],
    maturity: config.maturity,
    suggested_destination: config.suggestedDestination,
    vault_intent: null,
    validation_status: 'valid',
    confidence: 0.8, // confiança padrão — classificação manual do usuário
    title: config.title,
    summary: config.summary,
    raw_text: config.note.raw_text,
    tags: config.tags,
    analysis_hints: DEFAULT_ANALYSIS_HINTS,
    structured_data: config.structuredData,
  }
}

/**
 * Monta o envelope completo e calcula content_hash para cada item.
 */
async function buildEnvelope(
  items: BridgeItemConfig[],
): Promise<BridgeExportV1Wire> {
  const exportId = crypto.randomUUID()

  const wireItems: BridgeItemV1Wire[] = []
  for (const config of items) {
    const item = buildBridgeItem(config)
    // Content hash = SHA-256 do raw_text normalizado (trim+lower)
    item.content_hash = await sha256(config.note.raw_text.trim().toLowerCase())
    wireItems.push(item)
  }

  return {
    bridge_version: BRIDGE_VERSION,
    magic: BRIDGE_MAGIC,
    source_app: BRIDGE_SOURCE_APP,
    target_app: BRIDGE_TARGET_APP,
    export_id: exportId,
    exported_at: new Date().toISOString(),
    classifier: {
      engine: 'voiceideas-manual',
      version: '1.0.0',
      ai_model: null,
    },
    project_hint: null,
    items: wireItems,
  }
}

// ───────────────────────────────────────────────────────────────
// Resultado da exportação
// ───────────────────────────────────────────────────────────────

export interface BridgeExportResult {
  success: boolean
  exportId?: string
  error?: string
  /** true se falhou por duplicata (mesmo conteúdo já exportado) */
  duplicate?: boolean
}

// ───────────────────────────────────────────────────────────────
// Exportação principal
// ───────────────────────────────────────────────────────────────

/**
 * Monta o payload Bridge V1, calcula SHA-256 e persiste em bridge_exports.
 *
 * @param items Configurações de cada nota a exportar
 * @returns Resultado com exportId em caso de sucesso
 */
export async function sendToBardo(
  items: BridgeItemConfig[],
): Promise<BridgeExportResult> {
  // 1. Verificar auth
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user || !user.email) {
    return { success: false, error: 'Você precisa estar logado para enviar ao Bardo.' }
  }

  // 2. Normalizar email (regra obrigatória do reviewer)
  const ownerEmail = user.email.trim().toLowerCase()

  // 3. Montar envelope
  const envelope = await buildEnvelope(items)

  // 4. SHA-256 do payload serializado (para idempotência na tabela)
  const payloadJson = JSON.stringify(envelope)
  const contentHash = await sha256(payloadJson)

  // 5. Inserir na tabela bridge_exports
  const { error: insertError } = await supabase
    .from('bridge_exports')
    .insert({
      owner_user_id: user.id,
      owner_email: ownerEmail,
      payload: envelope,
      content_hash: contentHash,
      status: 'pending',
    })

  if (insertError) {
    // Constraint violation = duplicata
    if (insertError.code === '23505') {
      return {
        success: false,
        error: 'Este conteúdo já foi enviado ao Bardo.',
        duplicate: true,
      }
    }
    return { success: false, error: insertError.message }
  }

  return { success: true, exportId: envelope.export_id }
}

// ───────────────────────────────────────────────────────────────
// Histórico de exportações do usuário
// ───────────────────────────────────────────────────────────────

export async function fetchMyBridgeExports() {
  const { data, error } = await supabase
    .from('bridge_exports')
    .select('id, owner_email, content_hash, status, created_at, fetched_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(error.message)
  return data
}

// ───────────────────────────────────────────────────────────────
// Helpers para o modal — structured data defaults por nature
// ───────────────────────────────────────────────────────────────

export function defaultStructuredData(nature: Nature, text: string): StructuredData {
  switch (nature) {
    case 'character':
      return { nature: 'character', name: null, description: text, role_hint: null, status: null }
    case 'scene':
      return { nature: 'scene', setting: null, action: text, intent: null, scene_context: null }
    case 'world_trait':
      return { nature: 'world_trait', description: text, scope: null, impact: null }
    case 'culture_trait':
      return { nature: 'culture_trait', description: text, scope: null, impact: null }
    case 'fact':
      return { nature: 'fact', text, claim_status: null, sources_mentioned: [] }
    case 'claim':
      return { nature: 'claim', text, claim_status: null, sources_mentioned: [] }
    case 'source':
      return { nature: 'source', source_type: 'unknown', description: text, provenance: null }
    case 'episode_idea':
      return { nature: 'episode_idea', premise: text, value_proposition: null, relates_to: null }
    case 'theme':
      return { nature: 'theme', text, exploration: null }
    case 'question':
      return { nature: 'question', text, exploration: null }
    case 'unknown':
    default:
      return { nature: 'unknown', free_text: text }
  }
}
