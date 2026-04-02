import { supabase } from '../lib/supabase'
import { AppError, createAppError } from '../lib/errors'
import type { Database } from '../types/database'
import type { TranscriptionJob, TranscriptionJobFilters, CreateTranscriptionJobInput, UpdateTranscriptionJobInput } from '../types/transcription'
import { listAudioChunks } from './audioChunkService'

type TranscriptionJobRow = Database['public']['Tables']['transcription_jobs']['Row']
type TranscriptionJobInsert = Database['public']['Tables']['transcription_jobs']['Insert']
type TranscriptionJobUpdate = Database['public']['Tables']['transcription_jobs']['Update']

export interface TranscribeChunkResult {
  chunkId: string
  jobId: string
  status: 'completed'
  sessionProcessingStatus?: Database['public']['Tables']['capture_sessions']['Row']['processing_status']
  transcriptText: string | null
  reused?: boolean
}

function mapTranscriptionJobRow(row: TranscriptionJobRow): TranscriptionJob {
  return {
    id: row.id,
    chunkId: row.chunk_id,
    status: row.status,
    transcriptText: row.transcript_text,
    rawResponse: row.raw_response,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

function mapTranscriptionJobInsert(input: CreateTranscriptionJobInput): TranscriptionJobInsert {
  return {
    chunk_id: input.chunkId,
    status: input.status ?? 'pending',
    transcript_text: input.transcriptText ?? null,
    raw_response: input.rawResponse ?? null,
    error: input.error ?? null,
    completed_at:
      input.completedAt
      ?? ((input.status === 'completed' || input.status === 'failed') ? new Date().toISOString() : null),
  }
}

function mapTranscriptionJobUpdate(input: UpdateTranscriptionJobInput): TranscriptionJobUpdate {
  const terminalStatus = input.status === 'completed' || input.status === 'failed'

  return {
    status: input.status,
    transcript_text: input.transcriptText,
    raw_response: input.rawResponse ?? undefined,
    error: input.error,
    completed_at: input.completedAt ?? (terminalStatus ? new Date().toISOString() : undefined),
  }
}

export async function listTranscriptionJobs(filters: TranscriptionJobFilters = {}) {
  let chunkIds: string[] | null = null

  if (filters.sessionId) {
    const chunks = await listAudioChunks({ sessionId: filters.sessionId })
    chunkIds = chunks.map((chunk) => chunk.id)

    if (chunkIds.length === 0) {
      return []
    }
  }

  let query = supabase
    .from('transcription_jobs')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters.chunkId) {
    query = query.eq('chunk_id', filters.chunkId)
  } else if (chunkIds) {
    query = query.in('chunk_id', chunkIds)
  }

  if (filters.status) {
    query = query.eq('status', filters.status)
  }

  if (filters.limit) {
    query = query.limit(filters.limit)
  }

  const { data, error } = await query
  if (error) throw await createAppError(error, 'Nao foi possivel carregar os jobs de transcricao.')

  return ((data as TranscriptionJobRow[]) || []).map(mapTranscriptionJobRow)
}

export async function createTranscriptionJob(input: CreateTranscriptionJobInput) {
  const { data, error } = await supabase
    .from('transcription_jobs')
    .insert(mapTranscriptionJobInsert(input))
    .select()
    .single()

  if (error) throw await createAppError(error, 'Nao foi possivel registrar o job de transcricao.')
  return mapTranscriptionJobRow(data as TranscriptionJobRow)
}

export async function updateTranscriptionJob(id: string, input: UpdateTranscriptionJobInput) {
  const { data, error } = await supabase
    .from('transcription_jobs')
    .update(mapTranscriptionJobUpdate(input))
    .eq('id', id)
    .select()
    .single()

  if (error) throw await createAppError(error, 'Nao foi possivel atualizar o job de transcricao.')
  return mapTranscriptionJobRow(data as TranscriptionJobRow)
}

export async function transcribeChunk(input: {
  chunkId: string
  language?: string
  prompt?: string
  retry?: boolean
}) {
  const { data, error } = await supabase.functions.invoke<TranscribeChunkResult>('transcribe-chunk', {
    body: input,
  })

  if (error) throw await createAppError(error, 'Nao foi possivel transcrever este trecho agora.')
  if (!data) {
    throw new AppError({
      message: 'A transcricao nao retornou dados.',
      code: 'missing_data',
      status: null,
      details: null,
      raw: null,
    })
  }
  return data
}
