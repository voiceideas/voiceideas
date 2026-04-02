import type { AudioChunk, AudioChunkSegmentationReason } from './chunk'
import type { CaptureProcessingStatus } from './capture'

export interface VoiceSegmentationSettings {
  mediumSilenceMs: number
  longSilenceMs: number
  minChunkMs: number
  analysisWindowMs: number
  strongDelimiterPhrase: string
}

export type VoiceSegmentationStrategy = 'wav-silence' | 'single-pass'

export type SegmentedAudioChunkSummary = Pick<
  AudioChunk,
  'id' | 'storagePath' | 'startMs' | 'endMs' | 'durationMs' | 'segmentationReason' | 'queueStatus'
>

export interface SegmentCaptureSessionInput extends Partial<VoiceSegmentationSettings> {
  sessionId: string
  durationMs?: number
  startMs?: number
  fallbackSegmentationReason?: AudioChunkSegmentationReason
}

export interface SegmentCaptureSessionResult {
  sessionId: string
  created: boolean
  processingStatus: CaptureProcessingStatus
  strategy: VoiceSegmentationStrategy
  usedFallback: boolean
  strongDelimiterPrepared: boolean
  totalDurationMs: number
  settings: VoiceSegmentationSettings
  chunks: SegmentedAudioChunkSummary[]
}
