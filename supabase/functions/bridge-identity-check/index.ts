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

// DEBUG P1.5 — digest parcial do secret SEM revelar o valor. Permite comparar
// o secret enviado pelo Bardo com o secret instalado no VI remoto via 8 hex
// chars de SHA-256. Colisão de 8 hex = 2^-32, suficiente para bater/não-bater.
async function shortSha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex.slice(0, 8)
}

function maskEmail(email: string): string {
  if (!email) return '(empty)'
  const at = email.indexOf('@')
  if (at < 0) return `${email.slice(0, 2)}…(no @)`
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const maskedLocal = local.length <= 2 ? local : `${local.slice(0, 2)}…(${local.length})`
  return `${maskedLocal}@${domain}`
}

Deno.serve(async (req) => {
  // ── DEBUG P1.5.DEBUG: instrumentação de observabilidade ──
  const reqId = crypto.randomUUID().slice(0, 8)
  console.log(`[bic ${reqId}] request received`, {
    method: req.method,
    url: req.url,
    has_authorization: req.headers.has('authorization'),
    has_apikey: req.headers.has('apikey'),
    has_x_bridge_secret: req.headers.has('x-bridge-secret'),
    content_type: req.headers.get('content-type'),
    user_agent: req.headers.get('user-agent'),
  })

  if (req.method === 'OPTIONS') {
    console.log(`[bic ${reqId}] CORS preflight -> 200`)
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    console.log(`[bic ${reqId}] wrong method -> 405`, { method: req.method })
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!bridgeSharedSecret) {
    console.log(`[bic ${reqId}] BRIDGE_SHARED_SECRET missing in env -> 503`)
    return jsonResponse({ error: 'Bridge not configured' }, 503)
  }

  const secretRaw = req.headers.get('x-bridge-secret')
  const secret = secretRaw?.trim()

  // Compara por digest — dá pra bater visualmente com o digest do secret do
  // Bardo sem revelar valor. Se prefixos forem iguais, secrets são iguais.
  const expectedDigest = await shortSha256Hex(bridgeSharedSecret)
  const receivedDigest = secret ? await shortSha256Hex(secret) : null

  console.log(`[bic ${reqId}] secret check`, {
    header_present: !!secretRaw,
    received_length: secret?.length ?? 0,
    expected_length: bridgeSharedSecret.length,
    received_digest8: receivedDigest,
    expected_digest8: expectedDigest,
    match: secret === bridgeSharedSecret,
  })

  if (!secret || secret !== bridgeSharedSecret) {
    console.log(`[bic ${reqId}] auth failed -> 401`)
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.log(`[bic ${reqId}] supabase env missing -> 503`)
    return jsonResponse({ error: 'Supabase not configured' }, 503)
  }

  let rawEmail: unknown
  let bodyText: string | null = null
  try {
    bodyText = await req.text()
    const body = bodyText ? JSON.parse(bodyText) : {}
    rawEmail = body?.email
    console.log(`[bic ${reqId}] body parsed`, {
      body_length: bodyText.length,
      email_present: typeof rawEmail === 'string',
      email_type: typeof rawEmail,
    })
  } catch {
    console.log(`[bic ${reqId}] invalid JSON body -> 400`, {
      body_length: bodyText?.length ?? 0,
    })
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof rawEmail !== 'string') {
    console.log(`[bic ${reqId}] missing/invalid email -> 400`, {
      email_type: typeof rawEmail,
    })
    return jsonResponse({ error: 'Missing or invalid email' }, 400)
  }

  const email = rawEmail.trim().toLowerCase()
  if (!email) {
    console.log(`[bic ${reqId}] email empty after trim -> {false,false}`)
    return jsonResponse({ match: false, verified: false })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

  try {
    const { data, error } = await serviceClient.rpc('bridge_identity_probe_by_email', {
      p_email: email,
    })

    if (error) {
      console.log(`[bic ${reqId}] rpc error -> 500`, {
        email_masked: maskEmail(email),
        error_message: error.message,
      })
      return jsonResponse({ error: error.message }, 500)
    }

    const row = Array.isArray(data) ? data[0] : data
    const match = Boolean(row?.match)
    const verified = Boolean(row?.verified)

    console.log(`[bic ${reqId}] probe ok -> 200`, {
      email_masked: maskEmail(email),
      match,
      verified,
    })

    return jsonResponse({ match, verified })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return jsonResponse({ error: message }, 500)
  }
})
