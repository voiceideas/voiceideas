/**
 * Hook para o vínculo explícito VI ↔ Bardo (bardo_account_links).
 *
 * Encapsula o fetch/upsert/revoke via service bardoAccountLinkService.
 * A identidade autoritativa é bardo_user_id (opaco); email é apenas
 * snapshot de auditoria.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  getActiveBardoAccountLink,
  revokeBardoAccountLinks,
  upsertBardoAccountLink,
  type BardoAccountLinkInput,
} from '../services/bardoAccountLinkService'
import type { BardoAccountLink } from '../types/database'

interface UseBardoAccountLinkState {
  link: BardoAccountLink | null
  loading: boolean
  saving: boolean
  error: string | null
}

export function useBardoAccountLink() {
  const [state, setState] = useState<UseBardoAccountLinkState>({
    link: null,
    loading: true,
    saving: false,
    error: null,
  })

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const link = await getActiveBardoAccountLink()
      setState((prev) => ({ ...prev, link, loading: false }))
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Erro ao carregar vínculo Bardo',
      }))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const linkAccount = useCallback(async (input: BardoAccountLinkInput) => {
    setState((prev) => ({ ...prev, saving: true, error: null }))
    try {
      const result = await upsertBardoAccountLink(input)
      setState((prev) => ({ ...prev, link: result.link, saving: false }))
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao vincular conta Bardo'
      setState((prev) => ({ ...prev, saving: false, error: message }))
      throw err
    }
  }, [])

  const revokeAccount = useCallback(async () => {
    setState((prev) => ({ ...prev, saving: true, error: null }))
    try {
      const result = await revokeBardoAccountLinks()
      setState((prev) => ({ ...prev, link: null, saving: false }))
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao revogar vínculo Bardo'
      setState((prev) => ({ ...prev, saving: false, error: message }))
      throw err
    }
  }, [])

  return {
    link: state.link,
    loading: state.loading,
    saving: state.saving,
    error: state.error,
    isLinked: state.link !== null,
    refresh,
    linkAccount,
    revokeAccount,
  }
}
