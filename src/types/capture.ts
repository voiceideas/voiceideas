export type CapturePlatformSource = 'web' | 'macos' | 'android' | 'ios'

export type CaptureSessionStatus = 'active' | 'completed' | 'cancelled' | 'failed'

export type CaptureProcessingStatus =
  | 'captured'
  | 'awaiting-segmentation'
  | 'segmenting'
  | 'segmented'
  | 'awaiting-transcription'
  | 'transcribing'
  | 'transcribed'
  | 'materialized'
  | 'ready'
  | 'failed'

export interface CaptureSession {
  id: string
  userId: string
  startedAt: string
  endedAt: string | null
  status: CaptureSessionStatus
  provisionalFolderName: string
  finalFolderName: string | null
  renameRequired: boolean
  processingStatus: CaptureProcessingStatus
  platformSource: CapturePlatformSource
  rawStoragePath: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateCaptureSessionInput {
  startedAt?: string
  endedAt?: string | null
  status?: CaptureSessionStatus
  provisionalFolderName?: string
  finalFolderName?: string | null
  renameRequired?: boolean
  processingStatus?: CaptureProcessingStatus
  platformSource: CapturePlatformSource
  rawStoragePath?: string | null
}

export interface UpdateCaptureSessionInput {
  endedAt?: string | null
  status?: CaptureSessionStatus
  provisionalFolderName?: string
  finalFolderName?: string | null
  renameRequired?: boolean
  processingStatus?: CaptureProcessingStatus
  rawStoragePath?: string | null
}

export interface CaptureSessionFilters {
  status?: CaptureSessionStatus
  processingStatus?: CaptureProcessingStatus
  renameRequired?: boolean
  limit?: number
}

