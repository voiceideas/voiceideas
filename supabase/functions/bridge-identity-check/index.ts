/**
 * Edge Function: bridge-identity-check
 *
 * Probe app-to-app que o Bardo usa para perguntar ao VoiceIdeas se um
 * determinado email pertence a uma conta existente e se essa conta tem
 * o email confirmado. É chamado ANTES de qualquer fluxo de vínculo:
 *
 *   - Sem conta → Bardo vai para estado `no_matching_account`.
 *   - Conta existe e verificada → Bardo vai para `connected`.
 *   - Conta existe mas não verificada → Bardo vai para `unverified`.
 *
 * Contrato:
 *   POST /functions/v1/bridge-identity-check
 *   Headers:
 *     x-bridge-secret: <BRIDGE_SHARED_SECRET>
 *     Content-Type: application/json
 *   Body:
 *     { "email": "user@example.com" }
 *   Response (200):
 *     { "match": boolean, "verified": boolean }
 *
 * Autorização:
 *   Auth app-to-app via shared secret. NÃO usa JWT do usuário VI.
 *   verify_jwt=false no config.toml; a EF valida o secret por conta própria.
 *
 * Privacidade:
 *   Resposta é deliberadamente mínima: dois booleans. NÃO retorna user_id,
 *   email normalizado, timestamps, papel, nada. A SQL helper
 *   public.bridge_identity_probe_by_email também só devolve esses dois
 *   campos — o segredo de inexistência/verificação não precisa vazar para
 *   o Bardo e qualquer campo extra seria risco de enumeração.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const bridgeSharedSecret = Deno.env.get('BRIDGE_SHARED_SECRET') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bridge-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!bridgeSharedSecret) {
    // Infra: secret não injetado no ambiente da function.
    return jsonResponse({ error: 'Bridge not configured' }, 503)
  }

  const secret = req.headers.get('x-bridge-secret')?.trim()
  if (!secret || secret !== bridgeSharedSecret) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse({ error: 'Supabase not configured' }, 503)
  }

  let rawEmail: unknown
  try {
    const body = await req.json()
    rawEmail = body?.email
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof rawEmail !== 'string') {
    return jsonResponse({ error: 'Missing or invalid email' }, 400)
  }

  const email = rawEmail.trim().toLowerCase()
  if (!email) {
    // Email vazio após trim — responde match/verified=false sem consultar DB.
    return jsonResponse({ match: false, verified: false })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  try {
    const { data, error } = await serviceClient.rpc('bridge_identity_probe_by_email', {
      p_email: email,
    })

    if (error) {
      return jsonResponse({ error: error.message }, 500)
    }

    // A RPC retorna um SETOF; pegamos a primeira linha.
    const row = Array.isArray(data) ? data[0] : data
    const match = Boolean(row?.match)
    const verified = Boolean(row?.verified)

    return jsonResponse({ match, verified })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return jsonResponse({ error: message }, 500)
  }
})
