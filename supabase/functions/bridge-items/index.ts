import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAuthenticatedRequest } from '../_shared/auth.ts'
import { corsHeaders, jsonResponse } from '../_shared/http.ts'
import { syncEligibleBridgeItemsForUser } from '../_shared/bridge-items.ts'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function parseLimit(rawValue: string | null) {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT
  }

  return Math.min(MAX_LIMIT, Math.trunc(parsed))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  const auth = await requireAuthenticatedRequest(req)
  if (!auth) {
    return jsonResponse({ error: 'Autenticacao obrigatoria.' }, 401)
  }

  try {
    const url = new URL(req.url)
    const bridgeStatus = url.searchParams.get('bridge_status')
    const validationStatus = url.searchParams.get('validation_status')
    const destinationKind = url.searchParams.get('destination_kind')
    const contentType = url.searchParams.get('content_type')
    const shouldSync = url.searchParams.get('sync') !== '0'
    const limit = parseLimit(url.searchParams.get('limit'))

    let syncSummary: Awaited<ReturnType<typeof syncEligibleBridgeItemsForUser>> | null = null
    if (shouldSync) {
      syncSummary = await syncEligibleBridgeItemsForUser(auth.client, auth.user.id)
    }

    let query = auth.client
      .from('bridge_items')
      .select(`
        id,
        source_type,
        source_id,
        source_capture_session_id,
        source_session_mode,
        content_type,
        domain,
        scope_type,
        title,
        summary,
        content,
        payload,
        validation_status,
        validation_issues,
        bridge_status,
        destination_kind,
        destination_candidates,
        published_at,
        consumed_at,
        created_at,
        updated_at
      `)
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (bridgeStatus) {
      query = query.eq('bridge_status', bridgeStatus)
    }

    if (validationStatus) {
      query = query.eq('validation_status', validationStatus)
    }

    if (destinationKind) {
      query = query.eq('destination_kind', destinationKind)
    }

    if (contentType) {
      query = query.eq('content_type', contentType)
    }

    const { data, error } = await query
    if (error) {
      throw new Error(`Nao foi possivel listar bridge_items: ${error.message}`)
    }

    return jsonResponse({
      items: data ?? [],
      count: data?.length ?? 0,
      sync: syncSummary,
    })
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Falha ao listar bridge_items.',
    }, 500)
  }
})
