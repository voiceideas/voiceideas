import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import type { CaptureSession, CaptureSessionFilters, CreateCaptureSessionInput, UpdateCaptureSessionInput } from '../types/capture'
import {
  completeCaptureSession,
  createCaptureSession,
  deleteCaptureSessionAudio,
  listCaptureSessions,
  updateCaptureSession,
  uploadCaptureSessionAudio,
} from '../services/captureSessionService'

export function useCaptureSession(filters: CaptureSessionFilters = {}) {
  const [sessions, setSessions] = useState<CaptureSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await listCaptureSessions(filters)
      setSessions(data)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Falha ao carregar sessoes de captura.')
    } finally {
      setLoading(false)
    }
  }, [filters])

  const fetchSessionsEvent = useEffectEvent(fetchSessions)

  useEffect(() => {
    void fetchSessionsEvent()
  }, [])

  const addSession = async (input: CreateCaptureSessionInput) => {
    const session = await createCaptureSession(input)
    setSessions((prev) => [session, ...prev])
    return session
  }

  const patchSession = async (id: string, input: UpdateCaptureSessionInput) => {
    const session = await updateCaptureSession(id, input)
    setSessions((prev) => prev.map((item) => (item.id === id ? session : item)))
    return session
  }

  const finishSession = async (
    id: string,
    options?: Parameters<typeof completeCaptureSession>[1],
  ) => {
    const session = await completeCaptureSession(id, options)
    setSessions((prev) => prev.map((item) => (item.id === id ? session : item)))
    return session
  }

  const attachRawAudio = async (sessionId: string, file: Blob & { name?: string }) => {
    const upload = await uploadCaptureSessionAudio(sessionId, file)
    const session = await patchSession(sessionId, { rawStoragePath: upload.storagePath })
    return { session, storagePath: upload.storagePath, bucket: upload.bucket }
  }

  const removeRawAudio = async (sessionId: string, storagePath: string) => {
    await deleteCaptureSessionAudio(storagePath)
    return patchSession(sessionId, { rawStoragePath: null })
  }

  return {
    sessions,
    loading,
    error,
    createSession: addSession,
    updateSession: patchSession,
    completeSession: finishSession,
    attachRawAudio,
    removeRawAudio,
    refetch: fetchSessions,
  }
}
