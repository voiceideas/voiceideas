import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { requireAuthenticatedRequest } from '../_shared/auth.ts'
import { corsHeaders, getErrorMessage, jsonResponse } from '../_shared/http.ts'

interface RequestBody {
  sessionId: string
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

function uniqueStoragePaths(paths: Array<string | null | undefined>) {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}

function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service role environment is not configured')
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await requireAuthenticatedRequest(req)
    if (!auth) {
      return jsonResponse({ error: 'Autenticacao obrigatoria para excluir a sessao.' }, 401)
    }

    const body = await req.json() as RequestBody
    if (!body.sessionId) {
      return jsonResponse({ error: 'sessionId e obrigatorio.' }, 400)
    }

    const admin = createAdminClient()

    const { data: session, error: sessionError } = await auth.client
      .from('capture_sessions')
      .select('id, user_id, raw_storage_path')
      .eq('id', body.sessionId)
      .eq('user_id', auth.user.id)
      .single()

    if (sessionError || !session) {
      return jsonResponse({ error: 'Sessao nao encontrada.' }, 404)
    }

    const { data: chunks, error: chunksError } = await admin
      .from('audio_chunks')
      .select('id, storage_path')
      .eq('session_id', session.id)
      .eq('user_id', auth.user.id)

    if (chunksError) {
      throw new Error(`Nao foi possivel ler os chunks da sessao: ${chunksError.message}`)
    }

    const chunkIds = (chunks || []).map((chunk) => chunk.id)

    let transcriptionJobCount = 0
    if (chunkIds.length > 0) {
      const { count, error: jobsError } = await admin
        .from('transcription_jobs')
        .select('id', { count: 'exact', head: true })
        .in('chunk_id', chunkIds)

      if (jobsError) {
        throw new Error(`Nao foi possivel ler os jobs da sessao: ${jobsError.message}`)
      }

      transcriptionJobCount = count ?? 0
    }

    const { data: drafts, error: draftsError } = await admin
      .from('idea_drafts')
      .select('id')
      .eq('session_id', session.id)
      .eq('user_id', auth.user.id)

    if (draftsError) {
      throw new Error(`Nao foi possivel ler os drafts da sessao: ${draftsError.message}`)
    }

    const draftIds = (drafts || []).map((draft) => draft.id)

    let exportCount = 0
    if (draftIds.length > 0) {
      const { count, error: exportError } = await admin
        .from('bridge_exports')
        .select('id', { count: 'exact', head: true })
        .in('idea_draft_id', draftIds)

      if (exportError) {
        throw new Error(`Nao foi possivel ler os exports da sessao: ${exportError.message}`)
      }

      exportCount = count ?? 0
    }

    const storagePaths = uniqueStoragePaths([
      session.raw_storage_path,
      ...(chunks || []).map((chunk) => chunk.storage_path),
    ])

    if (storagePaths.length > 0) {
      const { error: storageError } = await admin.storage
        .from('voice-captures')
        .remove(storagePaths)

      if (storageError) {
        throw new Error(`Nao foi possivel remover os arquivos da sessao: ${storageError.message}`)
      }
    }

    const { data: deletedSession, error: deleteSessionError } = await admin
      .from('capture_sessions')
      .delete()
      .eq('id', session.id)
      .eq('user_id', auth.user.id)
      .select('id')
      .maybeSingle()

    if (deleteSessionError) {
      throw new Error(`Nao foi possivel excluir a sessao: ${deleteSessionError.message}`)
    }

    if (!deletedSession?.id) {
      throw new Error('Nao foi possivel confirmar a exclusao da sessao.')
    }

    return jsonResponse({
      sessionId: session.id,
      deleted: true,
      deletedChunkCount: chunkIds.length,
      deletedJobCount: transcriptionJobCount,
      deletedDraftCount: draftIds.length,
      deletedExportCount: exportCount,
    })
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500)
  }
})
