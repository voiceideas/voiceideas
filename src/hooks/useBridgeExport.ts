import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import type { BridgeExport, BridgeExportFilters, CreateBridgeExportInput, UpdateBridgeExportInput } from '../types/bridge'
import { createBridgeExport, listBridgeExports, updateBridgeExport } from '../services/bridgeExportService'

interface UseBridgeExportOptions {
  enabled?: boolean
}

export function useBridgeExport(filters: BridgeExportFilters = {}, options: UseBridgeExportOptions = {}) {
  const enabled = options.enabled ?? true
  const [bridgeExports, setBridgeExports] = useState<BridgeExport[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const fetchBridgeExports = useCallback(async () => {
    if (!enabled) {
      setBridgeExports([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await listBridgeExports(filters)
      setBridgeExports(data)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Falha ao carregar exportacoes da bridge.')
    } finally {
      setLoading(false)
    }
  }, [enabled, filters])

  const fetchBridgeExportsEvent = useEffectEvent(fetchBridgeExports)

  useEffect(() => {
    if (!enabled) {
      setBridgeExports([])
      setError(null)
      setLoading(false)
      return
    }

    void fetchBridgeExportsEvent()
  }, [enabled])

  const addBridgeExport = async (input: CreateBridgeExportInput) => {
    const bridgeExport = await createBridgeExport(input)
    setBridgeExports((prev) => [bridgeExport, ...prev])
    return bridgeExport
  }

  const patchBridgeExport = async (id: string, input: UpdateBridgeExportInput) => {
    const bridgeExport = await updateBridgeExport(id, input)
    setBridgeExports((prev) => prev.map((item) => (item.id === id ? bridgeExport : item)))
    return bridgeExport
  }

  const exportsByDraftDestination = useMemo(() => {
    const mapped = new Map<string, BridgeExport[]>()

    for (const bridgeExport of bridgeExports) {
      const key = `${bridgeExport.ideaDraftId}:${bridgeExport.destination}`
      const current = mapped.get(key) ?? []
      current.push(bridgeExport)
      mapped.set(key, current)
    }

    for (const exportsForDestination of mapped.values()) {
      exportsForDestination.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    }

    return mapped
  }, [bridgeExports])

  return {
    bridgeExports,
    loading,
    error,
    getExportsForDraftDestination: (ideaDraftId: string, destination: BridgeExport['destination']) =>
      exportsByDraftDestination.get(`${ideaDraftId}:${destination}`) ?? [],
    getLatestExportForDraftDestination: (ideaDraftId: string, destination: BridgeExport['destination']) =>
      (exportsByDraftDestination.get(`${ideaDraftId}:${destination}`) ?? [])[0] ?? null,
    createBridgeExport: addBridgeExport,
    updateBridgeExport: patchBridgeExport,
    refetch: fetchBridgeExports,
  }
}
