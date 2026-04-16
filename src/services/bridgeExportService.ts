import { supabase, supabaseUrl } from '../lib/supabase'
import { AppError, createAppError } from '../lib/errors'
import { getAuthenticatedFunctionHeaders, invokeAuthenticatedFunction } from '../lib/functionAuth'
import type { Database } from '../types/database'
import type {
  BridgeExport,
  BridgeExportContentType,
  BridgeExportEligibility,
  BridgeExportFilters,
  BridgeExportPayload,
  BridgeExportValidationIssue,
  CreateBridgeExportInput,
  IdeaBridgePayload,
  PersistedIdeaBridgePayload,
  UpdateBridgeExportInput,
} from '../types/bridge'

type BridgeExportRow = Database['public']['Tables']['bridge_exports']['Row']
type BridgeExportInsert = Database['public']['Tables']['bridge_exports']['Insert']
type BridgeExportUpdate = Database['public']['Tables']['bridge_exports']['Update']

export interface ExportIdeaDraftResult {
  exportId: string
  status: BridgeExport['status']
  dispatched: boolean
  destination: BridgeExport['destination']
  reused?: boolean
  auditOnly?: boolean
  sessionProcessingStatus?: Database['public']['Tables']['capture_sessions']['Row']['processing_status']
  payload?: Record<string, unknown>
}

export interface ExportBridgeContentInput {
  contentType: Extract<BridgeExportContentType, 'note' | 'organized_idea'>
  contentId: string
  destination: BridgeExport['destination']
  retry?: boolean
}

export interface ValidateBridgeContentInput {
  contentType: Extract<BridgeExportContentType, 'note' | 'organized_idea'>
  contentId: string
  destination: BridgeExport['destination']
}

export interface ExportBridgeContentResult {
  exportId: string
  status: BridgeExport['status']
  dispatched: boolean
  destination: BridgeExport['destination']
  reused?: boolean
  auditOnly?: boolean
  eligibility: BridgeExportEligibility
  payload?: BridgeExportPayload
  targetStatus?: number
  targetResponse?: unknown
}

export interface ValidateBridgeContentResult {
  eligibility: BridgeExportEligibility
  payload?: BridgeExportPayload
}

