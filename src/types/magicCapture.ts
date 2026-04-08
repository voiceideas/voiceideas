import type { Note, OrganizedIdea } from './database'
import type { SegmentedAudioChunkSummary } from './segmentation'

export type CaptureMagicMode = 'magic' | 'raw'

export interface CaptureMagicProgress {
  phase: 'segmenting' | 'transcribing' | 'saving-notes' | 'grouping' | 'completed'
  label: string
  current?: number
  total?: number
}

export interface CaptureMagicSkippedChunk {
  chunkId: string
  reason: 'empty-transcript' | 'limit-reached'
  message: string
}

export interface CaptureMagicFailedChunk {
  chunkId: string
  stage: 'transcribe' | 'save-note'
  message: string
}

export interface CaptureMagicResult {
  sessionId: string
  mode: CaptureMagicMode
  chunks: SegmentedAudioChunkSummary[]
  notes: Note[]
  createdNotesCount: number
  existingNotesCount: number
  groupedIdeas: OrganizedIdea[]
  fallbackChunkCount: number
  reusedTranscriptionsCount: number
  skippedChunks: CaptureMagicSkippedChunk[]
  failedChunks: CaptureMagicFailedChunk[]
  groupingError: string | null
  singlePass: boolean
}

export interface CaptureMagicState {
  status: 'idle' | 'running' | 'success' | 'error'
  mode: CaptureMagicMode | null
  sessionId: string | null
  progress: CaptureMagicProgress | null
  result: CaptureMagicResult | null
  error: string | null
}

export const idleCaptureMagicState: CaptureMagicState = {
  status: 'idle',
  mode: null,
  sessionId: null,
  progress: null,
  result: null,
  error: null,
}
