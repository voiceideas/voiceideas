import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAuthenticatedRequest } from '../_shared/auth.ts'
import { corsHeaders, getErrorMessage, jsonResponse } from '../_shared/http.ts'
import { materializeIdeaDraftFromTranscript } from '../_shared/openai.ts'
import { syncCaptureSessionProcessingStatus, updateAudioChunkQueueStatus } from '../_shared/pipeline.ts'

interface RequestBody {
  chunkId: string
  retry?: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await requireAuthenticatedRequest(req)
    if (!auth) {
      return jsonResponse({ error: 'Autenticacao obrigatoria para materializar a ideia.' }, 401)
    }

    const body = await req.json() as RequestBody
    if (!body.chunkId) {
      return jsonResponse({ error: 'chunkId e obrigatorio.' }, 400)
    }

    const { data: chunk, error: chunkError } = await auth.client
      .from('audio_chunks')
      .select('id, session_id, queue_status')
      .eq('id', body.chunkId)
      .eq('user_id', auth.user.id)
      .single()

    if (chunkError || !chunk) {
      return jsonResponse({ error: 'Chunk nao encontrado.' }, 404)
    }

    const { data: session, error: sessionError } = await auth.client
      .from('capture_sessions')
      .select('id, platform_source')
      .eq('id', chunk.session_id)
      .eq('user_id', auth.user.id)
      .single()

    if (sessionError || !session) {
      return jsonResponse({ error: 'Sessao de captura nao encontrada.' }, 404)
    }

    const { data: latestJob, error: jobError } = await auth.client
      .from('transcription_jobs')
      .select('id, transcript_text')
      .eq('chunk_id', chunk.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (jobError) {
      throw new Error(`Nao foi possivel ler o job de transcricao: ${jobError.message}`)
    }

    if (!latestJob?.transcript_text) {
      return jsonResponse({ error: 'Este chunk ainda nao possui transcricao concluida.' }, 400)
    }

    const { data: existingDraft, error: existingDraftError } = await auth.client
      .from('idea_drafts')
      .select('*')
      .eq('chunk_id', chunk.id)
      .eq('user_id', auth.user.id)
      .maybeSingle()

    if (existingDraftError) {
      throw new Error(`Nao foi possivel verificar draft existente: ${existingDraftError.message}`)
    }

    if (existingDraft && !body.retry) {
      return jsonResponse({
        created: false,
        draftId: existingDraft.id,
        status: existingDraft.status,
        suggestedTitle: existingDraft.suggested_title,
        suggestedTags: existingDraft.suggested_tags,
        suggestedFolder: existingDraft.suggested_folder,
      })
    }

    const materialized = await materializeIdeaDraftFromTranscript({
      transcriptText: latestJob.transcript_text,
      platformSource: session.platform_source,
    })

    let draftId = existingDraft?.id ?? null

    if (existingDraft) {
      const { error: updateDraftError } = await auth.client
        .from('idea_drafts')
        .update({
          transcript_text: latestJob.transcript_text,
          cleaned_text: materialized.cleanedText,
          suggested_title: materialized.suggestedTitle,
          suggested_tags: materialized.suggestedTags,
          suggested_folder: materialized.suggestedFolder,
          status: 'drafted',
        })
        .eq('id', existingDraft.id)

      if (updateDraftError) {
        throw new Error(`Nao foi possivel atualizar o draft: ${updateDraftError.message}`)
      }
    } else {
      const { data: createdDraft, error: createDraftError } = await auth.client
        .from('idea_drafts')
        .insert({
          user_id: auth.user.id,
          session_id: chunk.session_id,
          chunk_id: chunk.id,
          transcript_text: latestJob.transcript_text,
          cleaned_text: materialized.cleanedText,
          suggested_title: materialized.suggestedTitle,
          suggested_tags: materialized.suggestedTags,
          suggested_folder: materialized.suggestedFolder,
          status: 'drafted',
        })
        .select('id')
        .single()

      if (createDraftError || !createdDraft) {
        throw new Error(`Nao foi possivel criar o draft: ${createDraftError?.message || 'sem retorno'}`)
      }

      draftId = createdDraft.id
    }

    await updateAudioChunkQueueStatus(auth.client, chunk.id, 'materialized')
    const nextSessionStatus = await syncCaptureSessionProcessingStatus(auth.client, chunk.session_id)

    return jsonResponse({
      created: !existingDraft,
      draftId,
      status: 'drafted',
      sessionProcessingStatus: nextSessionStatus,
      cleanedText: materialized.cleanedText,
      suggestedTitle: materialized.suggestedTitle,
      suggestedTags: materialized.suggestedTags,
      suggestedFolder: materialized.suggestedFolder,
    }, existingDraft ? 200 : 201)
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500)
  }
})

