export interface Note {
  id: string
  user_id: string
  raw_text: string
  title: string | null
  folder_id: string | null
  source_capture_session_id: string | null
  source_audio_chunk_id: string | null
  created_at: string
}

export interface Folder {
  id: string
  user_id: string
  name: string
  created_at: string
  note_count?: number
}

export interface OrganizedIdea {
  id: string
  user_id: string
  note_ids: string[]
  type: 'topicos' | 'plano' | 'roteiro' | 'mapa'
  title: string
  tags: string[] | null
  content: OrganizedContent
  created_at: string
}

export interface OrganizedContent {
  sections: {
    title: string
    items: string[]
  }[]
  summary?: string
}

export type ShareRole = 'viewer'

export interface OrganizedIdeaShare {
  id: string
  source_idea_id: string
  owner_user_id: string
  created_at: string
}

export interface OrganizedIdeaShareInvite {
  id: string
  share_id: string
  invited_email: string
  role: ShareRole
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invited_by: string
  accepted_by: string | null
  accepted_at: string | null
  expires_at: string
  created_at: string
}

export interface OrganizedIdeaShareMember {
  id: string
  share_id: string
  user_id: string
  role: ShareRole
  invited_by: string | null
  invite_id: string | null
  created_at: string
}

export interface SharedOrganizedIdea extends OrganizedIdea {
  share_id: string
  shared_at: string
  shared_by_user_id: string
}

export interface UserProfile {
  id: string
  user_id: string
  daily_limit: number
  role: 'user' | 'admin'
  notes_used_today: number
  usage_date: string
  created_at: string
}

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

export type TranscriptionJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type IdeaDraftStatus = 'drafted' | 'reviewed' | 'exported' | 'failed'

export type BridgeExportDestination = 'cenax' | 'bardo'

export type BridgeExportStatus = 'pending' | 'exporting' | 'exported' | 'failed'

export interface CaptureSession {
  id: string
  user_id: string
  started_at: string
  ended_at: string | null
  status: CaptureSessionStatus
  provisional_folder_name: string
  final_folder_name: string | null
  rename_required: boolean
  processing_status: CaptureProcessingStatus
  platform_source: CapturePlatformSource
  raw_storage_path: string | null
  created_at: string
  updated_at: string
}

export interface AudioChunk {
  id: string
  session_id: string
  user_id: string
  storage_path: string
  start_ms: number
  end_ms: number
  duration_ms: number
  segmentation_reason: AudioChunkSegmentationReason
  queue_status: AudioChunkQueueStatus
  created_at: string
  updated_at: string
}

export interface TranscriptionJob {
  id: string
  chunk_id: string
  status: TranscriptionJobStatus
  transcript_text: string | null
  raw_response: Record<string, unknown> | null
  error: string | null
  created_at: string
  completed_at: string | null
}

export interface IdeaDraft {
  id: string
  user_id: string
  session_id: string
  chunk_id: string
  transcript_text: string
  cleaned_text: string | null
  suggested_title: string | null
  suggested_tags: string[]
  suggested_folder: string | null
  status: IdeaDraftStatus
  created_at: string
  updated_at: string
}

export interface BridgeExport {
  id: string
  idea_draft_id: string
  destination: BridgeExportDestination
  payload: Record<string, unknown>
  status: BridgeExportStatus
  error: string | null
  exported_at: string | null
  created_at: string
  updated_at: string
}

export type OrganizationType = OrganizedIdea['type']

export interface Database {
  public: {
    Tables: {
      notes: {
        Row: Note
        Insert: Omit<Note, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Note, 'id'>>
      }
      folders: {
        Row: Folder
        Insert: Omit<Folder, 'id' | 'created_at' | 'note_count'> & { id?: string; created_at?: string; note_count?: number }
        Update: Partial<Omit<Folder, 'id' | 'note_count'>>
      }
      user_profiles: {
        Row: UserProfile
        Insert: Omit<UserProfile, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<UserProfile, 'id'>>
      }
      capture_sessions: {
        Row: CaptureSession
        Insert: Omit<CaptureSession, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<CaptureSession, 'id' | 'user_id' | 'created_at'>>
      }
      audio_chunks: {
        Row: AudioChunk
        Insert: Omit<AudioChunk, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<AudioChunk, 'id' | 'user_id' | 'created_at'>>
      }
      transcription_jobs: {
        Row: TranscriptionJob
        Insert: Omit<TranscriptionJob, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<TranscriptionJob, 'id' | 'chunk_id' | 'created_at'>>
      }
      idea_drafts: {
        Row: IdeaDraft
        Insert: Omit<IdeaDraft, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<IdeaDraft, 'id' | 'user_id' | 'created_at'>>
      }
      bridge_exports: {
        Row: BridgeExport
        Insert: Omit<BridgeExport, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<BridgeExport, 'id' | 'idea_draft_id' | 'created_at'>>
      }
      organized_ideas: {
        Row: OrganizedIdea
        Insert: Omit<OrganizedIdea, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<OrganizedIdea, 'id'>>
      }
      organized_idea_shares: {
        Row: OrganizedIdeaShare
        Insert: Omit<OrganizedIdeaShare, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<OrganizedIdeaShare, 'id'>>
      }
      organized_idea_share_invites: {
        Row: OrganizedIdeaShareInvite
        Insert: Omit<OrganizedIdeaShareInvite, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<OrganizedIdeaShareInvite, 'id'>>
      }
      organized_idea_share_members: {
        Row: OrganizedIdeaShareMember
        Insert: Omit<OrganizedIdeaShareMember, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<OrganizedIdeaShareMember, 'id'>>
      }
    }
  }
}
