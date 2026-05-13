/**
 * Cliente do endpoint link-bardo-account.
 *
 * VI_BARDO.IDENTITY_LINK_HARDENING.R3 (2026-05-13):
 *   Caminho canônico: `bridge_nonce` emitido pelo Bardo. A edge function
 *   VI consome o nonce no Bardo server-side, valida email_hash_match=true
 *   e só cria o vínculo nesse caso. bardo_user_id/bardo_email vêm da
 *   resposta do Bardo, não do cliente.
 *
 *   Caminho legacy (bardo_user_id digitado pelo cliente) bloqueado em
 *   produção a menos que ALLOW_LEGACY_BARDO_LINK=true no edge env.
 *   Mantido apenas para dev/local.
 *
 * Autenticação:
 *   JWT do VI via invokeAuthenticatedFunction. vi_user_id NUNCA é
 *   enviado do cliente.
 */

import { invokeAuthenticatedFunction } from '../lib/functionAuth'
import type { BardoAccountLink } from '../types/database'

const FUNCTION_NAME = 'link-bardo-account'

// R3: caminho canônico — bridge_nonce.
export interface BardoAccountLinkR3Input {
  bridgeNonce: string
}

// Legacy: self-attestation. Bloqueado em produção pela edge function.
export interface BardoAccountLinkLegacyInput {
  bardoUserId: string
  bardoEmail?: string | null
}

export type BardoAccountLinkInput =
  | BardoAccountLinkR3Input
  | BardoAccountLinkLegacyInput

export interface BardoAccountLinkUpsertResult {
  link: BardoAccountLink
  created: boolean
  updated: boolean
}

/**
 * Códigos de erro retornados pela edge function que o cliente
 * deve mapear para i18n / UX. Lista mantida em sync com o switch
 * em link-bardo-account/index.ts.
 */
export type BardoAccountLinkErrorCode =
  | 'malformed_nonce'
  | 'mismatch'
  | 'unverifiable_identity'
  | 'expired_nonce'
  | 'reused_nonce'
  | 'invalid_nonce'
  | 'bardo_consumer_unauthorized'
  | 'bardo_consumer_rate_limited'
  | 'bardo_consumer_error'
  | 'server_misconfigured'
  | 'no_vi_email'
  | 'legacy_blocked'

export class BardoAccountLinkError extends Error {
  readonly code: BardoAccountLinkErrorCode | string | null
  constructor(message: string, code: BardoAccountLinkErrorCode | string | null) {
    super(message)
    this.name = 'BardoAccountLinkError'
    this.code = code
  }
}

function isR3Input(input: BardoAccountLinkInput): input is BardoAccountLinkR3Input {
  return 'bridgeNonce' in input && typeof input.bridgeNonce === 'string'
}

function unwrap<T>(result: { data: T | null; error: unknown }) {
  if (result.error) {
    throw result.error instanceof Error
      ? result.error
      : new Error(String(result.error))
  }
  if (!result.data) {
    throw new Error('Empty response from link-bardo-account')
  }
  return result.data
}

export async function getActiveBardoAccountLink(): Promise<BardoAccountLink | null> {
  const result = await invokeAuthenticatedFunction<{ link: BardoAccountLink | null }>(
    FUNCTION_NAME,
    { method: 'GET' },
  )
  const payload = unwrap(result)
  return payload.link ?? null
}

export async function upsertBardoAccountLink(
  input: BardoAccountLinkInput,
): Promise<BardoAccountLinkUpsertResult> {
  let payload: Record<string, unknown>
  if (isR3Input(input)) {
    const bridgeNonce = input.bridgeNonce.trim()
    if (!bridgeNonce) {
      throw new BardoAccountLinkError('bridge_nonce is required', 'missing_nonce')
    }
    payload = { bridge_nonce: bridgeNonce }
  } else {
    const bardoUserId = input.bardoUserId.trim()
    if (!bardoUserId) {
      throw new BardoAccountLinkError('bardo_user_id is required', 'bardo_user_id_required')
    }
    const bardoEmail =
      typeof input.bardoEmail === 'string'
        ? input.bardoEmail.trim().toLowerCase() || null
        : null
    payload = { bardo_user_id: bardoUserId, bardo_email: bardoEmail }
  }

  const result = await invokeAuthenticatedFunction<BardoAccountLinkUpsertResult>(
    FUNCTION_NAME,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )

  // invokeAuthenticatedFunction repassa a estrutura { data, error } da
  // resposta da Edge Function. Quando o edge function retorna 4xx/5xx
  // com { error, code }, a função supabase-js coloca isso em result.error.
  // Aqui propagamos com BardoAccountLinkError para o UI conseguir
  // discriminar por code (e.g. mostrar i18n específica).
  if (result.error) {
    if (result.error instanceof Error) {
      // Tenta extrair `code` se houve um payload JSON
      const maybeCode = extractErrorCode(result.error)
      throw new BardoAccountLinkError(result.error.message, maybeCode)
    }
    throw new BardoAccountLinkError(String(result.error), null)
  }
  if (!result.data) {
    throw new BardoAccountLinkError('Empty response from link-bardo-account', null)
  }
  return result.data
}

function extractErrorCode(err: Error): string | null {
  // supabase-js FunctionsHttpError tem .context.body com o payload
  // serializado. Tentativa best-effort de descobrir o code.
  type ErrorWithContext = Error & {
    context?: { body?: unknown }
  }
  const ctx = (err as ErrorWithContext).context
  const body = ctx?.body
  if (!body) return null
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body
    if (parsed && typeof parsed === 'object' && 'code' in parsed) {
      const code = (parsed as { code?: unknown }).code
      return typeof code === 'string' ? code : null
    }
  } catch {
    // intencional
  }
  return null
}

export async function revokeBardoAccountLinks(): Promise<{ revoked: number }> {
  const result = await invokeAuthenticatedFunction<{ revoked: number }>(
    FUNCTION_NAME,
    {
      method: 'POST',
      body: JSON.stringify({ action: 'revoke' }),
    },
  )
  return unwrap(result)
}
