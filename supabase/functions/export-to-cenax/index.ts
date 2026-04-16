import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAuthenticatedRequest } from '../_shared/auth.ts'
import {
  resolveNoteBridgeExport,
  resolveOrganizedIdeaBridgeExport,
  type BridgeExportContentType,
  type BridgeExportEnvelope,
} from '../_shared/bridge-export.ts'
import {
  markBridgeItemPublished,
  syncBridgeItemFromResolvedContent,
} from '../_shared/bridge-items.ts'
import { corsHeaders, getErrorMessage, jsonResponse } from '../_shared/http.ts'
import { syncCaptureSessionProcessingStatus, updateAudioChunkQueueStatus, updateIdeaDraftStatus } from '../_shared/pipeline.ts'

const CENAX_BRIDGE_URL = Deno.env.get('CENAX_BRIDGE_URL') || ''
const BARDO_BRIDGE_URL = Deno.env.get('BARDO_BRIDGE_URL') || ''

type LegacyBridgeExportDestination = 'cenax' | 'bardo'
type LegacyBridgeExportStatus = 'pending' | 'exporting' | 'exported' | 'failed'

interface RequestBody {
  ideaDraftId?: string
  noteId?: string
  organizedIdeaId?: string
  contentType?: BridgeExportContentType | 'idea_draft'
  destination: LegacyBridgeExportDestination
  retry?: boolean
  validateOnly?: boolean
}

function resolveRequestedContentType(body: RequestBody) {
  if (body.contentType) {
    return body.contentType
  }

  if (body.noteId) return 'note'
  if (body.organizedIdeaId) return 'organized_idea'
  return 'idea_draft'
}

function buildTargetFilter(contentType: BridgeExportContentType | 'idea_draft', contentId: string) {
  if (contentType === 'note') {
    return { content_type: 'note', note_id: contentId }
  }

  if (contentType === 'organized_idea') {
    return { content_type: 'organized_idea', organized_idea_id: contentId }
  }

  return { content_type: 'idea_draft', idea_draft_id: contentId }
}

function getTargetUrl(destination: LegacyBridgeExportDestination) {
  return destination === 'cenax' ? CENAX_BRIDGE_URL : BARDO_BRIDGE_URL
}

