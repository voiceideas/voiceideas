import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import {
  resolveNoteBridgeExport,
  resolveOrganizedIdeaBridgeExport,
  type BridgeExportContentType,
  type BridgeExportEligibility,
  type BridgeExportEnvelope,
  type BridgeExportSourceSessionMode,
  type BridgeExportValidationIssue,
} from './bridge-export.ts'

export type BridgeItemSourceType = 'note' | 'organized_idea'
export type BridgeItemDestinationKind = 'vault' | 'character' | 'lore' | 'world'
export type BridgeItemBridgeStatus = 'draft' | 'eligible' | 'published' | 'consumed' | 'blocked'

interface PersistedBridgeItemRow {
  id: string
  bridge_status: BridgeItemBridgeStatus
  published_at: string | null
  consumed_at: string | null
}

interface MaterializedBridgeItemDraft {
  sourceType: BridgeItemSourceType
  sourceId: string
  sourceCaptureSessionId: string | null
  // VI_BRIDGE.MODES.1: deriva do envelope; aceita 'safe_capture' OU 'manual'.
  sourceSessionMode: BridgeExportSourceSessionMode
  contentType: BridgeItemSourceType
  domain: 'voiceideas'
  scopeType: 'project'
  title: string
  summary: string | null
  content: string
  payload: Record<string, unknown>
  validationStatus: 'valid'
  validationIssues: BridgeExportValidationIssue[]
  bridgeStatus: BridgeItemBridgeStatus
  destinationKind: BridgeItemDestinationKind
  destinationCandidates: BridgeItemDestinationKind[]
  publishedAt: string | null
  consumedAt: string | null
}

interface BridgeItemSyncSummary {
  scanned: number
  materialized: number
  blocked: number
}

