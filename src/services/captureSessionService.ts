import { supabase } from '../lib/supabase'
import { AppError, createAppError } from '../lib/errors'
import { invokeAuthenticatedFunction } from '../lib/functionAuth'
import { requireAuthenticatedUserId } from './serviceAuth'
import type { Database } from '../types/database'
import type {
  CaptureSession,
  CaptureSessionFilters,
  CaptureSessionStatus,
  CreateCaptureSessionInput,
  UpdateCaptureSessionInput,
} from '../types/capture'
import type { SegmentCaptureSessionInput, SegmentCaptureSessionResult } from '../types/segmentation'
import type { AudioChunkQueueStatus, AudioChunkSegmentationReason } from '../types/chunk'

type CaptureSessionRow = Database['public']['Tables']['capture_sessions']['Row']
type CaptureSessionInsert = Database['public']['Tables']['capture_sessions']['Insert']
type CaptureSessionUpdate = Database['public']['Tables']['capture_sessions']['Update']

const CAPTURE_BUCKET = 'voice-captures'

function normalizeCaptureAudioMimeType(mimeType: string | null | undefined) {
  if (!mimeType) return null

  const normalizedMimeType = mimeType.toLowerCase()
  if (normalizedMimeType === 'audio/m4a' || normalizedMimeType === 'audio/x-m4a') {
    return 'audio/mp4'
  }

  return mimeType
}

function normalizeCaptureAudioFileForUpload(file: Blob & { name?: string }) {
  const normalizedMimeType = normalizeCaptureAudioMimeType(file.type)

  if (!normalizedMimeType || normalizedMimeType === file.type) {
    return {
      file,
      contentType: normalizedMimeType ?? undefined,
    }
  }

  const normalizedFile = typeof File !== 'undefined' && file instanceof File
    ? new File([file], file.name, { type: normalizedMimeType })
    : new Blob([file], { type: normalizedMimeType })

  return {
    file: normalizedFile as Blob & { name?: string },
    contentType: normalizedMimeType,
  }
}

