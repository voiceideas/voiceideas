import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAuthenticatedRequest } from '../_shared/auth.ts'
import { corsHeaders, getErrorMessage, jsonResponse } from '../_shared/http.ts'
import { syncCaptureSessionProcessingStatus, updateAudioChunkQueueStatus, updateIdeaDraftStatus } from '../_shared/pipeline.ts'

const CENAX_BRIDGE_URL = Deno.env.get('CENAX_BRIDGE_URL') || ''
const BARDO_BRIDGE_URL = Deno.env.get('BARDO_BRIDGE_URL') || ''

interface RequestBody {
  ideaDraftId: string
  destination: 'cenax' | 'bardo'
  retry?: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let authContext: Awaited<ReturnType<typeof requireAuthenticatedRequest>> | null = null
  let exportId: string | null = null
  let exportDispatched = false

  try {
    const auth = await requireAuthenticatedRequest(req)
    authContext = auth
    if (!auth) {
      return jsonResponse({ error: 'Autenticacao obrigatoria para exportar o draft.' }, 401)
    }

    const body = await req.json() as RequestBody
    if (!body.ideaDraftId || !body.destination) {
      return jsonResponse({ error: 'ideaDraftId e destination sao obrigatorios.' }, 400)
    }

    const { data: draft, error: draftError } = await auth.client
      .from('idea_drafts')
      .select('*')
      .eq('id', body.ideaDraftId)
      .eq('user_id', auth.user.id)
      .single()

    if (draftError || !draft) {
      return jsonResponse({ error: 'Draft nao encontrado.' }, 404)
    }

    if (draft.status !== 'reviewed' && draft.status !== 'exported') {
      return jsonResponse({
        error: 'Revise o draft antes de enviar para Bardo.',
      }, 409)
    }

    const { data: chunk, error: chunkError } = await auth.client
      .from('audio_chunks')
      .select('id, session_id, storage_path')
      .eq('id', draft.chunk_id)
      .eq('user_id', auth.user.id)
      .single()

    if (chunkError || !chunk) {
      return jsonResponse({ error: 'Chunk do draft nao encontrado.' }, 404)
    }

    const { data: session, error: sessionError } = await auth.client
      .from('capture_sessions')
      .select('id, platform_source, provisional_folder_name, final_folder_name')
      .eq('id', draft.session_id)
      .eq('user_id', auth.user.id)
      .single()

    if (sessionError || !session) {
      return jsonResponse({ error: 'Sessao do draft nao encontrada.' }, 404)
    }

    const { data: signedAudioUrl } = await auth.client.storage
      .from('voice-captures')
      .createSignedUrl(chunk.storage_path, 60 * 60)

    const payload = {
      source: 'voiceideas' as const,
      source_session_id: session.id,
      source_chunk_id: chunk.id,
      platform_source: session.platform_source,
      title: draft.suggested_title || 'Ideia sem titulo',
      text: draft.cleaned_text || draft.transcript_text,
      raw_text: draft.transcript_text,
      tags: draft.suggested_tags || [],
      folder: draft.suggested_folder || session.final_folder_name || session.provisional_folder_name || null,
      audio_url: signedAudioUrl?.signedUrl ?? null,
      confidence: null,
      created_at: draft.created_at,
      destination: body.destination,
    }

    const { data: existingExports, error: existingExportsError } = await auth.client
      .from('bridge_exports')
      .select('*')
      .eq('idea_draft_id', draft.id)
      .eq('destination', body.destination)
      .order('created_at', { ascending: false })

    if (existingExportsError) {
      throw new Error(`Nao foi possivel ler exportacoes existentes: ${existingExportsError.message}`)
    }

    const latestExport = (existingExports || [])[0]
    if (latestExport && !body.retry) {
      return jsonResponse({
        exportId: latestExport.id,
        status: latestExport.status,
        dispatched: latestExport.status === 'exported',
        destination: body.destination,
        reused: true,
      })
    }

    exportId = latestExport?.id ?? null

    if (!latestExport || latestExport.status === 'failed' || latestExport.status === 'exported') {
      const { data: createdExport, error: createExportError } = await auth.client
        .from('bridge_exports')
        .insert({
          idea_draft_id: draft.id,
          destination: body.destination,
          payload,
          status: 'pending',
          error: null,
          exported_at: null,
        })
        .select('id')
        .single()

      if (createExportError || !createdExport) {
        throw new Error(`Nao foi possivel registrar a exportacao: ${createExportError?.message || 'sem retorno'}`)
      }

      exportId = createdExport.id
    }

    const targetUrl = body.destination === 'cenax' ? CENAX_BRIDGE_URL : BARDO_BRIDGE_URL
    if (!targetUrl) {
      return jsonResponse({
        exportId,
        status: 'pending',
        dispatched: false,
        auditOnly: true,
        destination: body.destination,
        payload,
      }, 202)
    }

    const { error: markExportingError } = await auth.client
      .from('bridge_exports')
      .update({
        status: 'exporting',
        payload,
        error: null,
      })
      .eq('id', exportId)

    if (markExportingError) {
      throw new Error(`Nao foi possivel marcar a exportacao como em andamento: ${markExportingError.message}`)
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()

      await auth.client
        .from('bridge_exports')
        .update({
          status: 'failed',
          error: `Bridge dispatch failed: ${response.status} - ${errorText}`,
        })
        .eq('id', exportId)

      return jsonResponse({
        error: `Falha ao enviar payload para ${body.destination}.`,
        exportId,
        destination: body.destination,
      }, 502)
    }

    await auth.client
      .from('bridge_exports')
      .update({
        status: 'exported',
        payload,
        error: null,
        exported_at: new Date().toISOString(),
      })
      .eq('id', exportId)

    exportDispatched = true
    await updateIdeaDraftStatus(auth.client, draft.id, 'exported')
    await updateAudioChunkQueueStatus(auth.client, chunk.id, 'ready')
    const nextSessionStatus = await syncCaptureSessionProcessingStatus(auth.client, session.id)

    return jsonResponse({
      exportId,
      status: 'exported',
      dispatched: true,
      auditOnly: false,
      destination: body.destination,
      payload,
      sessionProcessingStatus: nextSessionStatus,
    })
  } catch (error) {
    if (authContext && exportId && !exportDispatched) {
      await authContext.client
        .from('bridge_exports')
        .update({
          status: 'failed',
          error: getErrorMessage(error),
        })
        .eq('id', exportId)
        .catch(() => null)
    }

    return jsonResponse({ error: getErrorMessage(error) }, 500)
  }
})
