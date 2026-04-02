export type IdeaDraftStatus = 'drafted' | 'reviewed' | 'exported' | 'failed'

export interface IdeaDraft {
  id: string
  userId: string
  sessionId: string
  chunkId: string
  transcriptText: string
  cleanedText: string | null
  suggestedTitle: string | null
  suggestedTags: string[]
  suggestedFolder: string | null
  status: IdeaDraftStatus
  createdAt: string
  updatedAt: string
}

export interface CreateIdeaDraftInput {
  sessionId: string
  chunkId: string
  transcriptText: string
  cleanedText?: string | null
  suggestedTitle?: string | null
  suggestedTags?: string[]
  suggestedFolder?: string | null
  status?: IdeaDraftStatus
}

export interface UpdateIdeaDraftInput {
  transcriptText?: string
  cleanedText?: string | null
  suggestedTitle?: string | null
  suggestedTags?: string[]
  suggestedFolder?: string | null
  status?: IdeaDraftStatus
}

export interface IdeaDraftFilters {
  sessionId?: string
  chunkId?: string
  status?: IdeaDraftStatus
  limit?: number
}

