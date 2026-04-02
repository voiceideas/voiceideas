import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { discardPendingCaptureUpload } from '../services/pendingCaptureUploadService'
import {
  createPendingCaptureUpload,
  getPendingCaptureUpload,
  isLocalCaptureStoreSupported,
  listPendingCaptureUploads,
  patchPendingCaptureUpload,
  type CreatePendingCaptureUploadInput,
  type PatchPendingCaptureUploadInput,
  type PendingCaptureUploadRecord,
} from '../services/mobileLocalCaptureStore'

export function usePendingCaptureUploads() {
  const { user } = useAuth()
  const [pendingUploads, setPendingUploads] = useState<PendingCaptureUploadRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isSupported = isLocalCaptureStoreSupported()

  const refreshPendingUploads = useCallback(async () => {
    if (!isSupported || !user?.id) {
      setPendingUploads([])
      setLoading(false)
      return []
    }

    setLoading(true)
    setError(null)

    try {
      const uploads = await listPendingCaptureUploads(user.id)
      setPendingUploads(uploads)
      return uploads
    } catch (loadError) {
      const message = loadError instanceof Error
        ? loadError.message
        : 'Nao foi possivel carregar as capturas pendentes.'
      setError(message)
      return []
    } finally {
      setLoading(false)
    }
  }, [isSupported, user?.id])

  useEffect(() => {
    void refreshPendingUploads()
  }, [refreshPendingUploads])

  const queuePendingUpload = useCallback(async (input: Omit<CreatePendingCaptureUploadInput, 'userId'>) => {
    if (!user?.id) {
      throw new Error('Voce precisa entrar na sua conta para guardar capturas pendentes.')
    }

    const record = await createPendingCaptureUpload({
      ...input,
      userId: user.id,
    })
    setPendingUploads((current) => [record, ...current.filter((entry) => entry.sessionId !== record.sessionId)])
    return record
  }, [user?.id])

  const patchPendingUpload = useCallback(async (sessionId: string, patch: PatchPendingCaptureUploadInput) => {
    const record = await patchPendingCaptureUpload(sessionId, patch)
    setPendingUploads((current) => current
      .map((entry) => (entry.sessionId === sessionId ? record : entry))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)))
    return record
  }, [])

  const removePendingUpload = useCallback(async (sessionId: string) => {
    await discardPendingCaptureUpload(sessionId)
    setPendingUploads((current) => current.filter((entry) => entry.sessionId !== sessionId))
  }, [])

  const findPendingUpload = useCallback(async (sessionId: string) => {
    if (!isSupported) return null
    return getPendingCaptureUpload(sessionId)
  }, [isSupported])

  return {
    isSupported,
    loading,
    error,
    pendingUploads,
    refreshPendingUploads,
    queuePendingUpload,
    patchPendingUpload,
    removePendingUpload,
    findPendingUpload,
  }
}
