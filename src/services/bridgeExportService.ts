import { supabase } from '../lib/supabase'
import { AppError, createAppError } from '../lib/errors'
import { invokeAuthenticatedFunction } from '../lib/functionAuth'
import type { Database } from '../types/database'
import type {
  BridgeExport,
  BridgeExportFilters,
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
  payload?: IdeaBridgePayload
}

function mapBridgePayload(payload: Record<string, unknown>): IdeaBridgePayload {
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

function serializeBridgePayload(payload: IdeaBridgePayload): PersistedIdeaBridgePayload {
  return {
    source: payload.source,
    source_session_id: payload.sourceSessionId,
    source_chunk_id: payload.sourceChunkId,
    platform_source: payload.platformSource,
    title: payload.title,
    text: payload.text,
    raw_text: payload.rawText,
    tags: payload.tags,
    folder: payload.folder,
    audio_url: payload.audioUrl,
    confidence: payload.confidence,
    created_at: payload.createdAt,
    destination: payload.destination,
  }
}

function mapBridgeExportRow(row: BridgeExportRow): BridgeExport {
  return {
    id: row.id,
    ideaDraftId: row.idea_draft_id,
    destination: row.destination,
    payload: mapBridgePayload(row.payload),
    status: row.status,
    error: row.error,
    exportedAt: row.exported_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapBridgeExportInsert(input: CreateBridgeExportInput): BridgeExportInsert {
  return {
    idea_draft_id: input.ideaDraftId,
    destination: input.destination,
    payload: serializeBridgePayload(input.payload) as unknown as Record<string, unknown>,
    status: input.status ?? 'pending',
    error: input.error ?? null,
    exported_at:
      input.exportedAt
      ?? (input.status === 'exported' ? new Date().toISOString() : null),
  }
}

function mapBridgeExportUpdate(input: UpdateBridgeExportInput): BridgeExportUpdate {
  return {
    payload: input.payload ? (serializeBridgePayload(input.payload) as unknown as Record<string, unknown>) : undefined,
    status: input.status,
    error: input.error,
    exported_at:
      input.exportedAt
      ?? (input.status === 'exported' ? new Date().toISOString() : undefined),
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