function extractPreviewTargetResponse(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed.slice(0, 500)
  }
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
      return jsonResponse({ error: 'Autenticacao obrigatoria para exportar.' }, 401)
    }

    const body = await req.json() as RequestBody
    const contentType = resolveRequestedContentType(body)

    if (!body.destination) {
      return jsonResponse({ error: 'destination e obrigatorio.' }, 400)
    }

    if (contentType === 'note' || contentType === 'organized_idea') {
      if (body.destination !== 'bardo') {
        return jsonResponse({
          error: 'A bridge v1 de captura segura exporta apenas para o Bardo.',
        }, 400)
      }

      const contentId = contentType === 'note' ? body.noteId : body.organizedIdeaId
      if (!contentId) {
        return jsonResponse({
          error: contentType === 'note'
            ? 'noteId e obrigatorio.'
            : 'organizedIdeaId e obrigatorio.',
        }, 400)
      }

      const resolved = contentType === 'note'
        ? await resolveNoteBridgeExport(auth.client, auth.user.id, contentId, body.destination)
        : await resolveOrganizedIdeaBridgeExport(auth.client, auth.user.id, contentId, body.destination)
      const bridgeItemSync = await syncBridgeItemFromResolvedContent(auth.client, auth.user.id, resolved)

      if (body.validateOnly) {
        return jsonResponse({
          bridgeItemId: bridgeItemSync.bridgeItemId,
          eligibility: resolved.eligibility,
          payload: resolved.envelope,
        }, resolved.eligibility.eligible ? 200 : 409)
      }

      const targetFilter = buildTargetFilter(contentType, contentId)
      const { data: existingExports, error: existingExportsError } = await auth.client
        .from('bridge_exports')
        .select('*')
        .match({
          ...targetFilter,
          destination: body.destination,
        })
        .order('created_at', { ascending: false })

      if (existingExportsError) {
        throw new Error(`Nao foi possivel ler exportacoes existentes: ${existingExportsError.message}`)
      }

      const latestExport = (existingExports || [])[0]
      if (latestExport && !body.retry && latestExport.status !== 'failed') {
        return jsonResponse({
          exportId: latestExport.id,
          bridgeItemId: latestExport.bridge_item_id ?? bridgeItemSync.bridgeItemId,
          status: latestExport.status,
          dispatched: latestExport.status === 'exported',
          destination: body.destination,
          reused: true,
          eligibility: resolved.eligibility,
          payload: latestExport.payload as BridgeExportEnvelope,
        })
      }

      if (!resolved.eligibility.eligible) {
        const { data: blockedExport, error: blockedExportError } = await auth.client
          .from('bridge_exports')
          .insert({
            ...targetFilter,
            bridge_item_id: bridgeItemSync.bridgeItemId,
            destination: body.destination,
            payload: resolved.envelope,
            status: 'failed',
            validation_status: 'blocked',
            validation_issues: resolved.eligibility.validationIssues,
            error: resolved.eligibility.reason,
            exported_at: null,
          })
          .select('id')
          .single()

        if (blockedExportError || !blockedExport) {
          throw new Error(`Nao foi possivel registrar o bloqueio da exportacao: ${blockedExportError?.message || 'sem retorno'}`)
        }

        return jsonResponse({
          error: resolved.eligibility.reason,
          exportId: blockedExport.id,
          bridgeItemId: bridgeItemSync.bridgeItemId,
          status: 'failed',
          dispatched: false,
          destination: body.destination,
          eligibility: resolved.eligibility,
          payload: resolved.envelope,
        }, 409)
      }

      const { data: createdExport, error: createExportError } = await auth.client
        .from('bridge_exports')
        .insert({
          ...targetFilter,
          bridge_item_id: bridgeItemSync.bridgeItemId,
          destination: body.destination,
          payload: resolved.envelope,
          status: 'pending',
          validation_status: 'valid',
          validation_issues: [],
          error: null,
          exported_at: null,
        })
        .select('id')
        .single()

      if (createExportError || !createdExport) {
        throw new Error(`Nao foi possivel registrar a exportacao: ${createExportError?.message || 'sem retorno'}`)
      }

      exportId = createdExport.id

      const targetUrl = getTargetUrl(body.destination)
      if (!targetUrl) {
        return jsonResponse({
          exportId,
          bridgeItemId: bridgeItemSync.bridgeItemId,
          status: 'pending',
          dispatched: false,
          auditOnly: true,
          destination: body.destination,
          eligibility: resolved.eligibility,
          payload: resolved.envelope,
        }, 202)
      }

      const { error: markExportingError } = await auth.client
        .from('bridge_exports')
        .update({
          status: 'exporting',
          payload: resolved.envelope,
          error: null,
          validation_status: 'valid',
          validation_issues: [],
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
        body: JSON.stringify(resolved.envelope.deliveryPayload),
      })
      const responseText = await response.text()
      const targetResponsePreview = extractPreviewTargetResponse(responseText)

      if (!response.ok) {
        await auth.client
          .from('bridge_exports')
          .update({
            status: 'failed',
            error: `Bridge dispatch failed: ${response.status} - ${responseText}`,
          })
          .eq('id', exportId)

        return jsonResponse({
          error: `Falha ao enviar payload para ${body.destination}.`,
          exportId,
          bridgeItemId: bridgeItemSync.bridgeItemId,
          destination: body.destination,
          eligibility: resolved.eligibility,
          targetStatus: response.status,
          targetResponse: targetResponsePreview,
        }, 502)
      }

      await auth.client
        .from('bridge_exports')
        .update({
          status: 'exported',
          payload: resolved.envelope,
          error: null,
          exported_at: new Date().toISOString(),
          validation_status: 'valid',
          validation_issues: [],
        })
        .eq('id', exportId)

      if (bridgeItemSync.bridgeItemId) {
        await markBridgeItemPublished(auth.client, bridgeItemSync.bridgeItemId)
      }

      exportDispatched = true

      return jsonResponse({
        exportId,
        bridgeItemId: bridgeItemSync.bridgeItemId,
        status: 'exported',
        dispatched: true,
        auditOnly: false,
        destination: body.destination,
        eligibility: resolved.eligibility,
        payload: resolved.envelope,
        targetStatus: response.status,
        targetResponse: targetResponsePreview,
      })
    }

    if (!body.ideaDraftId) {
      return jsonResponse({ error: 'ideaDraftId e obrigatorio.' }, 400)
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

    if (draft.status === 'failed') {
      return jsonResponse({
        error: 'Este rascunho falhou antes do envio. Gere novamente antes de tentar enviar.',
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
      .match({
        content_type: 'idea_draft',
        idea_draft_id: draft.id,
        destination: body.destination,
      })
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
          content_type: 'idea_draft',
          idea_draft_id: draft.id,
          destination: body.destination,
          payload,
          status: 'pending',
          validation_status: 'valid',
          validation_issues: [],
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

    const targetUrl = getTargetUrl(body.destination)
    if (!targetUrl) {
      return jsonResponse({
        exportId,
        status: 'pending' as LegacyBridgeExportStatus,
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
        validation_status: 'valid',
        validation_issues: [],
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
        validation_status: 'valid',
        validation_issues: [],
      })
      .eq('id', exportId)

    exportDispatched = true
    await updateIdeaDraftStatus(auth.client, draft.id, 'exported')
    await updateAudioChunkQueueStatus(auth.client, chunk.id, 'ready')
    const nextSessionStatus = await syncCaptureSessionProcessingStatus(auth.client, session.id)

    return jsonResponse({
      exportId,
      status: 'exported' as LegacyBridgeExportStatus,
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
