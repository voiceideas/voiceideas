import { supabase } from '../lib/supabase'
import { AppError, createAppError } from '../lib/errors'
import { invokeAuthenticatedFunction } from '../lib/functionAuth'
import { requireAuthenticatedUserId } from './serviceAuth'
import type { Database } from '../types/database'
import type { CreateIdeaDraftInput, IdeaDraft, IdeaDraftFilters, UpdateIdeaDraftInput } from '../types/ideaDraft'

type IdeaDraftRow = Database['public']['Tables']['idea_drafts']['Row']
type IdeaDraftInsert = Database['public']['Tables']['idea_drafts']['Insert']
type IdeaDraftUpdate = Database['public']['Tables']['idea_drafts']['Update']

export interface MaterializeIdeaResult {
  created: boolean
  draftId: string
  status: IdeaDraft['status']
  sessionProcessingStatus?: Database['public']['Tables']['capture_sessions']['Row']['processing_status']
  cleanedText?: string | null
  suggestedTitle?: string | null
  suggestedTags?: string[]
  suggestedFolder?: string | null
}

function mapIdeaDraftRow(row: IdeaDraftRow): IdeaDraft {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    chunkId: row.chunk_id,
    transcriptText: row.transcript_text,
    cleanedText: row.cleaned_text,
    suggestedTitle: row.suggested_title,
    suggestedTags: row.suggested_tags,
    suggestedFolder: row.suggested_folder,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapIdeaDraftInsert(userId: string, input: CreateIdeaDraftInput): IdeaDraftInsert {
  return {
    user_id: userId,
    session_id: input.sessionId,
    chunk_id: input.chunkId,
    transcript_text: input.transcriptText,
    cleaned_text: input.cleanedText ?? null,
    suggested_title: input.suggestedTitle ?? null,
    suggested_tags: input.suggestedTags ?? [],
    suggested_folder: input.suggestedFolder ?? null,
    status: input.status ?? 'drafted',
  }
}

function mapIdeaDraftUpdate(input: UpdateIdeaDraftInput): IdeaDraftUpdate {
  return {
    transcript_text: input.transcriptText,
    cleaned_text: input.cleanedText,
    suggested_title: input.suggestedTitle,
    suggested_tags: input.suggestedTags,
    suggested_folder: input.suggestedFolder,
    status: input.status,
  }
}

export async function listIdeaDrafts(filters: IdeaDraftFilters = {}) {
  const userId = await requireAuthenticatedUserId()

  let query = supabase
    .from('idea_drafts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (filters.sessionId) {
    query = query.eq('session_id', filters.sessionId)
  }

  if (filters.chunkId) {
    query = query.eq('chunk_id', filters.chunkId)
  }

  if (filters.status) {
    query = query.eq('status', filters.status)
  }

  if (filters.limit) {
    query = query.limit(filters.limit)
  }

  const { data, error } = await query
  if (error) throw await createAppError(error, 'Nao foi possivel carregar os rascunhos da fila.')

  return ((data as IdeaDraftRow[]) || []).map(mapIdeaDraftRow)
}

export async function createIdeaDraft(input: CreateIdeaDraftInput) {
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('idea_drafts')
    .insert(mapIdeaDraftInsert(userId, input))
    .select()
    .single()

  if (error) throw await createAppError(error, 'Nao foi possivel criar este rascunho.')
  return mapIdeaDraftRow(data as IdeaDraftRow)
}

export async function updateIdeaDraft(id: string, input: UpdateIdeaDraftInput) {
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('idea_drafts')
    .update(mapIdeaDraftUpdate(input))
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw await createAppError(error, 'Nao foi possivel atualizar este rascunho.')
  return mapIdeaDraftRow(data as IdeaDraftRow)
}

export async function materializeIdea(input: {
  chunkId: string
  retry?: boolean
}) {
  const { data, error } = await invokeAuthenticatedFunction<MaterializeIdeaResult>('materialize-idea', {
    body: input,
  })

  if (error) throw await createAppError(error, 'Nao foi possivel gerar o rascunho agora.')
  if (!data) {
    throw new AppError({
      message: 'A materializacao nao retornou dados.',
      code: 'missing_data',
      status: null,
      details: null,
      raw: null,
    })
  }
  return data
}
