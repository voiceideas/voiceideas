/**
 * Edge Function: bridge-exports
 *
 * API para o Bardo consumir exportações bridge do VoiceIdeas.
 * Thin wrapper: listagem com JOIN + blindagem terminal; marks via RPCs
 * transacionais (bridge_mark_imported / bridge_mark_rejected).
 *
 * Endpoints:
 *   GET  /bridge-exports?email=<email>
 *     → lista exports pendentes para o email normalizado;
 *       blindagem: status='pending', destination='bardo', item não-terminal
 *   POST /bridge-exports  body { action: 'mark_imported', ids: [uuid] }
 *   POST /bridge-exports  body { action: 'mark_rejected', ids: [uuid] }
 *
 * Toda a lógica editorial (preservação de terminal, reconciliação,
 * idempotência, guard de estado operacional) vive nas RPCs em SQL.
 * Esta EF é despacho puro.
 *
 * Autenticação:
 *   Header: x-bridge-secret: <BRIDGE_SHARED_SECRET>
 *   O Bardo extrai o email do JWT do seu próprio usuário e chama
 *   esta função com o email como parâmetro — nunca com JWT do VI.
 *
 * Owner email: normalizado com trim().toLowerCase().
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const bridgeSharedSecret = Deno.env.get('BRIDGE_SHARED_SECRET') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bridge-secret',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ── Auth: shared secret ──
  if (!bridgeSharedSecret) {
    return jsonResponse({ error: 'Bridge not configured' }, 503)
  }

  const secret = req.headers.get('x-bridge-secret')?.trim()
  if (secret !== bridgeSharedSecret) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse({ error: 'Supabase not configured' }, 503)
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
  const url = new URL(req.url)

  try {
    // ── GET /bridge-exports?email=<email> ──
    // Listagem blindada:
    //   - status='pending'
    //   - destination='bardo'
    //   - item NULL OU item.bridge_status NOT IN ('consumed','blocked')
    if (req.method === 'GET') {
      const email = url.searchParams.get('email')?.trim().toLowerCase()
      if (!email) {
        return jsonResponse({ error: 'Missing email parameter' }, 400)
      }

      // LEFT JOIN via select aninhado do PostgREST; o filtro terminal
      // do item é aplicado em JS porque o PostgREST não combina
      // "bridge_items.is.null OR ..." numa única query simples.
      const { data, error } = await serviceClient
        .from('bridge_exports')
        .select(`
          id,
          payload,
          content_hash,
          status,
          created_at,
          bridge_item_id,
          bridge_items:bridge_item_id ( bridge_status )
        `)
        .eq('owner_email', email)
        .eq('status', 'pending')
        .eq('destination', 'bardo')
        .order('created_at', { ascending: true })
        .limit(50)

      if (error) {
        return jsonResponse({ error: error.message }, 500)
      }

      // Blindagem terminal em JS: exclui items já consumed/blocked.
      const rows = (data || []).filter((r: Record<string, unknown>) => {
        const bi = r.bridge_items as { bridge_status?: string } | null
        if (!bi) return true
        return bi.bridge_status !== 'consumed' && bi.bridge_status !== 'blocked'
      })

      // Remover campo auxiliar `bridge_items` do retorno — cliente não precisa.
      const cleaned = rows.map((r: Record<string, unknown>) => {
        const copy: Record<string, unknown> = { ...r }
        delete copy.bridge_items
        return copy
      })

      return jsonResponse({ exports: cleaned, count: cleaned.length })
    }

    // ── POST /bridge-exports ──
    // Dispatch puro para RPC transacional. Toda semântica (atomicidade,
    // preservação de terminal, idempotência, guard operacional) vive em SQL.
    if (req.method === 'POST') {
      const body = await req.json()
      const action = body?.action
      const ids: unknown = body?.ids

      if (action !== 'mark_imported' && action !== 'mark_rejected') {
        return jsonResponse({ error: 'Unknown action' }, 400)
      }
      if (!Array.isArray(ids) || ids.length === 0) {
        return jsonResponse({ error: 'Missing or empty ids array' }, 400)
      }

      const rpcName = action === 'mark_imported' ? 'bridge_mark_imported' : 'bridge_mark_rejected'

      type RpcRow = {
        marked: number
        export_status: string | null
        item_status: string | null
        terminal_preserved: string | null
      }

      const results: Array<{ id: string } & RpcRow> = []
      for (const rawId of ids) {
        if (typeof rawId !== 'string') continue
        const { data, error } = await serviceClient.rpc(rpcName, {
          p_bridge_export_id: rawId,
        })
        if (error) {
          return jsonResponse({ error: error.message }, 500)
        }
        const row = Array.isArray(data) ? (data[0] as RpcRow) : (data as RpcRow)
        results.push({
          id: rawId,
          marked: row?.marked ?? 0,
          export_status: row?.export_status ?? null,
          item_status: row?.item_status ?? null,
          terminal_preserved: row?.terminal_preserved ?? null,
        })
      }

      const totalMarked = results.reduce((acc, r) => acc + (r.marked || 0), 0)
      return jsonResponse({
        success: true,
        marked: totalMarked,
        status: action === 'mark_imported' ? 'imported' : 'rejected',
        results,
      })
    }

    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return jsonResponse({ error: message }, 500)
  }
})