export interface BridgeItemSyncResult {
  bridgeItemId: string | null
  eligibility: BridgeExportEligibility
  materialized: boolean
  blocked: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function buildCandidates(primary: BridgeItemDestinationKind) {
  switch (primary) {
    case 'character':
      return ['character', 'vault'] as BridgeItemDestinationKind[]
    case 'lore':
      return ['lore', 'world', 'vault'] as BridgeItemDestinationKind[]
    case 'world':
      return ['world', 'lore', 'vault'] as BridgeItemDestinationKind[]
    case 'vault':
    default:
      return ['vault', 'lore', 'world'] as BridgeItemDestinationKind[]
  }
}

function classifyDestination(input: {
  contentType: BridgeItemSourceType
  title: string
  summary: string | null
  content: string
  organizationType: string | null
}) {
  const haystack = [input.title, input.summary ?? '', input.content]
    .join(' ')
    .toLocaleLowerCase('pt-BR')

  const reasonCodes: string[] = []

  if (input.organizationType === 'mapa') {
    reasonCodes.push('organized_type:mapa')
    return {
      destinationKind: 'world' as BridgeItemDestinationKind,
      destinationCandidates: buildCandidates('world'),
      reasonCodes,
    }
  }

  if (/(^|\W)(personagem|personagens|protagonista|antagonista|hero[ió]na?|vil[aã]o|character|characters)(\W|$)/i.test(haystack)) {
    reasonCodes.push('keyword:character')
    return {
      destinationKind: 'character' as BridgeItemDestinationKind,
      destinationCandidates: buildCandidates('character'),
      reasonCodes,
    }
  }

  if (/(^|\W)(lore|mitologia|mito|cultura|cultural|tradi[cç][aã]o|religi[aã]o|fac[cç][aã]o|hist[oó]ria do mundo|historia do mundo|backstory)(\W|$)/i.test(haystack)) {
    reasonCodes.push('keyword:lore')
    return {
      destinationKind: 'lore' as BridgeItemDestinationKind,
      destinationCandidates: buildCandidates('lore'),
      reasonCodes,
    }
  }

  if (/(^|\W)(mundo|world|universo|reino|cidade|cidade-estado|territ[oó]rio|territorio|cen[aá]rio|cenario|setting|localiza[cç][aã]o|geografia)(\W|$)/i.test(haystack)) {
    reasonCodes.push('keyword:world')
    return {
      destinationKind: 'world' as BridgeItemDestinationKind,
      destinationCandidates: buildCandidates('world'),
      reasonCodes,
    }
  }

  reasonCodes.push('fallback:vault')
  return {
    destinationKind: 'vault' as BridgeItemDestinationKind,
    destinationCandidates: buildCandidates('vault'),
    reasonCodes,
  }
}

function extractArtifact(envelope: BridgeExportEnvelope) {
  if (!isRecord(envelope.deliveryPayload)) {
    return null
  }

  const artifact = envelope.deliveryPayload.artifact
  if (!isRecord(artifact)) {
    return null
  }

  const title = asNonEmptyString(artifact.title)
  const content = asNonEmptyString(artifact.plainText)

  if (!title || !content) {
    return null
  }

  const metadata = isRecord(artifact.metadata) ? artifact.metadata : null

  return {
    title,
    summary: asNonEmptyString(artifact.summary),
    content,
    organizationType: asNonEmptyString(metadata?.organizationType ?? null),
  }
}

function buildBridgeItemPayload(
  envelope: BridgeExportEnvelope,
  classification: ReturnType<typeof classifyDestination>,
) {
  return {
    bridgeVersion: 'voiceideas.bridge-item.v1',
    domain: 'voiceideas',
    // VI_BRIDGE.MODES.1: deriva do envelope; manual notes terão 'manual' aqui.
    // Se por qualquer motivo o envelope chegar com null (não deveria após a
    // mudança), fallback defensivo para 'manual'.
    sourceSessionMode: envelope.sourceSessionMode ?? 'manual',
    sourceSessionIds: envelope.sourceSessionIds,
    contentType: envelope.contentType,
    deliveryPayload: envelope.deliveryPayload,
    classification: {
      destinationKind: classification.destinationKind,
      destinationCandidates: classification.destinationCandidates,
      reasonCodes: classification.reasonCodes,
    },
  } satisfies Record<string, unknown>
}

function createMaterializedDraft(
  envelope: BridgeExportEnvelope,
  eligibility: BridgeExportEligibility,
): MaterializedBridgeItemDraft | null {
  if (!eligibility.eligible) {
    return null
  }

  const artifact = extractArtifact(envelope)
  if (!artifact) {
    return null
  }

  const classification = classifyDestination({
    contentType: envelope.contentType,
    title: artifact.title,
    summary: artifact.summary,
    content: artifact.content,
    organizationType: artifact.organizationType,
  })

  return {
    sourceType: envelope.contentType,
    sourceId: envelope.contentId,
    sourceCaptureSessionId: envelope.sourceSessionIds[0] ?? null,
    // VI_BRIDGE.MODES.1: respeita o envelope. Para notas safe_capture vem
    // 'safe_capture'; para manual/contínuo vem 'manual'. Fallback defensivo.
    sourceSessionMode: envelope.sourceSessionMode ?? 'manual',
    contentType: envelope.contentType,
    domain: 'voiceideas',
    scopeType: 'project',
    title: artifact.title,
    summary: artifact.summary,
    content: artifact.content,
    payload: buildBridgeItemPayload(envelope, classification),
    validationStatus: 'valid',
    validationIssues: eligibility.validationIssues,
    bridgeStatus: 'eligible',
    destinationKind: classification.destinationKind,
    destinationCandidates: classification.destinationCandidates,
    publishedAt: null,
    consumedAt: null,
  }
}

async function getExistingBridgeItem(
  client: SupabaseClient,
  userId: string,
  sourceType: BridgeItemSourceType,
  sourceId: string,
) {
  const { data, error } = await client
    .from('bridge_items')
    .select('id, bridge_status, published_at, consumed_at')
    .eq('user_id', userId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .maybeSingle()

  if (error) {
    throw new Error(`Nao foi possivel ler bridge_items existentes: ${error.message}`)
  }

  return data as PersistedBridgeItemRow | null
}

function getNextBridgeStatus(existing: PersistedBridgeItemRow | null) {
  // Preserva estados terminais durante re-sync. ANTES desta correção, 'blocked'
  // caía no fallback 'eligible', o que fazia o sync "desbloquear" itens
  // rejeitados pelo Bardo (causa raiz do bug observado em VI_BRIDGE.STATUS_AND_RESEND.1).
  // O reenvio explícito agora passa por `bridge_reopen_for_resend` no
  // export-to-cenax; o sync passivo NÃO deve mais resetar terminais.
  if (existing?.bridge_status === 'consumed') {
    return 'consumed' as const
  }

  if (existing?.bridge_status === 'blocked') {
    return 'blocked' as const
  }

  if (existing?.bridge_status === 'published') {
    return 'published' as const
  }

  return 'eligible' as const
}

async function persistEligibleBridgeItem(
  client: SupabaseClient,
  userId: string,
  draft: MaterializedBridgeItemDraft,
  existing: PersistedBridgeItemRow | null,
) {
  const bridgeStatus = getNextBridgeStatus(existing)

  const { data, error } = await client
    .from('bridge_items')
    .upsert({
      user_id: userId,
      source_type: draft.sourceType,
      source_id: draft.sourceId,
      source_capture_session_id: draft.sourceCaptureSessionId,
      source_session_mode: draft.sourceSessionMode,
      content_type: draft.contentType,
      domain: draft.domain,
      scope_type: draft.scopeType,
      title: draft.title,
      summary: draft.summary,
      content: draft.content,
      payload: draft.payload,
      validation_status: draft.validationStatus,
      validation_issues: draft.validationIssues,
      bridge_status: bridgeStatus,
      destination_kind: draft.destinationKind,
      destination_candidates: draft.destinationCandidates,
      published_at: existing?.published_at ?? draft.publishedAt,
      consumed_at: existing?.consumed_at ?? draft.consumedAt,
    }, {
      onConflict: 'source_type,source_id',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Nao foi possivel persistir bridge_item elegivel: ${error?.message || 'sem retorno'}`)
  }

  return data.id as string
}

async function markExistingBridgeItemBlocked(
  client: SupabaseClient,
  existing: PersistedBridgeItemRow,
  validationIssues: BridgeExportValidationIssue[],
) {
  // VI_BRIDGE.SNAPSHOT_RESEND.INBOX_FIX (2026-05-12):
  //
  // ANTES: o else branch rebaixava `bridge_status` para 'blocked' sempre que
  // o item existente não estivesse em 'published' ou 'consumed'. Esse
  // comportamento destruía o estado 'eligible' criado por
  // `bridge_reopen_for_resend` no caminho de snapshot resend: bastava o
  // painel re-abrir e disparar validateBridgeContent → sync caía aqui →
  // 'eligible' virava 'blocked' → o Inbox do Bardo (que filtra
  // `bridge_status NOT IN ('consumed','blocked')`) deixava de listar o item.
  //
  // AGORA: validation_status sinaliza "fonte atual não-elegível"
  // (UI consome isso para mostrar "fonte original mudou"), mas
  // `bridge_status` é OPERACIONAL e só muda via lifecycle explícito
  // — `bridge_mark_imported` (→ consumed), `bridge_mark_rejected` (→ blocked),
  // `bridge_reopen_for_resend` (terminal → eligible), `syncEligible*` (válido
  // → eligible/published). Sync passiva NÃO move estados operacionais.
  //
  // Casos cobertos:
  //   - existing.bridge_status='eligible' (resend reaberto) → fica 'eligible'
  //   - existing.bridge_status='consumed' → fica 'consumed'
  //   - existing.bridge_status='blocked' (foi rejeitado pelo Bardo) → fica 'blocked'
  //   - existing.bridge_status='published'/'draft' → preservados
  const { error } = await client
    .from('bridge_items')
    .update({
      validation_status: 'blocked',
      validation_issues: validationIssues,
    })
    .eq('id', existing.id)

  if (error) {
    throw new Error(`Nao foi possivel bloquear bridge_item existente: ${error.message}`)
  }
}

async function resolveContentForBridgeItem(
  client: SupabaseClient,
  userId: string,
  contentType: BridgeExportContentType,
  contentId: string,
) {
  return contentType === 'note'
    ? await resolveNoteBridgeExport(client, userId, contentId, 'bardo')
    : await resolveOrganizedIdeaBridgeExport(client, userId, contentId, 'bardo')
}

export async function syncBridgeItemFromResolvedContent(
  client: SupabaseClient,
  userId: string,
  resolved: Awaited<ReturnType<typeof resolveNoteBridgeExport>> | Awaited<ReturnType<typeof resolveOrganizedIdeaBridgeExport>>,
): Promise<BridgeItemSyncResult> {
  const existing = await getExistingBridgeItem(client, userId, resolved.envelope.contentType, resolved.contentId)
  const draft = createMaterializedDraft(resolved.envelope, resolved.eligibility)

  if (!draft) {
    if (existing) {
      await markExistingBridgeItemBlocked(client, existing, resolved.eligibility.validationIssues)
    }

    return {
      bridgeItemId: existing?.id ?? null,
      eligibility: resolved.eligibility,
      materialized: false,
      blocked: true,
    }
  }

  const bridgeItemId = await persistEligibleBridgeItem(client, userId, draft, existing)

  return {
    bridgeItemId,
    eligibility: resolved.eligibility,
    materialized: true,
    blocked: false,
  }
}

export async function syncBridgeItemForContent(
  client: SupabaseClient,
  userId: string,
  input: {
    contentType: BridgeExportContentType
    contentId: string
  },
): Promise<BridgeItemSyncResult> {
  const resolved = await resolveContentForBridgeItem(client, userId, input.contentType, input.contentId)
  return await syncBridgeItemFromResolvedContent(client, userId, resolved)
}

export async function syncEligibleBridgeItemsForUser(
  client: SupabaseClient,
  userId: string,
): Promise<BridgeItemSyncSummary> {
  // VI_BRIDGE.MODES.1: lista TODAS as notas do usuário, não apenas as com
  // source_capture_session_id. A elegibilidade real é decidida nota a nota
  // por `resolveNoteBridgeExport` (que aceita manual + safe_capture).
  // Notas sem texto consolidado continuam sendo bloqueadas pelo validator.
  const [{ data: notesData, error: notesError }, { data: ideasData, error: ideasError }] = await Promise.all([
    client
      .from('notes')
      .select('id')
      .eq('user_id', userId),
    client
      .from('organized_ideas')
      .select('id')
      .eq('user_id', userId),
  ])

  if (notesError) {
    throw new Error(`Nao foi possivel listar notas para sync de bridge_items: ${notesError.message}`)
  }

  if (ideasError) {
    throw new Error(`Nao foi possivel listar ideias organizadas para sync de bridge_items: ${ideasError.message}`)
  }

  const candidates = [
    ...(((notesData as Array<{ id: string }> | null) || []).map((note) => ({
      contentType: 'note' as const,
      contentId: note.id,
    }))),
    ...(((ideasData as Array<{ id: string }> | null) || []).map((idea) => ({
      contentType: 'organized_idea' as const,
      contentId: idea.id,
    }))),
  ]

  const results = await Promise.all(
    candidates.map((candidate) => syncBridgeItemForContent(client, userId, candidate)),
  )

  return {
    scanned: candidates.length,
    materialized: results.filter((result) => result.materialized).length,
    blocked: results.filter((result) => result.blocked).length,
  }
}

export async function markBridgeItemPublished(
  client: SupabaseClient,
  bridgeItemId: string,
) {
  const publishedAt = new Date().toISOString()

  const { error } = await client
    .from('bridge_items')
    .update({
      bridge_status: 'published',
      published_at: publishedAt,
      validation_status: 'valid',
    })
    .eq('id', bridgeItemId)

  if (error) {
    throw new Error(`Nao foi possivel marcar bridge_item como published: ${error.message}`)
  }

  return publishedAt
}
