import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAuthenticatedRequest } from '../_shared/auth.ts'
import { buildChunkAudioFile, planAudioSegmentation } from '../_shared/audio-segmentation.ts'
import { corsHeaders, getErrorMessage, jsonResponse } from '../_shared/http.ts'
import { updateCaptureSessionProcessingStatus } from '../_shared/pipeline.ts'

interface RequestBody {
  sessionId: string
  durationMs?: number
  startMs?: number
  fallbackSegmentationReason?:
    | 'strong-delimiter'
    | 'probable-silence'
    | 'structural-silence'
    | 'session-end'
    | 'manual-stop'
    | 'single-pass'
    | 'fallback'
    | 'unknown'
  mediumSilenceMs?: number
  longSilenceMs?: number
  minChunkMs?: number
  analysisWindowMs?: number
  strongDelimiterPhrase?: string | null
}

const CAPTURE_BUCKET = 'voice-captures'

function buildChunkStoragePath(userId: string, sessionId: string, chunkId: string) {
  return `${userId}/sessions/${sessionId}/chunks/${chunkId}.wav`
}

function inferDurationFromSession(startedAt?: string | null, endedAt?: string | null) {
  if (!startedAt || !endedAt) {
    return 0
  }

  const startedTime = new Date(startedAt).getTime()
  const endedTime = new Date(endedAt).getTime()

  if (Number.isNaN(startedTime) || Number.isNaN(endedTime) || endedTime <= startedTime) {
    return 0
  }

  return endedTime - startedTime
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let authContext: Awaited<ReturnType<typeof requireAuthenticatedRequest>> | null = null
  let sessionId: string | null = null

  try {
    const auth = await requireAuthenticatedRequest(req)
    authContext = auth
    if (!auth) {
      return jsonResponse({ error: 'Autenticacao obrigatoria para segmentar a captura.' }, 401)
    }

    const body = await req.json() as RequestBody
    if (!body.sessionId) {
      return jsonResponse({ error: 'sessionId e obrigatorio.' }, 400)
    }

    sessionId = body.sessionId

    const { data: session, error: sessionError } = await auth.client
      .from('capture_sessions')
      .select('id, raw_storage_path, processing_status, started_at, ended_at')
      .eq('id', body.sessionId)
      .eq('user_id', auth.user.id)
      .single()

    if (sessionError || !session) {
      return jsonResponse({ error: 'Sessao de captura nao encontrada.' }, 404)
    }

    if (!session.raw_storage_path) {
      return jsonResponse({ error: 'A sessao ainda nao possui audio bruto associado.' }, 400)
    }

    const { data: existingChunks, error: existingChunksError } = await auth.client
      .from('audio_chunks')
      .select('id, start_ms, end_ms, duration_ms, segmentation_reason, queue_status, storage_path')
      .eq('session_id', body.sessionId)
      .order('start_ms', { ascending: true })

    if (existingChunksError) {
      throw new Error(`Nao foi possivel ler os chunks existentes: ${existingChunksError.message}`)
    }

    if ((existingChunks || []).length > 0) {
      const usedFallback = existingChunks.length === 1
        && ['single-pass', 'fallback'].includes(existingChunks[0].segmentation_reason)

      return jsonResponse({
        sessionId: body.sessionId,
        created: false,
        processingStatus: session.processing_status,
        strategy: existingChunks.length > 1 ? 'wav-silence' : 'single-pass',
        usedFallback,
        strongDelimiterPrepared: Boolean(body.strongDelimiterPhrase?.trim()),
        totalDurationMs: body.durationMs ?? inferDurationFromSession(session.started_at, session.ended_at),
        settings: {
          mediumSilenceMs: body.mediumSilenceMs ?? 800,
          longSilenceMs: body.longSilenceMs ?? 1800,
          minChunkMs: body.minChunkMs ?? 4000,
          analysisWindowMs: body.analysisWindowMs ?? 150,
          strongDelimiterPhrase: body.strongDelimiterPhrase?.trim() || '',
        },
        chunks: existingChunks,
      })
    }

    await updateCaptureSessionProcessingStatus(auth.client, body.sessionId, 'segmenting')

    const inferredDurationMs = Number.isFinite(body.durationMs) && (body.durationMs || 0) > 0
      ? Math.floor(body.durationMs as number)
      : inferDurationFromSession(session.started_at, session.ended_at)

    if (inferredDurationMs <= 0) {
      return jsonResponse({ error: 'Nao foi possivel inferir a duracao da sessao para segmentar o audio.' }, 400)
    }

    const { data: rawFile, error: rawFileError } = await auth.client.storage
      .from(CAPTURE_BUCKET)
      .download(session.raw_storage_path)

    if (rawFileError || !rawFile) {
      throw new Error(`Nao foi possivel baixar o audio bruto da sessao: ${rawFileError?.message || 'arquivo ausente'}`)
    }

    const audioBuffer = await rawFile.arrayBuffer()
    const segmentation = planAudioSegmentation(audioBuffer, inferredDurationMs, {
      mediumSilenceMs: body.mediumSilenceMs,
      longSilenceMs: body.longSilenceMs,
      minChunkMs: body.minChunkMs,
      analysisWindowMs: body.analysisWindowMs,
      strongDelimiterPhrase: body.strongDelimiterPhrase,
    })

    const uploadedChunkPaths: string[] = []
    let chunkRows: Array<{
      id: string
      session_id: string
      user_id: string
      storage_path: string
      start_ms: number
      end_ms: number
      duration_ms: number
      segmentation_reason: RequestBody['fallbackSegmentationReason']
      queue_status: 'awaiting-transcription'
    }> = []

    const createFallbackChunk = (reason: RequestBody['fallbackSegmentationReason']) => {
      const startMs = Math.max(0, Math.floor(body.startMs ?? 0))
      const endMs = startMs + segmentation.totalDurationMs

      chunkRows = [{
        id: crypto.randomUUID(),
        session_id: body.sessionId,
        user_id: auth.user.id,
        storage_path: session.raw_storage_path,
        start_ms: startMs,
        end_ms: endMs,
        duration_ms: segmentation.totalDurationMs,
        segmentation_reason: reason,
        queue_status: 'awaiting-transcription',
      }]
    }

    if (segmentation.strategy === 'wav-silence' && segmentation.segments.length > 1) {
      for (const segment of segmentation.segments) {
        const chunkId = crypto.randomUUID()
        const storagePath = buildChunkStoragePath(auth.user.id, body.sessionId, chunkId)
        const chunkAudioFile = buildChunkAudioFile(audioBuffer, segment)

        if (!chunkAudioFile) {
          createFallbackChunk('fallback')
          break
        }

        const { error: uploadChunkError } = await auth.client.storage
          .from(CAPTURE_BUCKET)
          .upload(storagePath, chunkAudioFile, {
            upsert: true,
            contentType: 'audio/wav',
          })

        if (uploadChunkError) {
          createFallbackChunk('fallback')
          break
        }

        uploadedChunkPaths.push(storagePath)
        chunkRows.push({
          id: chunkId,
          session_id: body.sessionId,
          user_id: auth.user.id,
          storage_path: storagePath,
          start_ms: segment.startMs,
          end_ms: segment.endMs,
          duration_ms: segment.durationMs,
          segmentation_reason: segment.segmentationReason,
          queue_status: 'awaiting-transcription',
        })
      }
    }

    if (!chunkRows.length) {
      createFallbackChunk(body.fallbackSegmentationReason ?? 'single-pass')
    }

    if (chunkRows.length === 1 && chunkRows[0].storage_path === session.raw_storage_path) {
      for (const uploadedChunkPath of uploadedChunkPaths) {
        await auth.client.storage.from(CAPTURE_BUCKET).remove([uploadedChunkPath]).catch(() => null)
      }
    }

    const { data: chunks, error: insertError } = await auth.client
      .from('audio_chunks')
      .insert(chunkRows)
      .select('id, start_ms, end_ms, duration_ms, segmentation_reason, queue_status, storage_path')

    if (insertError || !chunks) {
      for (const uploadedChunkPath of uploadedChunkPaths) {
        await auth.client.storage.from(CAPTURE_BUCKET).remove([uploadedChunkPath]).catch(() => null)
      }
      throw new Error(`Nao foi possivel criar os chunks da sessao: ${insertError?.message || 'sem retorno do banco'}`)
    }

    await updateCaptureSessionProcessingStatus(auth.client, body.sessionId, 'awaiting-transcription')

    return jsonResponse({
      sessionId: body.sessionId,
      created: true,
      processingStatus: 'awaiting-transcription',
      strategy: chunkRows.length > 1 ? segmentation.strategy : 'single-pass',
      usedFallback: segmentation.usedFallback || chunkRows.length === 1,
      strongDelimiterPrepared: segmentation.strongDelimiterPrepared,
      totalDurationMs: segmentation.totalDurationMs,
      settings: {
        ...segmentation.settings,
        strongDelimiterPhrase: segmentation.settings.strongDelimiterPhrase || '',
      },
      chunks,
    }, 201)
  } catch (error) {
    if (authContext && sessionId) {
      await updateCaptureSessionProcessingStatus(authContext.client, sessionId, 'failed').catch(() => null)
    }

    return jsonResponse({ error: getErrorMessage(error) }, 500)
  }
})
