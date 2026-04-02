import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import type { CreateIdeaDraftInput, IdeaDraft, IdeaDraftFilters, UpdateIdeaDraftInput } from '../types/ideaDraft'
import { createIdeaDraft, listIdeaDrafts, updateIdeaDraft } from '../services/ideaDraftService'

export function useIdeaDrafts(filters: IdeaDraftFilters = {}) {
  const [drafts, setDrafts] = useState<IdeaDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sessionId = filters.sessionId
  const chunkId = filters.chunkId
  const status = filters.status
  const limit = filters.limit

  const fetchDrafts = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await listIdeaDrafts({
        sessionId,
        chunkId,
        status,
        limit,
      })
      setDrafts(data)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Falha ao carregar drafts de ideia.')
    } finally {
      setLoading(false)
    }
  }, [chunkId, limit, sessionId, status])

  const fetchDraftsEvent = useEffectEvent(fetchDrafts)

  useEffect(() => {
    void fetchDraftsEvent()
  }, [chunkId, limit, sessionId, status])

  const addDraft = async (input: CreateIdeaDraftInput) => {
    const draft = await createIdeaDraft(input)
    setDrafts((prev) => [draft, ...prev])
    return draft
  }

  const patchDraft = async (id: string, input: UpdateIdeaDraftInput) => {
    const draft = await updateIdeaDraft(id, input)
    setDrafts((prev) => prev.map((item) => (item.id === id ? draft : item)))
    return draft
  }

  return {
    drafts,
    loading,
    error,
    createDraft: addDraft,
    updateDraft: patchDraft,
    refetch: fetchDrafts,
  }
}
