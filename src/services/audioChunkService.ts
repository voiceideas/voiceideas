import { supabase } from '../lib/supabase'
import { AppError, createAppError } from '../lib/errors'
import { requireAuthenticatedUserId } from './serviceAuth'
import type { Database } from '../types/database'
import type { AudioChunk, AudioChunkFilters, CreateAudioChunkInput, UpdateAudioChunkInput } from '../types/chunk'

type AudioChunkRow = Database['public']['Tables']['audio_chunks']['Row']
type AudioChunkInsert = Database['public']['Tables']['audio_chunks']['Insert']
type AudioChunkUpdate = Database['public']['Tables']['audio_chunks']['Update']

const CAPTURE_BUCKET = 'voice-captures'

export interface DeleteAudioChunkResult {
  chunkId: string
  sessionId: string
  deleted: boolean
  deletedJobCount: number
  deletedDraftId: string | null
  deletedExportCount: number
  sessionProcessingStatus: string
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

function buildChunkAudioPath(userId: string, sessionId: string, chunkId: string, extension: string) {
  return `${userId}/sessions/${sessionId}/chunks/${chunkId}.${extension}`
}

function mapAudioChunkRow(row: AudioChunkRow): AudioChunk {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    storagePath: row.storage_path,
    startMs: row.start_ms,
    endMs: row.end_ms,
    durationMs: row.duration_ms,
    segmentationReason: row.segmentation_reason,
    queueStatus: row.queue_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapAudioChunkInsert(userId: string, input: CreateAudioChunkInput): AudioChunkInsert {
  const durationMs = input.durationMs ?? (input.endMs - input.startMs)

  return {
    session_id: input.sessionId,
    user_id: userId,
    storage_path: input.storagePath,
    start_ms: input.startMs,
    end_ms: input.endMs,
    duration_ms: durationMs,
    segmentation_reason: input.segmentationReason,
    queue_status: input.queueStatus ?? 'segmented',
  }
}

function mapAudioChunkUpdate(input: UpdateAudioChunkInput): AudioChunkUpdate {
  return {
    storage_path: input.storagePath,
    start_ms: input.startMs,
    end_ms: input.endMs,
    duration_ms: input.durationMs,
    segmentation_reason: input.segmentationReason,
    queue_status: input.queueStatus,
  }
}

export async function listAudioChunks(filters: AudioChunkFilters = {}) {
  const userId = await requireAuthenticatedUserId()

  let query = supabase
    .from('audio_chunks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (filters.sessionId) {
    query = query.eq('session_id', filters.sessionId)
  }

  if (filters.queueStatus) {
    query = query.eq('queue_status', filters.queueStatus)
  }

  if (filters.limit) {
    query = query.limit(filters.limit)
  }

  const { data, error } = await query
  if (error) throw await createAppError(error, 'Nao foi possivel carregar os trechos da fila.')

  return ((data as AudioChunkRow[]) || []).map(mapAudioChunkRow)
}

export async function createAudioChunk(input: CreateAudioChunkInput) {
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('audio_chunks')
    .insert(mapAudioChunkInsert(userId, input))
    .select()
    .single()

  if (error) throw await createAppError(error, 'Nao foi possivel criar este trecho.')
  return mapAudioChunkRow(data as AudioChunkRow)
}

export async function updateAudioChunk(id: string, input: UpdateAudioChunkInput) {
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('audio_chunks')
    .update(mapAudioChunkUpdate(input))
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw await createAppError(error, 'Nao foi possivel atualizar este trecho.')
  return mapAudioChunkRow(data as AudioChunkRow)
}

export async function uploadAudioChunkFile(
  sessionId: string,
  chunkId: string,
  file: Blob & { name?: string },
) {
  const userId = await requireAuthenticatedUserId()
  const extension = inferAudioExtension(file)
  const storagePath = buildChunkAudioPath(userId, sessionId, chunkId, extension)

  const { error } = await supabase.storage
    .from(CAPTURE_BUCKET)
    .upload(storagePath, file, {
      upsert: true,
      contentType: file.type || undefined,
    })

  if (error) throw await createAppError(error, 'Nao foi possivel enviar o audio deste trecho.')
  return storagePath
}

export async function deleteAudioChunkFile(storagePath: string) {
  const { error } = await supabase.storage
    .from(CAPTURE_BUCKET)
    .remove([storagePath])

  if (error) throw await createAppError(error, 'Nao foi possivel excluir o audio deste trecho.')
}

export async function deleteAudioChunk(chunkId: string) {
  const { data, error } = await supabase.functions.invoke<DeleteAudioChunkResult>('delete-audio-chunk', {
    body: {
      chunkId,
    },
  })

  if (error) {
    throw await createAppError(error, 'Nao foi possivel excluir este trecho agora.')
  }

  if (!data) {
    throw new AppError({
      message: 'A exclusao do chunk nao retornou dados.',
      code: 'missing_data',
      status: null,
      details: null,
      raw: null,
    })
  }

  return data
}
