/**
 * Edge Function: link-bardo-account
 *
 * Produtor do vínculo explícito VI ↔ Bardo. Substitui o uso de email
 * como identidade implícita no consumer legado (bridge-exports).
 *
 * VI_BARDO.IDENTITY_LINK_HARDENING.R3_CONSUME_BARDO_NONCE (2026-05-13):
 *   Caminho canônico para criar vínculo: `bridge_nonce` emitido pelo
 *   Bardo (function `bridge-link-issue-nonce`, 64 hex, TTL 5min,
 *   single-use). VI computa `vi_user_email_hash` server-side com
 *   BRIDGE_EMAIL_HASH_SALT e consome o nonce no Bardo via
 *   `bridge-link-consume-nonce` (autenticado com BRIDGE_SHARED_SECRET
 *   no header `x-bridge-secret`). Só cria o vínculo se o Bardo
 *   retornar `email_hash_match === true` — ou seja, o e-mail
 *   autenticado no VI bate criptograficamente com o e-mail
 *   autenticado no Bardo.
 *
 *   Caminho legacy (sem bridge_nonce, self-attestation pelo cliente)
 *   é bloqueado por padrão. Só passa se `ALLOW_LEGACY_BARDO_LINK=true`
 *   estiver setado no ambiente — usado apenas em dev/local.
 *
 * Autenticação:
 *   Self-managed JWT (verify_jwt=false + requireAuthenticatedRequest).
 *   Todas as operações agem em nome do usuário VI autenticado — nunca
 *   aceitamos vi_user_id do body.
 *
 * Endpoints:
 *   GET  /link-bardo-account
 *     → retorna { link: BardoAccountLinkRow | null } — vínculo ativo
 *       corrente desse usuário VI, se existir.
 *
 *   POST /link-bardo-account  body { bridge_nonce: string }
 *     → caminho R3 canônico. Consome nonce no Bardo, exige
 *       email_hash_match=true. bardo_user_id e bardo_email vêm da
 *       resposta do Bardo (nunca do cliente).
 *
 *   POST /link-bardo-account  body { bardo_user_id: string, bardo_email?: string }
 *     → caminho legacy. Só funciona se ALLOW_LEGACY_BARDO_LINK=true.
 *       Bloqueado em produção. Mantido para dev/migração gradual.
 *
 *   POST /link-bardo-account  body { action: 'revoke' }
 *     → revoga todos os vínculos ativos do usuário VI autenticado.
 *
 * Observabilidade:
 *   Logs estruturados com `event: link_attempt` e `result: <code>`.
 *   Nunca logamos: salt, x-bridge-secret, nonce completo, hash completo.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { requireAuthenticatedRequest } from '../_shared/auth.ts'
import { corsHeaders, getErrorMessage, jsonResponse } from '../_shared/http.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// VI_BARDO.IDENTITY_LINK_HARDENING.R3:
const BRIDGE_EMAIL_HASH_SALT = Deno.env.get('BRIDGE_EMAIL_HASH_SALT') || ''
const BRIDGE_SHARED_SECRET = Deno.env.get('BRIDGE_SHARED_SECRET') || ''
const BARDO_BRIDGE_CONSUME_NONCE_URL =
  Deno.env.get('BARDO_BRIDGE_CONSUME_NONCE_URL') || ''
// Default produção: bloqueia. Só passa se setado explicitamente como string "true".
const ALLOW_LEGACY_BARDO_LINK =
  (Deno.env.get('ALLOW_LEGACY_BARDO_LINK') || 'false').toLowerCase() === 'true'

const MAX_BARDO_USER_ID_LENGTH = 256
const MAX_BARDO_EMAIL_LENGTH = 320
const NONCE_HEX_REGEX = /^[0-9a-f]{64}$/i

interface LinkRequestBody {
  bridge_nonce?: unknown
  bardo_user_id?: unknown
  bardo_email?: unknown
  action?: unknown
}

interface BardoNonceConsumeResponse {
  ok?: boolean
  bardo_user_id?: string | null
  // R3_FINALIZE_SMOKE (2026-05-13): Bardo consumer NÃO expõe bardo_email cru.
  // Em vez disso devolve apenas o hash. Mantemos o tipo opcional só por
  // resiliência se algum dia o contrato mudar — mas o código não pode
  // depender desse campo.
  bardo_email?: string | null
  bardo_email_hash?: string | null
  email_hash_match?: boolean | null
  // R3_FINALIZE_SMOKE: `code` é o canonical (Bardo 0.6.121+).
  // Mantemos fallback para `result` durante a janela de transição entre
  // o cut antigo e o atual — assim resiliência > brittleness.
  code?: string
  result?: string
  error?: string
}

function assertServiceEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service env not configured')
  }
}

function createServiceClient() {
  assertServiceEnv()
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

function normalizeBardoUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_BARDO_USER_ID_LENGTH) return null
  return trimmed
}

function normalizeBardoEmail(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  if (trimmed.length > MAX_BARDO_EMAIL_LENGTH) return null
  return trimmed
}

function normalizeViEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  return trimmed || null
}

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const head = local.slice(0, Math.min(2, local.length))
  return `${head}***@${domain}`
}

// sha256(BRIDGE_EMAIL_HASH_SALT + ':email:' + lower(email)) — hex
async function computeEmailHash(normalizedEmail: string): Promise<string> {
  const data = new TextEncoder().encode(
    `${BRIDGE_EMAIL_HASH_SALT}:email:${normalizedEmail}`,
  )
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface LinkAttemptLog {
  event: 'link_attempt'
  result:
    | 'valid'
    | 'mismatch'
    | 'unverifiable_identity'
    | 'expired_nonce'
    | 'reused_nonce'
    | 'invalid_nonce'
    | 'missing_nonce'
    | 'malformed_nonce'
    | 'bardo_consumer_unauthorized'
    | 'bardo_consumer_rate_limited'
    | 'bardo_consumer_error'
    | 'server_misconfigured'
    | 'no_vi_email'
    | 'legacy_blocked'
    | 'legacy_attempt'
  vi_user_id: string
  vi_email_masked?: string
  bardo_user_id_prefix?: string | null
  timestamp: string
}

// R4_CODE_MAPPING_PATCH (2026-05-13): preservar semântica dos códigos
// vindos do Bardo consumer mesmo quando o response é non-2xx. Antes
// disso, qualquer non-2xx caía em `bardo_consumer_error` 502 e perdíamos
// distinção entre nonce reusado, expirado e falha de integração.
type LinkBardoConsumerErrorCode =
  | 'reused_nonce'
  | 'expired_nonce'
  | 'invalid_nonce'
  | 'bardo_consumer_unauthorized'
  | 'bardo_consumer_rate_limited'
  | 'bardo_consumer_error'

function mapBardoConsumerErrorCode(code: unknown): LinkBardoConsumerErrorCode {
  if (typeof code !== 'string') return 'bardo_consumer_error'
  const normalized = code.trim().toUpperCase()
  switch (normalized) {
    case 'NONCE_ALREADY_CONSUMED':
    case 'REUSED':
      return 'reused_nonce'
    case 'NONCE_EXPIRED':
    case 'EXPIRED':
      return 'expired_nonce'
    case 'NONCE_NOT_FOUND':
    case 'INVALID_INPUT':
      return 'invalid_nonce'
    case 'UNAUTHORIZED':
      return 'bardo_consumer_unauthorized'
    case 'RATE_LIMITED':
      return 'bardo_consumer_rate_limited'
    case 'SERVER_MISCONFIGURED':
    case 'INTERNAL':
      return 'bardo_consumer_error'
    default:
      return 'bardo_consumer_error'
  }
}

function httpStatusForLinkBardoConsumerError(
  code: LinkBardoConsumerErrorCode,
): number {
  switch (code) {
    case 'reused_nonce':
    case 'expired_nonce':
    case 'invalid_nonce':
      return 403
    case 'bardo_consumer_rate_limited':
      return 429
    case 'bardo_consumer_unauthorized':
    case 'bardo_consumer_error':
      return 502
  }
}

function logLinkAttempt(entry: LinkAttemptLog) {
  // Nunca logamos: salt, x-bridge-secret, nonce completo, hash completo,
  // bardo_user_id completo, email completo (só masked).
  console.info('[link-bardo-account]', JSON.stringify(entry))
}

async function consumeBardoNonce(input: {
  bridgeNonce: string
  viEmailHash: string
}): Promise<{
  ok: boolean
  status: number
  body: BardoNonceConsumeResponse | null
  rawError?: string
}> {
  if (!BARDO_BRIDGE_CONSUME_NONCE_URL || !BRIDGE_SHARED_SECRET) {
    return {
      ok: false,
      status: 503,
      body: null,
      rawError: 'bardo_consumer_not_configured',
    }
  }
  try {
    const res = await fetch(BARDO_BRIDGE_CONSUME_NONCE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bridge-secret': BRIDGE_SHARED_SECRET,
      },
      body: JSON.stringify({
        bridge_nonce: input.bridgeNonce,
        vi_user_email_hash: input.viEmailHash,
      }),
    })
    const status = res.status
    let body: BardoNonceConsumeResponse | null = null
    try {
      body = (await res.json()) as BardoNonceConsumeResponse
    } catch {
      // intencionalmente ignorado — body fica null
    }
    return { ok: res.ok, status, body }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      // só registramos a classe do erro, não o conteúdo bruto que poderia
      // vazar URL/headers em stack traces.
      rawError: err instanceof Error ? err.name : 'fetch_error',
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const context = await requireAuthenticatedRequest(req)
  if (!context) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const viUserId = context.user.id
  const service = createServiceClient()
  const nowIso = () => new Date().toISOString()

  try {
    // ── GET /link-bardo-account ──
    if (req.method === 'GET') {
      const { data, error } = await service
        .from('bardo_account_links')
        .select(
          'id, vi_user_id, bardo_user_id, bardo_email, link_status, linked_at, revoked_at, created_at, updated_at',
        )
        .eq('vi_user_id', viUserId)
        .eq('link_status', 'active')
        .maybeSingle()

      if (error) {
        return jsonResponse({ error: error.message }, 500)
      }

      return jsonResponse({
        ok: true,
        linked: Boolean(data),
        link_status: data?.link_status ?? null,
        link: data ?? null,
      })
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    // ── POST /link-bardo-account ──
    const body = (await req.json().catch(() => null)) as LinkRequestBody | null
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'Invalid body' }, 400)
    }

    const action = typeof body.action === 'string' ? body.action.trim() : ''

    // ── POST: revoke (sem mudanças) ──
    if (action === 'revoke') {
      const { data, error } = await service
        .from('bardo_account_links')
        .update({
          link_status: 'revoked',
          revoked_at: nowIso(),
        })
        .eq('vi_user_id', viUserId)
        .eq('link_status', 'active')
        .select('id, bardo_user_id')

      if (error) {
        return jsonResponse({ error: error.message }, 500)
      }

      return jsonResponse({
        ok: true,
        linked: false,
        link_status: 'revoked',
        revoked: data?.length ?? 0,
      })
    }

    // ── POST: create/upsert link ──
    // Caminho R3 (bridge_nonce) tem precedência sobre legacy.
    const rawBridgeNonce =
      typeof body.bridge_nonce === 'string' ? body.bridge_nonce.trim() : ''

    if (rawBridgeNonce) {
      // ─── R3 canônico ─────────────────────────────────────────────
      if (!NONCE_HEX_REGEX.test(rawBridgeNonce)) {
        logLinkAttempt({
          event: 'link_attempt',
          result: 'malformed_nonce',
          vi_user_id: viUserId,
          timestamp: nowIso(),
        })
        return jsonResponse(
          {
            error: 'Invalid bridge_nonce format',
            code: 'malformed_nonce',
          },
          400,
        )
      }

      if (!BRIDGE_EMAIL_HASH_SALT) {
        logLinkAttempt({
          event: 'link_attempt',
          result: 'server_misconfigured',
          vi_user_id: viUserId,
          timestamp: nowIso(),
        })
        return jsonResponse(
          {
            error: 'Server misconfigured (salt missing)',
            code: 'server_misconfigured',
          },
          503,
        )
      }

      const viEmail = normalizeViEmail(context.user.email ?? null)
      if (!viEmail) {
        logLinkAttempt({
          event: 'link_attempt',
          result: 'no_vi_email',
          vi_user_id: viUserId,
          timestamp: nowIso(),
        })
        return jsonResponse(
          {
            error: 'Authenticated VI user has no email',
            code: 'no_vi_email',
          },
          400,
        )
      }

      const viEmailHash = await computeEmailHash(viEmail)
      const viEmailMasked = maskEmail(viEmail)

      const consume = await consumeBardoNonce({
        bridgeNonce: rawBridgeNonce,
        viEmailHash,
      })

      // R4_CODE_MAPPING_PATCH: quando o Bardo consumer responde non-2xx,
      // inspecionamos `body.code` antes de fallback genérico — preserva
      // distinção entre reused/expired/invalid e falha de integração.
      // Nunca logamos body bruto: só o code mapeado.
      if (!consume.ok) {
        const rawCode =
          consume.body && typeof consume.body.code === 'string'
            ? consume.body.code
            : null
        const mapped = mapBardoConsumerErrorCode(rawCode)
        const httpStatus = httpStatusForLinkBardoConsumerError(mapped)
        logLinkAttempt({
          event: 'link_attempt',
          result: mapped,
          vi_user_id: viUserId,
          vi_email_masked: viEmailMasked,
          timestamp: nowIso(),
        })
        return jsonResponse(
          {
            error: `Link blocked: ${mapped}`,
            code: mapped,
          },
          httpStatus,
        )
      }

      if (!consume.body) {
        // 2xx mas body não parseável — trata como falha genérica de consumer.
        logLinkAttempt({
          event: 'link_attempt',
          result: 'bardo_consumer_error',
          vi_user_id: viUserId,
          vi_email_masked: viEmailMasked,
          timestamp: nowIso(),
        })
        return jsonResponse(
          {
            error: 'Could not validate nonce with Bardo',
            code: 'bardo_consumer_error',
          },
          502,
        )
      }

      const bardoResponse = consume.body

      // R3_FINALIZE_SMOKE: canonical é `code`. Fallback `result` durante
      // transição.
      const bardoCode =
        (typeof bardoResponse.code === 'string' && bardoResponse.code) ||
        (typeof bardoResponse.result === 'string' && bardoResponse.result) ||
        null

      // Mapeamento de email_hash_match + code → códigos VI (caminho 2xx).
      // R4_CODE_MAPPING_PATCH: usa o mesmo mapBardoConsumerErrorCode pra
      // alinhar nomes (expired_nonce/reused_nonce) com a branch non-2xx.
      if (bardoResponse.email_hash_match !== true) {
        let result: LinkAttemptLog['result'] = 'invalid_nonce'
        if (bardoResponse.email_hash_match === false) {
          result = 'mismatch'
        } else if (bardoResponse.email_hash_match === null) {
          result = 'unverifiable_identity'
        } else if (bardoCode) {
          const mappedConsumerCode = mapBardoConsumerErrorCode(bardoCode)
          if (mappedConsumerCode !== 'bardo_consumer_error') {
            result = mappedConsumerCode
          }
        }

        logLinkAttempt({
          event: 'link_attempt',
          result,
          vi_user_id: viUserId,
          vi_email_masked: viEmailMasked,
          bardo_user_id_prefix: bardoResponse.bardo_user_id
            ? bardoResponse.bardo_user_id.slice(0, 8)
            : null,
          timestamp: nowIso(),
        })
        return jsonResponse(
          {
            error: `Link blocked: ${result}`,
            code: result,
          },
          403,
        )
      }

      // R3_FINALIZE_SMOKE: defesa em profundidade — Bardo afirmou
      // email_hash_match=true, mas se também enviou `bardo_email_hash`,
      // verificamos localmente que bate com o hash que computamos do
      // vi_email. Se não bate, há inconsistência (Bardo bug, MITM,
      // ou config divergente de salt). Recusamos.
      if (typeof bardoResponse.bardo_email_hash === 'string' &&
          bardoResponse.bardo_email_hash.toLowerCase() !== viEmailHash.toLowerCase()) {
        logLinkAttempt({
          event: 'link_attempt',
          result: 'mismatch',
          vi_user_id: viUserId,
          vi_email_masked: viEmailMasked,
          bardo_user_id_prefix: bardoResponse.bardo_user_id
            ? bardoResponse.bardo_user_id.slice(0, 8)
            : null,
          timestamp: nowIso(),
        })
        return jsonResponse(
          {
            error: 'Link blocked: hash inconsistency between VI and Bardo',
            code: 'mismatch',
          },
          403,
        )
      }

      // email_hash_match === true (e hash bate quando disponível) →
      // criar/upsert vínculo. bardo_user_id vem da resposta do Bardo
      // — NUNCA do cliente. bardo_email cru NÃO é exposto pelo Bardo
      // no R3; gravamos null em bardo_account_links.bardo_email
      // (coluna nullable). Schema unchanged — armazenar bardo_email_hash
      // dedicado fica como dívida para R4 (precisa migration).
      const bardoUserId = normalizeBardoUserId(bardoResponse.bardo_user_id)
      if (!bardoUserId) {
        logLinkAttempt({
          event: 'link_attempt',
          result: 'bardo_consumer_error',
          vi_user_id: viUserId,
          vi_email_masked: viEmailMasked,
          timestamp: nowIso(),
        })
        return jsonResponse(
          {
            error: 'Bardo did not return a usable bardo_user_id',
            code: 'bardo_consumer_error',
          },
          502,
        )
      }

      logLinkAttempt({
        event: 'link_attempt',
        result: 'valid',
        vi_user_id: viUserId,
        vi_email_masked: viEmailMasked,
        bardo_user_id_prefix: bardoUserId.slice(0, 8),
        timestamp: nowIso(),
      })

      return await upsertActiveLink({
        service,
        viUserId,
        bardoUserId,
        // R3: Bardo não expõe email cru — sempre null no schema atual.
        bardoEmail: null,
      })
    }

    // ─── Legacy (sem bridge_nonce) ───────────────────────────────
    if (!ALLOW_LEGACY_BARDO_LINK) {
      logLinkAttempt({
        event: 'link_attempt',
        result: 'legacy_blocked',
        vi_user_id: viUserId,
        timestamp: nowIso(),
      })
      return jsonResponse(
        {
          error:
            'Legacy link without bridge_nonce is blocked. Restart the link flow from Bardo.',
          code: 'legacy_blocked',
        },
        403,
      )
    }

    // Legacy permitido (apenas dev/local com ALLOW_LEGACY_BARDO_LINK=true)
    const legacyBardoUserId = normalizeBardoUserId(body.bardo_user_id)
    if (!legacyBardoUserId) {
      return jsonResponse(
        {
          error: 'bardo_user_id is required and must be a non-empty string',
          code: 'bardo_user_id_required',
        },
        400,
      )
    }
    const legacyBardoEmail = normalizeBardoEmail(body.bardo_email)

    logLinkAttempt({
      event: 'link_attempt',
      result: 'legacy_attempt',
      vi_user_id: viUserId,
      bardo_user_id_prefix: legacyBardoUserId.slice(0, 8),
      timestamp: nowIso(),
    })

    return await upsertActiveLink({
      service,
      viUserId,
      bardoUserId: legacyBardoUserId,
      bardoEmail: legacyBardoEmail,
    })
  } catch (err) {
    return jsonResponse({ error: getErrorMessage(err) }, 500)
  }
})

// ─── Helpers ───────────────────────────────────────────────────────

async function upsertActiveLink(args: {
  service: ReturnType<typeof createServiceClient>
  viUserId: string
  bardoUserId: string
  bardoEmail: string | null
}): Promise<Response> {
  const { service, viUserId, bardoUserId, bardoEmail } = args

  // Idempotência: já existe vínculo ativo para (vi_user_id, bardo_user_id)?
  const { data: existingSame, error: existingSameError } = await service
    .from('bardo_account_links')
    .select(
      'id, vi_user_id, bardo_user_id, bardo_email, link_status, linked_at, revoked_at, created_at, updated_at',
    )
    .eq('vi_user_id', viUserId)
    .eq('bardo_user_id', bardoUserId)
    .eq('link_status', 'active')
    .maybeSingle()

  if (existingSameError) {
    return jsonResponse({ error: existingSameError.message }, 500)
  }

  if (existingSame) {
    if (bardoEmail && bardoEmail !== existingSame.bardo_email) {
      const { data: updated, error: updateError } = await service
        .from('bardo_account_links')
        .update({ bardo_email: bardoEmail })
        .eq('id', existingSame.id)
        .select(
          'id, vi_user_id, bardo_user_id, bardo_email, link_status, linked_at, revoked_at, created_at, updated_at',
        )
        .single()

      if (updateError) {
        return jsonResponse({ error: updateError.message }, 500)
      }

      return jsonResponse({
        ok: true,
        linked: true,
        link_status: updated.link_status,
        link: updated,
        created: false,
        updated: true,
      })
    }

    return jsonResponse({
      ok: true,
      linked: true,
      link_status: existingSame.link_status,
      link: existingSame,
      created: false,
      updated: false,
    })
  }

  // Revoga vínculos ativos anteriores com outro bardo_user_id —
  // uma conta Bardo por vez por usuário VI.
  const { error: revokeOthersError } = await service
    .from('bardo_account_links')
    .update({
      link_status: 'revoked',
      revoked_at: new Date().toISOString(),
    })
    .eq('vi_user_id', viUserId)
    .eq('link_status', 'active')

  if (revokeOthersError) {
    return jsonResponse({ error: revokeOthersError.message }, 500)
  }

  const { data: inserted, error: insertError } = await service
    .from('bardo_account_links')
    .insert({
      vi_user_id: viUserId,
      bardo_user_id: bardoUserId,
      bardo_email: bardoEmail,
      link_status: 'active',
    })
    .select(
      'id, vi_user_id, bardo_user_id, bardo_email, link_status, linked_at, revoked_at, created_at, updated_at',
    )
    .single()

  if (insertError) {
    return jsonResponse({ error: insertError.message }, 500)
  }

  return jsonResponse({
    ok: true,
    linked: true,
    link_status: inserted.link_status,
    link: inserted,
    created: true,
    updated: false,
  })
}