function getBridgeFunctionUrl() {
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/export-to-cenax`
}

async function parseBridgeFunctionResponse<T>(response: Response): Promise<T | null> {
  const rawText = await response.text()
  if (!rawText.trim()) {
    return null
  }

  try {
    return JSON.parse(rawText) as T
  } catch {
    return null
  }
}

function extractBridgeFunctionErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') {
    return fallback
  }

  const record = payload as Record<string, unknown>
  return typeof record.error === 'string' && record.error.trim()
    ? record.error
    : fallback
}

async function invokeBridgeFunction<T>(body: Record<string, unknown>) {
  const headers = await getAuthenticatedFunctionHeaders(
    { 'Content-Type': 'application/json' },
    { requireFreshSession: true },
  )

  const response = await fetch(getBridgeFunctionUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const data = await parseBridgeFunctionResponse<T>(response)

  return {
    ok: response.ok,
    status: response.status,
    data,
  }
}

function mapLegacyBridgePayload(payload: Record<string, unknown>): IdeaBridgePayload {
  const record = payload as Partial<PersistedIdeaBridgePayload> & Partial<IdeaBridgePayload>

  return {
    source: 'voiceideas',
    sourceSessionId: String(record.source_session_id ?? record.sourceSessionId ?? ''),
    sourceChunkId: String(record.source_chunk_id ?? record.sourceChunkId ?? ''),
    platformSource: (record.platform_source ?? record.platformSource ?? 'web') as IdeaBridgePayload['platformSource'],
    title: String(record.title ?? 'Ideia sem titulo'),
    text: String(record.text ?? ''),
    rawText: String(record.raw_text ?? record.rawText ?? ''),
    tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
    folder: typeof record.folder === 'string' ? record.folder : null,
    audioUrl: typeof record.audio_url === 'string'
      ? record.audio_url
      : (typeof record.audioUrl === 'string' ? record.audioUrl : null),
    confidence: typeof record.confidence === 'number' ? record.confidence : null,
    createdAt: String(record.created_at ?? record.createdAt ?? new Date().toISOString()),
    destination: (record.destination ?? 'cenax') as IdeaBridgePayload['destination'],
  }
}

function isBridgeExportEnvelope(payload: unknown): payload is BridgeExportPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }

  const record = payload as Record<string, unknown>

  return (
    typeof record.bridgeVersion === 'string'
    && typeof record.domain === 'string'
    && typeof record.contentType === 'string'
    && typeof record.contentId === 'string'
  )
}

function mapBridgeValidationIssues(value: unknown): BridgeExportValidationIssue[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((issue) => {
      if (typeof issue !== 'object' || issue === null) {
        return null
      }

      const record = issue as Record<string, unknown>
      if (typeof record.code !== 'string' || typeof record.message !== 'string') {
        return null
      }

      return {
        code: record.code,
        message: record.message,
      }
    })
    .filter((issue): issue is BridgeExportValidationIssue => Boolean(issue))
}

function mapBridgePayload(payload: Record<string, unknown>, row: BridgeExportRow): BridgeExportPayload {
  if (isBridgeExportEnvelope(payload)) {
    return {
      bridgeVersion: payload.bridgeVersion,
      domain: payload.domain as BridgeExportPayload['domain'],
      destination: payload.destination as BridgeExportPayload['destination'],
      contentType: payload.contentType as BridgeExportPayload['contentType'],
      contentId: payload.contentId,
      scopeType: (payload.scopeType as BridgeExportPayload['scopeType']) ?? 'project',
      sourceSessionMode: (payload.sourceSessionMode as BridgeExportPayload['sourceSessionMode']) ?? null,
      sourceSessionIds: Array.isArray(payload.sourceSessionIds) ? payload.sourceSessionIds.map(String) : [],
      validationStatus: (payload.validationStatus as BridgeExportPayload['validationStatus']) ?? row.validation_status,
      validationIssues: mapBridgeValidationIssues(payload.validationIssues),
      deliveryPayload: (payload.deliveryPayload as BridgeExportPayload['deliveryPayload']) ?? null,
    }
  }

  return {
    bridgeVersion: 'voiceideas.bridge-export.v1',
    domain: 'voiceideas',
    destination: row.destination,
    contentType: row.content_type,
    contentId: row.idea_draft_id ?? row.note_id ?? row.organized_idea_id ?? row.id,
    scopeType: 'project',
    sourceSessionMode: row.content_type === 'idea_draft' ? null : 'safe_capture',
    sourceSessionIds: [],
    validationStatus: row.validation_status,
    validationIssues: mapBridgeValidationIssues(row.validation_issues),
    deliveryPayload: mapLegacyBridgePayload(payload),
  }
}

function serializeBridgePayload(payload: BridgeExportPayload) {
  return payload as unknown as Record<string, unknown>
}

function serializeValidationIssues(issues: BridgeExportValidationIssue[]) {
  return issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
  }))
}

function mapBridgeExportRow(row: BridgeExportRow): BridgeExport {
  return {
    id: row.id,
    contentType: row.content_type,
    ideaDraftId: row.idea_draft_id,
    noteId: row.note_id,
    organizedIdeaId: row.organized_idea_id,
    destination: row.destination,
    payload: mapBridgePayload(row.payload, row),
    status: row.status,
    validationStatus: row.validation_status,
    validationIssues: mapBridgeValidationIssues(row.validation_issues),
    error: row.error,
    exportedAt: row.exported_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapBridgeExportInsert(input: CreateBridgeExportInput): BridgeExportInsert {
  return {
    content_type: input.contentType,
    idea_draft_id: input.ideaDraftId ?? null,
    note_id: input.noteId ?? null,
    organized_idea_id: input.organizedIdeaId ?? null,
    destination: input.destination,
    payload: serializeBridgePayload(input.payload),
    status: input.status ?? 'pending',
    validation_status: input.validationStatus ?? input.payload.validationStatus,
    validation_issues: serializeValidationIssues(
      input.validationIssues ?? input.payload.validationIssues,
    ),
    error: input.error ?? null,
    exported_at:
      input.exportedAt
      ?? (input.status === 'exported' ? new Date().toISOString() : null),
  }
}

function mapBridgeExportUpdate(input: UpdateBridgeExportInput): BridgeExportUpdate {
  return {
    payload: input.payload ? serializeBridgePayload(input.payload) : undefined,
    status: input.status,
    validation_status: input.validationStatus,
    validation_issues: input.validationIssues
      ? serializeValidationIssues(input.validationIssues)
      : undefined,
    error: input.error,
    exported_at:
      input.exportedAt
      ?? (input.status === 'exported' ? new Date().toISOString() : undefined),
  }
}

function mapExportEligibility(payload: BridgeExportEligibility): BridgeExportEligibility {
  return {
    contentType: payload.contentType,
    contentId: payload.contentId,
    destination: payload.destination,
    eligible: payload.eligible,
    sourceSessionMode: payload.sourceSessionMode,
    sourceSessionIds: payload.sourceSessionIds ?? [],
    validationStatus: payload.validationStatus,
    validationIssues: payload.validationIssues ?? [],
    reason: payload.reason ?? null,
  }
}

export async function listBridgeExports(filters: BridgeExportFilters = {}) {
  let query = supabase
    .from('bridge_exports')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters.ideaDraftId) {
    query = query.eq('idea_draft_id', filters.ideaDraftId)
  }

  if (filters.noteId) {
    query = query.eq('note_id', filters.noteId)
  }

  if (filters.organizedIdeaId) {
    query = query.eq('organized_idea_id', filters.organizedIdeaId)
  }

  if (filters.contentType) {
    query = query.eq('content_type', filters.contentType)
  }

  if (filters.destination) {
    query = query.eq('destination', filters.destination)
  }

  if (filters.status) {
    query = query.eq('status', filters.status)
  }

  if (filters.limit) {
    query = query.limit(filters.limit)
  }

  const { data, error } = await query
  if (error) throw await createAppError(error, 'Nao foi possivel carregar os envios da fila.')

  return ((data as BridgeExportRow[]) || []).map(mapBridgeExportRow)
}

export async function createBridgeExport(input: CreateBridgeExportInput) {
  const { data, error } = await supabase
    .from('bridge_exports')
    .insert(mapBridgeExportInsert(input))
    .select()
    .single()

  if (error) throw await createAppError(error, 'Nao foi possivel registrar este envio.')
  return mapBridgeExportRow(data as BridgeExportRow)
}

export async function updateBridgeExport(id: string, input: UpdateBridgeExportInput) {
  const { data, error } = await supabase
    .from('bridge_exports')
    .update(mapBridgeExportUpdate(input))
    .eq('id', id)
    .select()
    .single()

  if (error) throw await createAppError(error, 'Nao foi possivel atualizar este envio.')
  return mapBridgeExportRow(data as BridgeExportRow)
}

export async function validateBridgeContent(input: ValidateBridgeContentInput) {
  const body = input.contentType === 'note'
    ? {
        contentType: 'note' as const,
        noteId: input.contentId,
        destination: input.destination,
        validateOnly: true,
      }
    : {
        contentType: 'organized_idea' as const,
        organizedIdeaId: input.contentId,
        destination: input.destination,
        validateOnly: true,
      }

  const result = await invokeBridgeFunction<ValidateBridgeContentResult>(body)
  const data = result.data

  if (!data) {
    throw new AppError({
      message: 'A validacao da exportacao nao retornou dados.',
      code: 'missing_data',
      status: null,
      details: null,
      raw: null,
    })
  }

  if (!result.ok && result.status !== 409) {
    throw new Error(
      extractBridgeFunctionErrorMessage(data, 'Nao foi possivel validar a elegibilidade da exportacao.'),
    )
  }

  return {
    eligibility: mapExportEligibility(data.eligibility),
    payload: data.payload,
  }
}

export async function exportBridgeContent(input: ExportBridgeContentInput) {
  const body = input.contentType === 'note'
    ? {
        contentType: 'note' as const,
        noteId: input.contentId,
        destination: input.destination,
        retry: input.retry ?? false,
      }
    : {
        contentType: 'organized_idea' as const,
        organizedIdeaId: input.contentId,
        destination: input.destination,
        retry: input.retry ?? false,
      }

  const result = await invokeBridgeFunction<ExportBridgeContentResult>(body)
  const data = result.data

  if (!data) {
    throw new AppError({
      message: 'A exportacao nao retornou dados.',
      code: 'missing_data',
      status: null,
      details: null,
      raw: null,
    })
  }

  if (!result.ok && result.status !== 409) {
    throw new Error(
      extractBridgeFunctionErrorMessage(data, 'Nao foi possivel enviar agora.'),
    )
  }

  return {
    ...data,
    eligibility: mapExportEligibility(data.eligibility),
  }
}

export async function exportIdeaDraft(input: {
  ideaDraftId: string
  destination: BridgeExport['destination']
  retry?: boolean
}) {
  const { data, error } = await invokeAuthenticatedFunction<ExportIdeaDraftResult>('export-to-cenax', {
    body: input,
  })

  if (error) throw await createAppError(error, 'Nao foi possivel enviar agora.')
  if (!data) {
    throw new AppError({
      message: 'A exportacao nao retornou dados.',
      code: 'missing_data',
      status: null,
      details: null,
      raw: null,
    })
  }

  return data
}
