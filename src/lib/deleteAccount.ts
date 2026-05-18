/**
 * VI_LGPD_DELETE_ACCOUNT (2026-05-17)
 *
 * Cliente helper para o fluxo "Apagar minha conta" (LGPD art. 18 VI).
 *
 * Fluxo do client:
 *   1. Usuário confirma na UI digitando keyword.
 *   2. UI chama `deleteAccount()` → invoca edge function `/delete-account`
 *      autenticada com JWT (userId vem do JWT, não do body).
 *   3. Em sucesso: limpa todos os preferences locais via
 *      `wipeLocalAppPreferences()` + `resetLocalAuthState()`.
 *   4. UI faz redirect para `/` (AuthGate vai exibir login).
 *
 * Em erro:
 *   - Edge function retorna 4xx/5xx com `{ error: string }`.
 *   - Helper propaga o erro para a UI exibir + permitir retry.
 *   - Nenhum cleanup é feito (estado do usuário fica intacto).
 *
 * Importante: cleanup é EXECUTADO APENAS após edge function retornar
 * `ok: true`. Falha parcial no servidor (storage parcialmente deletado,
 * por exemplo) NÃO dispara cleanup local — usuário continua logado e
 * pode tentar novamente.
 */

import { invokeAuthenticatedFunction } from './functionAuth'
import { resetLocalAuthState } from './supabase'

export interface DeleteAccountResult {
  ok: true
  audioObjectsDeleted: number
  deletedAt: string
}

/**
 * Lista de chaves de preferência local enumeradas em
 * `docs/LGPD_DATA_MAP.md`. Não inclui as chaves Supabase Auth — essas
 * são limpas por `resetLocalAuthState()`.
 *
 * Quando adicionar nova chave `voiceideas.*` em outra parte do código,
 * incluir aqui também para que account deletion limpe.
 */
const LOCAL_PREFERENCE_KEYS: ReadonlyArray<string> = [
  'voiceideas.recorder-ui-preferences.v1',
  'voiceideas.capture-engine.use-unified.v1',
  'voiceideas.language.v1',
  'voiceideas.integration-preferences.v1',
  'voiceideas.voice-segmentation-settings.v2',
  'voiceideas.segmentation-advanced-enabled',
  'voiceideas.bardo-bridge.v1',
  'voiceideas.bridge-export.v1',
  'voiceideas.bridge-item.v1',
  'voiceideas.pending-native-auth.v1',
]

export function wipeLocalAppPreferences(): void {
  if (typeof window === 'undefined') return
  for (const key of LOCAL_PREFERENCE_KEYS) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Silencioso — não pode quebrar o cleanup por causa de uma chave.
    }
  }
}

/**
 * Chama edge function `/delete-account` autenticada. Em sucesso, limpa
 * localStorage e reseta sessão Supabase (dispatcha
 * `LOCAL_AUTH_RESET_EVENT` que o `useAuth` escuta para forçar logout).
 *
 * Caller deve fazer redirect para `/` após sucesso — recomendação é
 * `navigate('/')` via react-router, que vai cair no AuthGate por causa
 * do logout disparado por `resetLocalAuthState()`.
 *
 * Em erro: throw com mensagem amigável. Caller mostra na UI.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const { data, error } = await invokeAuthenticatedFunction<{
    ok?: boolean
    audioObjectsDeleted?: number
    deletedAt?: string
    error?: string
  }>('delete-account', {
    method: 'POST',
  })

  if (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Falha ao apagar a conta. Tente novamente.'
    throw new Error(message)
  }

  if (!data || data.ok !== true) {
    const message = data?.error ?? 'Resposta inesperada do servidor.'
    throw new Error(message)
  }

  // Cleanup local APÓS sucesso confirmado pelo servidor.
  wipeLocalAppPreferences()
  await resetLocalAuthState()

  return {
    ok: true,
    audioObjectsDeleted: data.audioObjectsDeleted ?? 0,
    deletedAt: data.deletedAt ?? new Date().toISOString(),
  }
}
