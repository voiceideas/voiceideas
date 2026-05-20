/**
 * VI_QUEUE_TRIAGE_UX_PHASE_1 (2026-05-20)
 *
 * Tipos auxiliares compartilhados entre os componentes de fila extraídos
 * do `src/pages/CaptureQueue.tsx`. Mantidos em arquivo dedicado para
 * que cada componente filho receba contratos explícitos sem ciclos de
 * import.
 */

import type { AudioChunk } from '../../types/chunk'

export type ChunkTranscriptionStatus =
  | 'awaiting-transcription'
  | 'transcribing'
  | 'transcribed'
  | 'failed'

export type TranscriptionJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface ChunkTranscriptionJobLike {
  status: TranscriptionJobStatus
  createdAt: string
  completedAt: string | null
  transcriptText?: string | null
  error?: string | null
}

export interface ChunkTranscriptionStateLike {
  status: ChunkTranscriptionStatus
  canRetry: boolean
  canReuseCompleted: boolean
  latestJob?: ChunkTranscriptionJobLike | null
  latestCompletedJob?: ChunkTranscriptionJobLike | null
  activeJob?: ChunkTranscriptionJobLike | null
}

export type NoteSaveState =
  | 'waiting-transcription'
  | 'ready-to-save'
  | 'saving'
  | 'saved'

export interface QueueActionKeys {
  segment: string
  rename: string
  deleteSession: string
  transcribe: (chunk: AudioChunk) => string
  saveNote: (chunk: AudioChunk) => string
  deleteChunk: (chunk: AudioChunk) => string
}
