/**
 * ============================================================
 * LEGACY BRIDGE PATH — NÃO USAR PARA NOVOS FLUXOS
 * CAMINHO CANÔNICO = export-to-cenax + bridge-items
 * ============================================================
 * Endpoint de CONSUMO pelo Bardo via shared secret (x-bridge-secret).
 * Mantido porque o Bardo em produção ainda faz polling dessa rota.
 * Nenhum cliente do VoiceIdeas deve produzir dados novos por este
 * caminho — o caminho de produção canônico é export-to-cenax, que
 * escreve em bridge_exports já vinculado a bridge_items.
 *
 * Ver VOICEIDEAS_CURRENT_STATE.md §4.
 * ============================================================
 *
 * LEGACY BRIDGE CONSUMER ENDPOINT (isolated):
 * Kept only for backward compatibility with old Bardo polling integrations.
 * Canonical producer path for VoiceIdeas is bridge-items + export-to-cenax.
 *
 * Edge Function: bridge-exports
 *
 * API para o Bardo consumir exportações bridge do VoiceIdeas.
 * Thin wrapper: listagem com JOIN + blindagem terminal; marks via RPCs
 * transacionais (bridge_mark_imported / bridge_mark_rejected).
 *
 * Endpoints:
 *   GET  /bridge-exports?bardo_user_id=<id>[&email=<email>]
 *     → exige vínculo ativo em bardo_account_links;
 *       resolve vi_user_id via link e lista exports desse usuário VI.
 *       email (opcional) — usado apenas para cross-check de auditoria.
 *       blindagem: status='pending', destination='bardo', item não-terminal.
 *   POST /bridge-exports  body { action: 'mark_imported', ids: [uuid] }
 *   POST /bridge-exports  body { action: 'mark_rejected', ids: [uuid] }
 *
 * Toda a lógica editorial (preservação de terminal, reconciliação,
 * idempotência, guard de estado operacional) vive nas RPCs em SQL.
 * Esta EF é despacho puro.
 *
 * Autenticação:
 *   Header: x-bridge-secret: <BRIDGE_SHARED_SECRET>
 *   + parâmetro bardo_user_id na query (identidade explícita do Bardo).
 *   O email deixou de ser autorizado sozinho a partir de P1.3.
 *
 * Identidade (P1.3+):
 *   Email não é mais base de autorização. O endpoint exige vínculo
 *   ativo em public.bardo_account_links (bardo_user_id → vi_user_id).
 *   Sem vínculo → 403.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { getActiveBardoAccountLink } from '../_shared/bardo-account-link.ts'

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
  // ── DEBUG INBOX — instrumentação de observabilidade ──
  const reqId = crypto.randomUUID().slice(0, 8)
  const urlForLog = new URL(req.url)
  const queryParams: Record<string, string> = {}
  for (const [k, v] of urlForLog.searchParams.entries()) {
    queryParams[k] = v
  }
  console.log(`[bex ${reqId}] request received`, {
    method: req.method,
    pathname: urlForLog.pathname,
    query_keys: Object.keys(queryParams),
    query: queryParams,
    has_authorization: req.headers.has('authorization'),
    has_apikey: req.headers.has('apikey'),
    has_x_bridge_secret: req.headers.has('x-bridge-secret'),
    content_type: req.headers.get('content-type'),
    user_agent: req.headers.get('user-agent'),
  })

  // CORS preflight
  if (req.method === 'OPTIONS') {
    console.log(`[bex ${reqId}] CORS preflight -> 200`)
    return new Response('ok', { headers: corsHeaders })
  }

  // ── Auth: shared secret ──
  if (!bridgeSharedSecret) {
    console.log(`[bex ${reqId}] BRIDGE_SHARED_SECRET missing -> 503`)
    return jsonResponse({ error: 'Bridge not configured' }, 503)
  }

  const secret = req.headers.get('x-bridge-secret')?.trim()
  if (secret !== bridgeSharedSecret) {
    console.log(`[bex ${reqId}] auth failed -> 401`, {
      header_present: req.headers.has('x-bridge-secret'),
      received_length: secret?.length ?? 0,
    })
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.log(`[bex ${reqId}] supabase env missing -> 503`)
    return jsonResponse({ error: 'Supabase not configured' }, 503)
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
  const url = new URL(req.url)

  try {
    // ── GET /bridge-exports?bardo_user_id=<id>[&email=<email>] ──
    // Identidade (P1.3+):
    //   - Exige `bardo_user_id` na query.
    //   - Resolve vínculo ativo em bardo_account_links; sem vínculo → 403.
    //   - Filtra exports por owner_user_id do vínculo (não mais por email).
    //   - `email` é opcional e usado só para cross-check de auditoria.
    //
    // Blindagem editorial:
    //   - status='pending'
    //   - destination='bardo'
    //   - item NULL OU item.bridge_status NOT IN ('consumed','blocked')
    if (req.method === 'GET') {
      const bardoUserId = url.searchParams.get('bardo_user_id')?.trim()
      const email = url.searchParams.get('email')?.trim().toLowerCase() || null

      console.log(`[bex ${reqId}] GET branch`, {
        bardo_user_id_present: !!bardoUserId,
        bardo_user_id_length: bardoUserId?.length ?? 0,
        email_present: !!email,
        email_masked: email ? `${email.slice(0, 2)}…@${email.split('@')[1] ?? ''}` : null,
      })

      if (!bardoUserId) {
        console.log(`[bex ${reqId}] missing bardo_user_id -> 400 bardo_user_id_required`, {
          query_keys: Object.keys(queryParams),
        })
        return jsonResponse(
          {
            error: 'Missing bardo_user_id parameter',
            code: 'bardo_user_id_required',
          },
          400,
        )
      }

      // Resolve vínculo ativo — fonte de autoridade da identidade.
      const { data: link, error: linkError } = await getActiveBardoAccountLink(serviceClient, bardoUserId)

      if (linkError) {
        console.log(`[bex ${reqId}] link resolve error -> 500`, {
          error_message: linkError.message,
        })
        return jsonResponse({ error: linkError.message }, 500)
      }

      if (!link) {
        console.log(`[bex ${reqId}] no active link -> 403 account_link_required`)
        return jsonResponse(
          {
            error: 'No active VoiceIdeas account link for this bardo_user_id',
            code: 'account_link_required',
          },
          403,
        )
      }

      // Cross-check opcional: se o chamador enviou `email`, ele precisa
      // bater com o snapshot registrado no vínculo. Divergência é sinal
      // de relink silencioso / inconsistência de aceite; bloqueamos.
      if (email && link.bardo_email && link.bardo_email.trim().toLowerCase() !== email) {
        console.log(`[bex ${reqId}] email mismatch -> 403 account_link_email_mismatch`)
        return jsonResponse(
          {
            error: 'Email does not match active account link',
            code: 'account_link_email_mismatch',
          },
          403,
        )
      }

      // Ownership é indireta: bridge_exports NÃO tem owner_user_id.
      // Precisamos filtrar por vi_user_id via join no "dono" do conteúdo:
      //   content_type='note'           → notes.user_id
      //   content_type='organized_idea' → organized_ideas.user_id
      //   content_type='idea_draft'     → idea_drafts.user_id
      //
      // PostgREST não permite OR entre joins !inner de tabelas distintas,
      // então fazemos 3 SELECTs em paralelo e concatenamos no cliente.
      //
      // LEFT JOIN em bridge_items via select aninhado; a blindagem
      // terminal (exclui consumed/blocked) é aplicada em JS.
      const commonSelect = `
        id,
        payload,
        status,
        created_at,
        content_type,
        note_id,
        organized_idea_id,
        idea_draft_id,
        bridge_item_id,
        bridge_items:bridge_item_id ( bridge_status )
      `

      const [notesRes, organizedRes, draftsRes] = await Promise.all([
        serviceClient
          .from('bridge_exports')
          .select(`${commonSelect}, notes!inner ( user_id )`)
          .eq('content_type', 'note')
          .eq('status', 'pending')
          .eq('destination', 'bardo')
          .eq('notes.user_id', link.vi_user_id)
          .order('created_at', { ascending: true })
          .limit(50),
        serviceClient
          .from('bridge_exports')
          .select(`${commonSelect}, organized_ideas!inner ( user_id )`)
          .eq('content_type', 'organized_idea')
          .eq('status', 'pending')
          .eq('destination', 'bardo')
          .eq('organized_ideas.user_id', link.vi_user_id)
          .order('created_at', { ascending: true })
          .limit(50),
        serviceClient
          .from('bridge_exports')
          .select(`${commonSelect}, idea_drafts!inner ( user_id )`)
          .eq('content_type', 'idea_draft')
          .eq('status', 'pending')
          .eq('destination', 'bardo')
          .eq('idea_drafts.user_id', link.vi_user_id)
          .order('created_at', { ascending: true })
          .limit(50),
      ])

      const firstError = notesRes.error || organizedRes.error || draftsRes.error
      if (firstError) {
        console.log(`[bex ${reqId}] query error -> 500`, {
          error_message: firstError.message,
        })
        return jsonResponse({ error: firstError.message }, 500)
      }

      const combined = [
        ...(notesRes.data || []),
        ...(organizedRes.data || []),
        ...(draftsRes.data || []),
      ]

      // Blindagem terminal em JS: exclui items já consumed/blocked.
      const filtered = combined.filter((r: Record<string, unknown>) => {
        const bi = r.bridge_items as { bridge_status?: string } | null
        if (!bi) return true
        return bi.bridge_status !== 'consumed' && bi.bridge_status !== 'blocked'
      })

      // Ordena e aplica limite global de 50.
      filtered.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
        const ca = String(a.created_at || '')
        const cb = String(b.created_at || '')
        return ca.localeCompare(cb)
      })
      const limited = filtered.slice(0, 50)

      // Remove campos auxiliares de join — cliente não precisa.
      const cleaned = limited.map((r: Record<string, unknown>) => {
        const copy: Record<string, unknown> = { ...r }
        delete copy.bridge_items
        delete copy.notes
        delete copy.organized_ideas
        delete copy.idea_drafts
        return copy
      })

      console.log(`[bex ${reqId}] GET ok -> 200`, {
        returned_count: cleaned.length,
        raw_combined: combined.length,
        vi_user_id: link.vi_user_id,
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
