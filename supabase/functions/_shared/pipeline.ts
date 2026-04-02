import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const captureProcessingStatuses = [
  'captured',
  'awaiting-segmentation',
  'segmenting',
  'segmented',
  'awaiting-transcription',
  'transcribing',
  'transcribed',
  'materialized',
  'ready',
  'failed',
] as const

export const chunkQueueStatuses = captureProcessingStatuses

export type CaptureProcessingStatus = typeof captureProcessingStatuses[number]
export type ChunkQueueStatus = typeof chunkQueueStatuses[number]

export async function updateCaptureSessionProcessingStatus(
  client: SupabaseClient,
  sessionId: string,
  status: CaptureProcessingStatus,
) {
  const { error } = await client
    .from('capture_sessions')
    .update({ processing_status: status })
    .eq('id', sessionId)

  if (error) {
    throw new Error(`Nao foi possivel atualizar o status da sessao: ${error.message}`)
  }

  return status
}

export async function updateAudioChunkQueueStatus(
  client: SupabaseClient,
  chunkId: string,
  status: ChunkQueueStatus,
) {
  const { error } = await client
    .from('audio_chunks')
    .update({ queue_status: status })
    .eq('id', chunkId)

  if (error) {
    throw new Error(`Nao foi possivel atualizar o status do chunk: ${error.message}`)
  }

  return status
}

export async function updateIdeaDraftStatus(
  client: SupabaseClient,
  draftId: string,
  status: 'drafted' | 'reviewed' | 'exported' | 'failed',
) {
  const { error } = await client
    .from('idea_drafts')
    .update({ status })
    .eq('id', draftId)

  if (error) {
    throw new Error(`Nao foi possivel atualizar o status do draft: ${error.message}`)
  }

  return status
}

function resolveCaptureSessionProcessingStatus(statuses: ChunkQueueStatus[]): CaptureProcessingStatus {
  if (statuses.length === 0) return 'awaiting-segmentation'
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('segmenting')) return 'segmenting'
  if (statuses.includes('captured') || statuses.includes('awaiting-segmentation')) return 'awaiting-segmentation'
  if (statuses.includes('transcribing')) return 'transcribing'
  if (statuses.includes('awaiting-transcription')) return 'awaiting-transcription'
  if (statuses.includes('segmented')) return 'segmented'
  if (statuses.every((status) => status === 'ready')) return 'ready'
  if (statuses.every((status) => status === 'ready' || status === 'materialized')) return 'materialized'
  if (statuses.every((status) => status === 'ready' || status === 'materialized' || status === 'transcribed')) {
    return statuses.includes('transcribed') ? 'transcribed' : 'materialized'
  }
  return 'segmented'
}

export async function syncCaptureSessionProcessingStatus(client: SupabaseClient, sessionId: string) {
  const { data, error } = await client
    .from('audio_chunks')
    .select('queue_status')
    .eq('session_id', sessionId)

  if (error) {
    throw new Error(`Nao foi possivel ler os chunks da sessao: ${error.message}`)
  }

  const statuses = ((data || []) as Array<{ queue_status: ChunkQueueStatus }>).map((item) => item.queue_status)
  const nextStatus = resolveCaptureSessionProcessingStatus(statuses)
  await updateCaptureSessionProcessingStatus(client, sessionId, nextStatus)
  return nextStatus
}

