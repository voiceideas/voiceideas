import type { CapturePlatformSource } from './capture'

export type BridgeExportDestination = 'cenax' | 'bardo'
export type BridgeExportStatus = 'pending' | 'exporting' | 'exported' | 'failed'

export interface IdeaBridgePayload {
  source: 'voiceideas'
  sourceSessionId: string
  sourceChunkId: string
  platformSource: CapturePlatformSource
  title: string
  text: string
  rawText: string
  tags: string[]
  folder: string | null
  audioUrl: string | null
  confidence: number | null
  createdAt: string
  destination: BridgeExportDestination
}

export interface PersistedIdeaBridgePayload {
  source: 'voiceideas'
  source_session_id: string
  source_chunk_id: string
  platform_source: CapturePlatformSource
  title: string
  text: string
  raw_text: string
  tags: string[]
  folder: string | null
  audio_url: string | null
  confidence: number | null
  created_at: string
  destination: BridgeExportDestination
}

export interface BridgeExport {
  id: string
  ideaDraftId: string
  destination: BridgeExportDestination
  payload: IdeaBridgePayload
  status: BridgeExportStatus
  error: string | null
  exportedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateBridgeExportInput {
  ideaDraftId: string
  destination: BridgeExportDestination
  payload: IdeaBridgePayload
  status?: BridgeExportStatus
  error?: string | null
  exportedAt?: string | null
}

export interface UpdateBridgeExportInput {
  payload?: IdeaBridgePayload
  status?: BridgeExportStatus
  error?: string | null
  exportedAt?: string | null
}

export interface BridgeExportFilters {
  ideaDraftId?: string
  destination?: BridgeExportDestination
  status?: BridgeExportStatus
  limit?: number
}
