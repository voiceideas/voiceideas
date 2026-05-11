/**
 * Cliente do endpoint link-bardo-account.
 *
 * Produz o vínculo explícito VI ↔ Bardo que o consumer legado
 * (bridge-exports) passou a exigir em P1.3. Todas as chamadas são
 * autenticadas via JWT do VI — o vi_user_id NUNCA é enviado do cliente.
 *
 * Esse service NÃO usa owner_email como identidade. bardo_email aceita
 * apenas como snapshot opcional de auditoria.
 */

import { invokeAuthenticatedFunction } from '../lib/functionAuth'
import type { BardoAccountLink } from '../types/database'

const FUNCTION_NAME = 'link-bardo-account'

export interface BardoAccountLinkInput {
  bardoUserId: string
  bardoEmail?: string | null
}

export interface BardoAccountLinkUpsertResult {
  link: BardoAccountLink
  created: boolean
  updated: boolean
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
  const bardoUserId = input.bardoUserId.trim()
  if (!bardoUserId) {
    throw new Error('bardo_user_id is required')
  }

  const bardoEmail = typeof input.bardoEmail === 'string'
    ? input.bardoEmail.trim().toLowerCase() || null
    : null

  const result = await invokeAuthenticatedFunction<BardoAccountLinkUpsertResult>(
    FUNCTION_NAME,
    {
      method: 'POST',
      body: JSON.stringify({
        bardo_user_id: bardoUserId,
        bardo_email: bardoEmail,
      }),
    },
  )

  return unwrap(result)
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
