import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import {
  resolveNoteBridgeExport,
  resolveOrganizedIdeaBridgeExport,
  type BridgeExportContentType,
  type BridgeExportEligibility,
  type BridgeExportEnvelope,
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
  sourceSessionMode: 'safe_capture'
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
    sourceSessionMode: 'safe_capture',
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
    sourceSessionMode: 'safe_capture',
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
  if (existing?.bridge_status === 'consumed') {
    return 'consumed' as const
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
  const preservedStatus = existing.bridge_status === 'published' || existing.bridge_status === 'consumed'
    ? existing.bridge_status
    : 'blocked'

  const { error } = await client
    .from('bridge_items')
    .update({
      validation_status: 'blocked',
      validation_issues: validationIssues,
      bridge_status: preservedStatus,
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
  const [{ data: notesData, error: notesError }, { data: ideasData, error: ideasError }] = await Promise.all([
    client
      .from('notes')
      .select('id')
      .eq('user_id', userId)
      .not('source_capture_session_id', 'is', null),
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
