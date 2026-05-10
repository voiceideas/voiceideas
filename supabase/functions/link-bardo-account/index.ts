/**
 * Edge Function: link-bardo-account
 *
 * Produtor do vínculo explícito VI ↔ Bardo. Substitui o uso de email
 * como identidade implícita no consumer legado (bridge-exports).
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
 *   POST /link-bardo-account  body { bardo_user_id: string, bardo_email?: string }
 *     → cria vínculo ativo. Idempotente: se já existir vínculo ativo
 *       para (vi_user_id, bardo_user_id), devolve o existente; se o
 *       usuário tinha outro vínculo ativo com bardo_user_id diferente,
 *       ele é revogado antes de criar o novo (uma conta Bardo por vez).
 *
 *   POST /link-bardo-account  body { action: 'revoke' }
 *     → revoga todos os vínculos ativos do usuário VI autenticado.
 *
 * Identidade:
 *   - vi_user_id vem sempre de auth.uid() — NUNCA do body.
 *   - bardo_user_id é opaco (texto) e obrigatório; trimmed.
 *   - bardo_email é snapshot de auditoria — não autoriza nada.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { requireAuthenticatedRequest } from '../_shared/auth.ts'
import { corsHeaders, getErrorMessage, jsonResponse } from '../_shared/http.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const MAX_BARDO_USER_ID_LENGTH = 256
const MAX_BARDO_EMAIL_LENGTH = 320

interface LinkRequestBody {
  bardo_user_id?: unknown
  bardo_email?: unknown
  action?: unknown
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

  try {
    // ── GET /link-bardo-account ──
    // Retorna o vínculo ativo corrente do usuário VI, se existir.
    if (req.method === 'GET') {
      const { data, error } = await service
        .from('bardo_account_links')
        .select('id, vi_user_id, bardo_user_id, bardo_email, link_status, linked_at, revoked_at, created_at, updated_at')
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

    // ── POST: revoke ──
    if (action === 'revoke') {
      const { data, error } = await service
        .from('bardo_account_links')
        .update({
          link_status: 'revoked',
          revoked_at: new Date().toISOString(),
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
    const bardoUserId = normalizeBardoUserId(body.bardo_user_id)
    if (!bardoUserId) {
      return jsonResponse(
        {
          error: 'bardo_user_id is required and must be a non-empty string',
          code: 'bardo_user_id_required',
        },
        400,
      )
    }

    const bardoEmail = normalizeBardoEmail(body.bardo_email)

    // Idempotência: já existe vínculo ativo para (vi_user_id, bardo_user_id)?
    const { data: existingSame, error: existingSameError } = await service
      .from('bardo_account_links')
      .select('id, vi_user_id, bardo_user_id, bardo_email, link_status, linked_at, revoked_at, created_at, updated_at')
      .eq('vi_user_id', viUserId)
      .eq('bardo_user_id', bardoUserId)
      .eq('link_status', 'active')
      .maybeSingle()

    if (existingSameError) {
      return jsonResponse({ error: existingSameError.message }, 500)
    }

    if (existingSame) {
      // Atualiza apenas bardo_email se o caller trouxe novo snapshot.
      if (bardoEmail && bardoEmail !== existingSame.bardo_email) {
        const { data: updated, error: updateError } = await service
          .from('bardo_account_links')
          .update({ bardo_email: bardoEmail })
          .eq('id', existingSame.id)
          .select('id, vi_user_id, bardo_user_id, bardo_email, link_status, linked_at, revoked_at, created_at, updated_at')
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

    // Revoga vínculos ativos anteriores com outro bardo_user_id — uma
    // conta Bardo por vez por usuário VI. O unique parcial permite
    // coexistência de múltiplos revoked mas bloqueia 2 ativos no mesmo par.
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
      .select('id, vi_user_id, bardo_user_id, bardo_email, link_status, linked_at, revoked_at, created_at, updated_at')
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
  } catch (err) {
    return jsonResponse({ error: getErrorMessage(err) }, 500)
  }
})
