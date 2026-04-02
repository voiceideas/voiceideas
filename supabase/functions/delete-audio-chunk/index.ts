import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAuthenticatedRequest } from '../_shared/auth.ts'
import { corsHeaders, getErrorMessage, jsonResponse } from '../_shared/http.ts'
import { syncCaptureSessionProcessingStatus } from '../_shared/pipeline.ts'

interface RequestBody {
  chunkId: string
}

function uniqueStoragePaths(paths: Array<string | null | undefined>) {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await requireAuthenticatedRequest(req)
    if (!auth) {
      return jsonResponse({ error: 'Autenticacao obrigatoria para excluir o chunk.' }, 401)
    }

    const body = await req.json() as RequestBody
    if (!body.chunkId) {
      return jsonResponse({ error: 'chunkId e obrigatorio.' }, 400)
    }

    const { data: chunk, error: chunkError } = await auth.client
      .from('audio_chunks')
      .select('id, session_id, storage_path')
      .eq('id', body.chunkId)
      .eq('user_id', auth.user.id)
      .single()

    if (chunkError || !chunk) {
      return jsonResponse({ error: 'Chunk nao encontrado.' }, 404)
    }

    const [{ count: transcriptionJobCount, error: jobsError }, { data: draft, error: draftError }] = await Promise.all([
      auth.client
        .from('transcription_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('chunk_id', chunk.id),
      auth.client
        .from('idea_drafts')
        .select('id')
        .eq('chunk_id', chunk.id)
        .eq('user_id', auth.user.id)
        .maybeSingle(),
    ])

    if (jobsError) {
      throw new Error(`Nao foi possivel ler os jobs do chunk: ${jobsError.message}`)
    }

    if (draftError) {
      throw new Error(`Nao foi possivel ler o draft do chunk: ${draftError.message}`)
    }

    let exportCount = 0

    if (draft?.id) {
      const { count, error: exportError } = await auth.client
        .from('bridge_exports')
        .select('id', { count: 'exact', head: true })
        .eq('idea_draft_id', draft.id)

      if (exportError) {
        throw new Error(`Nao foi possivel ler os exports do chunk: ${exportError.message}`)
      }

      exportCount = count ?? 0
    }

    const storagePaths = uniqueStoragePaths([chunk.storage_path])
    if (storagePaths.length > 0) {
      const { error: storageError } = await auth.client.storage
        .from('voice-captures')
        .remove(storagePaths)

      if (storageError) {
        throw new Error(`Nao foi possivel remover o audio do chunk: ${storageError.message}`)
      }
    }

    const { error: deleteChunkError } = await auth.client
      .from('audio_chunks')
      .delete()
      .eq('id', chunk.id)
      .eq('user_id', auth.user.id)

    if (deleteChunkError) {
      throw new Error(`Nao foi possivel excluir o chunk: ${deleteChunkError.message}`)
    }

    const nextSessionStatus = await syncCaptureSessionProcessingStatus(auth.client, chunk.session_id)

    return jsonResponse({
      chunkId: chunk.id,
      sessionId: chunk.session_id,
      deleted: true,
      deletedJobCount: transcriptionJobCount ?? 0,
      deletedDraftId: draft?.id ?? null,
      deletedExportCount: exportCount,
      sessionProcessingStatus: nextSessionStatus,
    })
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500)
  }
})
