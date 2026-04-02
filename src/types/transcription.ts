export type TranscriptionJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type ChunkTranscriptionRuntimeStatus =
  | 'awaiting-transcription'
  | 'transcribing'
  | 'transcribed'
  | 'failed'

export interface TranscriptionJob {
  id: string
  chunkId: string
  status: TranscriptionJobStatus
  transcriptText: string | null
  rawResponse: Record<string, unknown> | null
  error: string | null
  createdAt: string
  completedAt: string | null
}

export interface CreateTranscriptionJobInput {
  chunkId: string
  status?: TranscriptionJobStatus
  transcriptText?: string | null
  rawResponse?: Record<string, unknown> | null
  error?: string | null
  completedAt?: string | null
}

export interface UpdateTranscriptionJobInput {
  status?: TranscriptionJobStatus
  transcriptText?: string | null
  rawResponse?: Record<string, unknown> | null
  error?: string | null
  completedAt?: string | null
}

export interface TranscriptionJobFilters {
  chunkId?: string
  sessionId?: string
  status?: TranscriptionJobStatus
  limit?: number
}

export interface ChunkTranscriptionState {
  chunkId: string
  status: ChunkTranscriptionRuntimeStatus
  latestJob: TranscriptionJob | null
  activeJob: TranscriptionJob | null
  latestCompletedJob: TranscriptionJob | null
  latestFailedJob: TranscriptionJob | null
  canStart: boolean
  canRetry: boolean
  canReuseCompleted: boolean
}
