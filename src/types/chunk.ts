import type { CaptureProcessingStatus } from './capture'

export type AudioChunkSegmentationReason =
  | 'strong-delimiter'
  | 'probable-silence'
  | 'structural-silence'
  | 'session-end'
  | 'manual-stop'
  | 'single-pass'
  | 'fallback'
  | 'unknown'

export type AudioChunkQueueStatus = CaptureProcessingStatus

export interface AudioChunk {
  id: string
  sessionId: string
  userId: string
  storagePath: string
  startMs: number
  endMs: number
  durationMs: number
  segmentationReason: AudioChunkSegmentationReason
  queueStatus: AudioChunkQueueStatus
  createdAt: string
  updatedAt: string
}

export interface CreateAudioChunkInput {
  sessionId: string
  storagePath: string
  startMs: number
  endMs: number
  durationMs?: number
  segmentationReason: AudioChunkSegmentationReason
  queueStatus?: AudioChunkQueueStatus
}

export interface UpdateAudioChunkInput {
  storagePath?: string
  startMs?: number
  endMs?: number
  durationMs?: number
  segmentationReason?: AudioChunkSegmentationReason
  queueStatus?: AudioChunkQueueStatus
}

export interface AudioChunkFilters {
  sessionId?: string
  queueStatus?: AudioChunkQueueStatus
  limit?: number
}

