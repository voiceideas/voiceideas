/**
 * Edge Function: bridge-exports
 *
 * API para o Bardo consumir exportações bridge do VoiceIdeas.
 * Chamada pelo Bardo via Edge Function proxy com BRIDGE_SHARED_SECRET.
 *
 * Endpoints:
 *   GET  /bridge-exports?email=<email>  → lista exports pendentes para o email
 *   POST /bridge-exports/mark           → marca export como fetched
 *
 * Autenticação:
 *   Header: x-bridge-secret: <BRIDGE_SHARED_SECRET>
 *   O Bardo extrai o email do JWT do seu próprio usuário e chama
 *   esta função com o email como parâmetro — nunca com JWT do VI.
 *
 * Owner email: normalizado com trim().toLowerCase() — regra do reviewer.
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
    // Lista exports pendentes para o email normalizado.
    if (req.method === 'GET') {
      const email = url.searchParams.get('email')?.trim().toLowerCase()
      if (!email) {
        return jsonResponse({ error: 'Missing email parameter' }, 400)
      }

      const { data, error } = await serviceClient
        .from('bridge_exports')
        .select('id, payload, content_hash, status, created_at')
        .eq('owner_email', email)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(50)

      if (error) {
        return jsonResponse({ error: error.message }, 500)
      }

      return jsonResponse({ exports: data || [], count: data?.length || 0 })
    }

    // ── POST /bridge-exports (body: { action, ids }) ──
    // Marca exports como fetched.
    if (req.method === 'POST') {
      const body = await req.json()

      if (body.action === 'mark_fetched') {
        const ids: string[] = body.ids
        if (!Array.isArray(ids) || ids.length === 0) {
          return jsonResponse({ error: 'Missing or empty ids array' }, 400)
        }

        const { error } = await serviceClient
          .from('bridge_exports')
          .update({ status: 'fetched', fetched_at: new Date().toISOString() })
          .in('id', ids)
          .eq('status', 'pending') // só atualiza pendentes

        if (error) {
          return jsonResponse({ error: error.message }, 500)
        }

        return jsonResponse({ success: true, marked: ids.length })
      }

      return jsonResponse({ error: 'Unknown action' }, 400)
    }

    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return jsonResponse({ error: message }, 500)
  }
})