function defaultProvisionalFolderName(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')

  return `captura-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function inferAudioExtension(file: Blob & { name?: string }, fallback = 'webm') {
  const name = typeof file.name === 'string' ? file.name : ''
  const match = name.match(/\.([a-z0-9]+)$/i)
  if (match?.[1]) {
    return match[1].toLowerCase()
  }

  const mime = file.type.split('/').pop()
  return mime ? mime.replace(/[^a-z0-9]/gi, '').toLowerCase() || fallback : fallback
}

function buildSessionAudioPath(userId: string, sessionId: string, extension: string) {
  return `${userId}/sessions/${sessionId}/raw.${extension}`
}

function mapCaptureSessionRow(row: CaptureSessionRow): CaptureSession {
  return {
    id: row.id,
    userId: row.user_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    provisionalFolderName: row.provisional_folder_name,
    finalFolderName: row.final_folder_name,
    renameRequired: row.rename_required,
    processingStatus: row.processing_status,
    platformSource: row.platform_source,
    rawStoragePath: row.raw_storage_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapCaptureSessionInsert(userId: string, input: CreateCaptureSessionInput): CaptureSessionInsert {
  return {
    user_id: userId,
    started_at: input.startedAt ?? new Date().toISOString(),
    ended_at: input.endedAt ?? null,
    status: input.status ?? 'active',
    provisional_folder_name: input.provisionalFolderName?.trim() || defaultProvisionalFolderName(),
    final_folder_name: input.finalFolderName ?? null,
    rename_required: input.renameRequired ?? true,
    processing_status: input.processingStatus ?? 'captured',
    platform_source: input.platformSource,
    raw_storage_path: input.rawStoragePath ?? null,
  }
}

function mapCaptureSessionUpdate(input: UpdateCaptureSessionInput): CaptureSessionUpdate {
  return {
    ended_at: input.endedAt,
    status: input.status,
    provisional_folder_name: input.provisionalFolderName,
    final_folder_name: input.finalFolderName,
    rename_required: input.renameRequired,
    processing_status: input.processingStatus,
    raw_storage_path: input.rawStoragePath,
  }
}

export interface UploadCaptureSessionAudioResult {
  bucket: typeof CAPTURE_BUCKET
  storagePath: string
}

export interface DeleteCaptureSessionResult {
  sessionId: string
  deleted: boolean
  deletedChunkCount: number
  deletedJobCount: number
  deletedDraftCount: number
  deletedExportCount: number
}

interface SegmentCaptureSessionChunkRow {
  id: string
  storage_path: string
  start_ms: number
  end_ms: number
  duration_ms: number
  segmentation_reason: AudioChunkSegmentationReason
  queue_status: AudioChunkQueueStatus
}

interface SegmentCaptureSessionResponse {
  sessionId: string
  created: boolean
  processingStatus: CaptureSession['processingStatus']
  strategy: SegmentCaptureSessionResult['strategy']
  usedFallback: boolean
  strongDelimiterPrepared: boolean
  totalDurationMs: number
  settings: SegmentCaptureSessionResult['settings']
  chunks: SegmentCaptureSessionChunkRow[]
}

export async function listCaptureSessions(filters: CaptureSessionFilters = {}) {
  const userId = await requireAuthenticatedUserId()

  let query = supabase
    .from('capture_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })

  if (filters.status) {
    query = query.eq('status', filters.status)
  }

  if (filters.processingStatus) {
    query = query.eq('processing_status', filters.processingStatus)
  }

  if (typeof filters.renameRequired === 'boolean') {
    query = query.eq('rename_required', filters.renameRequired)
  }

  if (filters.limit) {
    query = query.limit(filters.limit)
  }

  const { data, error } = await query
  if (error) throw await createAppError(error, 'Nao foi possivel carregar as sessoes da fila.')

  return ((data as CaptureSessionRow[]) || []).map(mapCaptureSessionRow)
}

export async function createCaptureSession(input: CreateCaptureSessionInput) {
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('capture_sessions')
    .insert(mapCaptureSessionInsert(userId, input))
    .select()
    .single()

  if (error) throw await createAppError(error, 'Nao foi possivel criar esta sessao.')
  return mapCaptureSessionRow(data as CaptureSessionRow)
}

export async function updateCaptureSession(id: string, input: UpdateCaptureSessionInput) {
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('capture_sessions')
    .update(mapCaptureSessionUpdate(input))
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw await createAppError(error, 'Nao foi possivel atualizar esta sessao.')
  return mapCaptureSessionRow(data as CaptureSessionRow)
}

export async function completeCaptureSession(
  id: string,
  options: {
    endedAt?: string
    processingStatus?: CaptureSession['processingStatus']
    status?: CaptureSessionStatus
  } = {},
) {
  return updateCaptureSession(id, {
    endedAt: options.endedAt ?? new Date().toISOString(),
    processingStatus: options.processingStatus ?? 'awaiting-segmentation',
    status: options.status ?? 'completed',
  })
}

export async function uploadCaptureSessionAudio(
  sessionId: string,
  file: Blob & { name?: string },
) {
  const userId = await requireAuthenticatedUserId()
  const normalizedUpload = normalizeCaptureAudioFileForUpload(file)
  const extension = inferAudioExtension(normalizedUpload.file)
  const storagePath = buildSessionAudioPath(userId, sessionId, extension)

  const { error } = await supabase.storage
    .from(CAPTURE_BUCKET)
    .upload(storagePath, normalizedUpload.file, {
      upsert: true,
      contentType: normalizedUpload.contentType,
    })

  if (error) throw await createAppError(error, 'Nao foi possivel enviar o audio desta sessao.')

  return {
    bucket: CAPTURE_BUCKET,
    storagePath,
  } satisfies UploadCaptureSessionAudioResult
}

export async function deleteCaptureSessionAudio(storagePath: string) {
  const { error } = await supabase.storage
    .from(CAPTURE_BUCKET)
    .remove([storagePath])

  if (error) throw await createAppError(error, 'Nao foi possivel excluir o audio bruto desta sessao.')
}

export async function segmentCaptureSession(input: SegmentCaptureSessionInput) {
  const { data, error } = await invokeAuthenticatedFunction<SegmentCaptureSessionResponse>('segment-audio-session', {
    body: {
      sessionId: input.sessionId,
      durationMs: input.durationMs,
      startMs: input.startMs,
      fallbackSegmentationReason: input.fallbackSegmentationReason,
      mediumSilenceMs: input.mediumSilenceMs,
      longSilenceMs: input.longSilenceMs,
      minChunkMs: input.minChunkMs,
      analysisWindowMs: input.analysisWindowMs,
      strongDelimiterPhrase: input.strongDelimiterPhrase,
    },
  })

  if (error) {
    throw await createAppError(error, 'Nao foi possivel separar esta sessao agora.')
  }

  if (!data) {
    throw new AppError({
      message: 'A segmentacao nao retornou dados.',
      code: 'missing_data',
      status: null,
      details: null,
      raw: null,
    })
  }

  return {
    ...data,
    chunks: data.chunks.map((chunk) => ({
      id: chunk.id,
      storagePath: chunk.storage_path,
      startMs: chunk.start_ms,
      endMs: chunk.end_ms,
      durationMs: chunk.duration_ms,
      segmentationReason: chunk.segmentation_reason,
      queueStatus: chunk.queue_status,
    })),
  } satisfies SegmentCaptureSessionResult
}

export async function deleteCaptureSession(sessionId: string) {
  const { data, error } = await invokeAuthenticatedFunction<DeleteCaptureSessionResult>('delete-capture-session', {
    body: {
      sessionId,
    },
  })

  if (error) {
    throw await createAppError(error, 'Nao foi possivel excluir esta sessao agora.')
  }

  if (!data) {
    throw new AppError({
      message: 'A exclusao da sessao nao retornou dados.',
      code: 'missing_data',
      status: null,
      details: null,
      raw: null,
    })
  }

  return data
}
