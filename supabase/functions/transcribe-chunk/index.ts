import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAuthenticatedRequest } from '../_shared/auth.ts'
import { corsHeaders, getErrorMessage, jsonResponse } from '../_shared/http.ts'
import { syncCaptureSessionProcessingStatus, updateAudioChunkQueueStatus, updateCaptureSessionProcessingStatus } from '../_shared/pipeline.ts'
import { transcribeAudioFile } from '../_shared/openai.ts'

interface RequestBody {
  chunkId: string
  language?: string
  prompt?: string
  retry?: boolean
}

async function waitForChunkVisibility(
  client: Awaited<ReturnType<typeof requireAuthenticatedRequest>>["client"],
  userId: string,
  chunkId: string,
  attempts = 4,
  delayMs = 750,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data: chunk, error } = await client
      .from("audio_chunks")
      .select("id, session_id, storage_path, queue_status")
      .eq("id", chunkId)
      .eq("user_id", userId)
      .maybeSingle()

    if (error) {
      throw new Error("Nao foi possivel ler o chunk: " + error.message)
    }

    if (chunk) {
      return chunk
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let jobId: string | null = null
  let chunkId: string | null = null
  let sessionId: string | null = null

  try {
    const auth = await requireAuthenticatedRequest(req)
    if (!auth) {
      return jsonResponse({ error: 'Autenticacao obrigatoria para transcrever chunk.' }, 401)
    }

    const body = await req.json() as RequestBody
    if (!body.chunkId) {
      return jsonResponse({ error: 'chunkId e obrigatorio.' }, 400)
    }

    chunkId = body.chunkId

    const chunk = await waitForChunkVisibility(auth.client, auth.user.id, body.chunkId)
    if (!chunk) {
      return jsonResponse({ error: 'Chunk nao encontrado.' }, 404)
    }

    sessionId = chunk.session_id

    const { data: jobs, error: jobsError } = await auth.client
      .from('transcription_jobs')
      .select('id, status, transcript_text, created_at')
      .eq('chunk_id', chunk.id)
      .order('created_at', { ascending: false })

    if (jobsError) {
      throw new Error(`Nao foi possivel ler os jobs de transcricao: ${jobsError.message}`)
    }

    const activeJob = (jobs || []).find((job) => job.status === 'pending' || job.status === 'processing')
    if (activeJob) {
      return jsonResponse({
        error: 'Ja existe uma transcricao em andamento para este chunk.',
        chunkId: chunk.id,
        jobId: activeJob.id,
      }, 409)
    }

    const latestCompletedJob = (jobs || []).find((job) => job.status === 'completed')
    if (latestCompletedJob && !body.retry) {
      return jsonResponse({
        chunkId: chunk.id,
        jobId: latestCompletedJob.id,
        status: 'completed',
        transcriptText: latestCompletedJob.transcript_text,
        reused: true,
      })
    }

    const { data: createdJob, error: createJobError } = await auth.client
      .from('transcription_jobs')
      .insert({
        chunk_id: chunk.id,
        status: 'processing',
        transcript_text: null,
        raw_response: null,
        error: null,
      })
      .select('id')
      .single()

    if (createJobError || !createdJob) {
      throw new Error(`Nao foi possivel criar o job de transcricao: ${createJobError?.message || 'sem retorno'}`)
    }

    jobId = createdJob.id

    await updateAudioChunkQueueStatus(auth.client, chunk.id, 'transcribing')
    await updateCaptureSessionProcessingStatus(auth.client, chunk.session_id, 'transcribing')

    const { data: audioBlob, error: downloadError } = await auth.client.storage
      .from('voice-captures')
      .download(chunk.storage_path)

    if (downloadError || !audioBlob) {
      throw new Error(`Nao foi possivel baixar o audio do chunk: ${downloadError?.message || 'blob ausente'}`)
    }

    const fileName = chunk.storage_path.split('/').pop() || `${chunk.id}.webm`
    const audioFile = new File([audioBlob], fileName, {
      type: audioBlob.type || 'audio/webm',
    })

    const transcription = await transcribeAudioFile(audioFile, {
      language: body.language,
      prompt: body.prompt,
    })

    const { error: completeJobError } = await auth.client
      .from('transcription_jobs')
      .update({
        status: 'completed',
        transcript_text: transcription.text,
        raw_response: transcription.rawResponse,
        error: null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', createdJob.id)

    if (completeJobError) {
      throw new Error(`Nao foi possivel concluir o job de transcricao: ${completeJobError.message}`)
    }

    await updateAudioChunkQueueStatus(auth.client, chunk.id, 'transcribed')
    const nextSessionStatus = await syncCaptureSessionProcessingStatus(auth.client, chunk.session_id)

    return jsonResponse({
      chunkId: chunk.id,
      jobId: createdJob.id,
      status: 'completed',
      sessionProcessingStatus: nextSessionStatus,
      transcriptText: transcription.text,
    })
  } catch (error) {
    if (jobId) {
      const auth = await requireAuthenticatedRequest(req)
      if (auth) {
        await auth.client
          .from('transcription_jobs')
          .update({
            status: 'failed',
            error: getErrorMessage(error),
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId)

        if (chunkId) {
          await updateAudioChunkQueueStatus(auth.client, chunkId, 'failed').catch(() => null)
        }

        if (sessionId) {
          await syncCaptureSessionProcessingStatus(auth.client, sessionId).catch(() => null)
        }
      }
    }

    return jsonResponse({ error: getErrorMessage(error), chunkId, jobId }, 500)
  }
})

