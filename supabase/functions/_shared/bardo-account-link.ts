/**
 * Helpers para resolver o vínculo explícito VI ↔ Bardo.
 *
 * A tabela public.bardo_account_links é a fonte de autoridade para saber
 * qual vi_user_id corresponde a um bardo_user_id. Substitui o uso de
 * owner_email como identidade implícita no caminho legacy bridge-exports.
 *
 * Todas as queries aqui assumem client com service_role (bypassa RLS) —
 * é o único caminho válido, já que o caller legacy se autentica via
 * shared secret, não via JWT do VI.
 */

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export type BardoAccountLinkStatus = 'active' | 'revoked'

export interface BardoAccountLinkRow {
  id: string
  vi_user_id: string
  bardo_user_id: string
  bardo_email: string | null
  link_status: BardoAccountLinkStatus
  linked_at: string
  revoked_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Retorna o vínculo ativo para um bardo_user_id específico, ou null se
 * não houver nenhum. Usa a unique partial index
 * (vi_user_id, bardo_user_id) WHERE link_status='active' — então no
 * máximo um row é retornado por bardo_user_id.
 *
 * Parâmetros:
 *   serviceClient   — cliente com service_role key.
 *   bardoUserId     — identificador opaco do Bardo, já trimmed.
 *
 * Retorno:
 *   { data: BardoAccountLinkRow | null, error: Error | null }
 */
export async function getActiveBardoAccountLink(
  serviceClient: SupabaseClient,
  bardoUserId: string,
): Promise<{ data: BardoAccountLinkRow | null; error: Error | null }> {
  const normalizedBardoUserId = bardoUserId.trim()

  if (!normalizedBardoUserId) {
    return { data: null, error: new Error('bardoUserId is empty') }
  }

  const { data, error } = await serviceClient
    .from('bardo_account_links')
    .select('id, vi_user_id, bardo_user_id, bardo_email, link_status, linked_at, revoked_at, created_at, updated_at')
    .eq('bardo_user_id', normalizedBardoUserId)
    .eq('link_status', 'active')
    .maybeSingle()

  if (error) {
    return { data: null, error: new Error(error.message) }
  }

  return { data: (data as BardoAccountLinkRow | null) ?? null, error: null }
}
