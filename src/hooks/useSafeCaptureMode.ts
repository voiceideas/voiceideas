import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createCaptureSession,
  updateCaptureSession,
} from '../services/captureSessionService'
import {
  flushPendingCaptureUploadRecord,
  retryPendingCaptureUpload as retryPendingCaptureUploadFromStore,
  type ProcessedPendingCaptureUploadSession,
} from '../services/pendingCaptureUploadService'
import type { PlatformSource } from '../lib/platform'
import { getPlatformSource } from '../lib/platform'
import {
  type AudioCaptureAvailabilityState,
  canUseMobileNativeAudioCapture,
  type AudioCaptureCapabilities,
  type AudioCaptureInterruptionReason,
  type AudioCapturePermissionState,
} from '../utils/platform/audioCaptureCapabilities'
import { useMobileCaptureSession } from './mobile/useMobileCaptureSession'
import { usePendingCaptureUploads } from './usePendingCaptureUploads'

export type SafeCapturePhase = 'ready' | 'recording' | 'saving-session' | 'saved' | 'error'

type SavedSafeCaptureSession = ProcessedPendingCaptureUploadSession

interface ActiveCaptureSession {
  id: string
  userId: string
  provisionalFolderName: string
  startedAt: string
  platformSource: PlatformSource
}

function mapSafeCaptureError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Permita o uso do microfone para iniciar uma captura segura.'
    }

    if (error.name === 'NotFoundError') {
      return 'Nenhum microfone foi encontrado neste aparelho.'
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    if (message.includes('microfone') || message.includes('permission')) {
      return 'Permita o uso do microfone para iniciar uma captura segura.'
    }

    return error.message
  }

  return 'Nao foi possivel gravar e salvar a sessao de captura.'
}

function getPreferredMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'audio/webm'
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || 'audio/webm'
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

function getBrowserCaptureSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

async function getBrowserPermissionState(): Promise<AudioCapturePermissionState> {
  if (!getBrowserCaptureSupported()) {
    return 'unavailable'
  }

  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return 'prompt'
  }

  try {
    const permissionStatus = await navigator.permissions.query({
      // TS libdom still lags on microphone here.
      name: 'microphone' as PermissionName,
    })

    if (permissionStatus.state === 'granted') return 'granted'
    if (permissionStatus.state === 'denied') return 'denied'
    return 'prompt'
  } catch {
    return 'prompt'
  }
}

function availabilityFromPermission(permissionState: AudioCapturePermissionState): AudioCaptureAvailabilityState {
  if (permissionState === 'granted') return 'available'
  if (permissionState === 'denied') return 'permission-denied'
  if (permissionState === 'prompt') return 'permission-required'
  return 'unavailable'
}

export function useSafeCaptureMode() {
  const [phase, setPhase] = useState<SafeCapturePhase>('ready')
  const [error, setError] = useState<string | null>(null)
  const [savedSession, setSavedSession] = useState<SavedSafeCaptureSession | null>(null)
  const [isRetryingPendingUpload, setIsRetryingPendingUpload] = useState(false)
  const {
    capabilities,
    startCapture: startMobileCapture,
    stopCapture: stopMobileCapture,
    cancelCapture: cancelMobileCapture,
    clearError: clearMobileCaptureError,
    permissionState: mobilePermissionState,
    availabilityState: mobileAvailabilityState,
    interruptionReason: mobileInterruptionReason,
    refreshPermissionState: refreshMobilePermissionState,
  } = useMobileCaptureSession()
  const [browserPermissionState, setBrowserPermissionState] = useState<AudioCapturePermissionState>(
    getBrowserCaptureSupported() ? 'prompt' : 'unavailable',
  )
  const [browserAvailabilityState, setBrowserAvailabilityState] = useState<AudioCaptureAvailabilityState>(
    getBrowserCaptureSupported() ? 'permission-required' : 'unavailable',
  )
  const [browserInterruptionReason, setBrowserInterruptionReason] = useState<AudioCaptureInterruptionReason>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const activeSessionRef = useRef<ActiveCaptureSession | null>(null)
  const interruptionHandledRef = useRef(false)
  const {
    isSupported: isPendingUploadStoreSupported,
    error: pendingUploadsError,
    pendingUploads,
    queuePendingUpload,
    findPendingUpload,
  } = usePendingCaptureUploads()

  const isSupported = capabilities.engine !== 'unavailable' && isPendingUploadStoreSupported
  const usesMobileNativeCapture = canUseMobileNativeAudioCapture(capabilities)
  const permissionState = usesMobileNativeCapture ? mobilePermissionState : browserPermissionState
  const availabilityState = !isPendingUploadStoreSupported
    ? 'unavailable'
    : usesMobileNativeCapture
      ? mobileAvailabilityState
      : browserAvailabilityState
  const interruptionReason = usesMobileNativeCapture ? mobileInterruptionReason : browserInterruptionReason
  const currentPendingUpload = pendingUploads[0] ?? null

  const cleanupBrowserRecordingResources = useCallback(() => {
    mediaRecorderRef.current = null
    stopMediaStream(mediaStreamRef.current)
    mediaStreamRef.current = null
  }, [])

  const measureSessionDuration = useCallback((startedAt: string, endedAt: string) => {
    const startedTime = new Date(startedAt).getTime()
    const endedTime = new Date(endedAt).getTime()

    if (Number.isNaN(startedTime) || Number.isNaN(endedTime) || endedTime <= startedTime) {
      return 0
    }

    return endedTime - startedTime
  }, [])

  const refreshBrowserPermissionState = useCallback(async () => {
    const nextPermissionState = await getBrowserPermissionState()
    setBrowserPermissionState(nextPermissionState)
    setBrowserAvailabilityState(availabilityFromPermission(nextPermissionState))
    return nextPermissionState
  }, [])

  const failActiveSession = useCallback(async (sessionId: string | null) => {
    if (!sessionId) return

    await updateCaptureSession(sessionId, {
      status: 'failed',
      processingStatus: 'failed',
    }).catch(() => null)
  }, [])

  const handleCaptureInterruption = useCallback(async (
    reason: AudioCaptureInterruptionReason,
    message: string,
  ) => {
    if (interruptionHandledRef.current) {
      return
    }

    interruptionHandledRef.current = true

    const activeSession = activeSessionRef.current
    recordedChunksRef.current = []
    activeSessionRef.current = null
    cleanupBrowserRecordingResources()
    await cancelMobileCapture().catch(() => null)
    await failActiveSession(activeSession?.id ?? null)

    if (!usesMobileNativeCapture) {
      setBrowserInterruptionReason(reason)
      setBrowserAvailabilityState('interrupted')
    }

    setPhase('error')
    setError(message)
  }, [cancelMobileCapture, cleanupBrowserRecordingResources, failActiveSession, usesMobileNativeCapture])

  const reset = useCallback(() => {
    if (phase === 'recording' || phase === 'saving-session') {
      return
    }

    recordedChunksRef.current = []
    activeSessionRef.current = null
    interruptionHandledRef.current = false
    setSavedSession(null)
    setError(null)
    clearMobileCaptureError()
    setBrowserInterruptionReason(null)
    setBrowserAvailabilityState(availabilityFromPermission(browserPermissionState))
    setPhase('ready')
  }, [browserPermissionState, clearMobileCaptureError, phase])

  const clearError = useCallback(() => {
    setError(null)
    clearMobileCaptureError()
    setBrowserInterruptionReason(null)
    setBrowserAvailabilityState(availabilityFromPermission(browserPermissionState))
    if (usesMobileNativeCapture) {
      void refreshMobilePermissionState().catch(() => null)
    }
    if (phase === 'error') {
      setPhase(savedSession ? 'saved' : 'ready')
    }
  }, [browserPermissionState, clearMobileCaptureError, phase, refreshMobilePermissionState, savedSession, usesMobileNativeCapture])

  const retryPendingUpload = useCallback(async (sessionId?: string) => {
    const targetSessionId = sessionId || currentPendingUpload?.sessionId

    if (!targetSessionId) {
      return null
    }

    const pendingUpload = await findPendingUpload(targetSessionId)

    if (!pendingUpload) {
      throw new Error('Nao foi possivel encontrar a captura pendente para reenviar.')
    }

    setIsRetryingPendingUpload(true)
    setPhase('saving-session')
    setError(null)

    try {
      const persistedSession = await retryPendingCaptureUploadFromStore(pendingUpload.sessionId)
      setSavedSession(persistedSession)
      setPhase('saved')
      return persistedSession
    } catch {
      setSavedSession(null)
      setPhase('saved')
      return null
    } finally {
      setIsRetryingPendingUpload(false)
    }
  }, [currentPendingUpload?.sessionId, findPendingUpload])

  const startCapture = useCallback(async () => {
    if (!isSupported || phase === 'recording' || phase === 'saving-session') {
      return
    }

    recordedChunksRef.current = []
    activeSessionRef.current = null
    interruptionHandledRef.current = false
    setSavedSession(null)
    setError(null)
    clearMobileCaptureError()
    setBrowserInterruptionReason(null)

    let stream: MediaStream | null = null
    let createdSessionId: string | null = null

    try {
      const effectivePermissionState = usesMobileNativeCapture
        ? await refreshMobilePermissionState()
        : await refreshBrowserPermissionState()

      if (effectivePermissionState === 'denied') {
        throw new Error('Permita o uso do microfone para iniciar uma captura segura.')
      }

      const startedAt = new Date().toISOString()
      const platformSource = getPlatformSource()
      const session = await createCaptureSession({
        platformSource,
        startedAt,
        status: 'active',
        processingStatus: 'captured',
      })

      createdSessionId = session.id
      activeSessionRef.current = {
        id: session.id,
        userId: session.userId,
        provisionalFolderName: session.provisionalFolderName,
        startedAt: session.startedAt,
        platformSource: session.platformSource,
      }

      if (usesMobileNativeCapture) {
        await startMobileCapture()
      } else {
        if (!getBrowserCaptureSupported()) {
          throw new Error('A captura segura nao esta disponivel neste navegador.')
        }

        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mimeType = getPreferredMimeType()
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordedChunksRef.current.push(event.data)
          }
        }

        recorder.onerror = () => {
          void handleCaptureInterruption('recorder-error', 'A captura foi interrompida por um erro do gravador.')
        }

        stream.getTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            void handleCaptureInterruption('media-stream-ended', 'A captura foi interrompida porque o microfone deixou de entregar audio.')
          }, { once: true })
        })

        recorder.start()
        mediaRecorderRef.current = recorder
        mediaStreamRef.current = stream
        setBrowserAvailabilityState('available')
      }

      setPhase('recording')
    } catch (captureError) {
      stopMediaStream(stream)
      cleanupBrowserRecordingResources()
      await cancelMobileCapture().catch(() => null)
      await failActiveSession(createdSessionId)
      if (!usesMobileNativeCapture) {
        await refreshBrowserPermissionState().catch(() => null)
      }
      activeSessionRef.current = null
      setPhase('error')
      setError(mapSafeCaptureError(captureError))
    }
  }, [
    cancelMobileCapture,
    cleanupBrowserRecordingResources,
    clearMobileCaptureError,
    failActiveSession,
    handleCaptureInterruption,
    isSupported,
    phase,
    refreshBrowserPermissionState,
    refreshMobilePermissionState,
    startMobileCapture,
    usesMobileNativeCapture,
  ])

  const stopCapture = useCallback(async () => {
    const recorder = mediaRecorderRef.current
    const activeSession = activeSessionRef.current

    if (!activeSession || phase !== 'recording') {
      return
    }

    setPhase('saving-session')
    setError(null)

    try {
      let audioFile: File
      const endedAt = new Date().toISOString()
      let durationMs = measureSessionDuration(activeSession.startedAt, endedAt)

      if (usesMobileNativeCapture) {
        const captureResult = await stopMobileCapture()

        if (!captureResult) {
          throw new Error('A sessao terminou sem audio gravado.')
        }

        audioFile = captureResult.file
        durationMs = captureResult.durationMs || durationMs

        console.debug('[voiceideas:safe-capture]', {
          event: 'mobile-capture-result-ready-for-upload',
          sessionId: activeSession.id,
          platform: activeSession.platformSource,
          durationMs,
          fileName: audioFile.name,
          fileSize: audioFile.size,
          mimeType: audioFile.type,
          uri: captureResult.uri,
        })
      } else {
        if (!recorder) {
          throw new Error('A sessao terminou sem um gravador ativo.')
        }

        await new Promise<void>((resolve, reject) => {
          const handleStop = () => resolve()
          const handleError = () => reject(new Error('A sessao foi interrompida antes de salvar o audio bruto.'))

          recorder.addEventListener('stop', handleStop, { once: true })
          recorder.addEventListener('error', handleError, { once: true })
          recorder.stop()
        })

        const mimeType = recorder.mimeType || getPreferredMimeType()
        const audioBlob = new Blob(recordedChunksRef.current, {
          type: mimeType || 'audio/webm',
        })

        cleanupBrowserRecordingResources()

        if (!audioBlob.size) {
          throw new Error('A sessao terminou sem audio gravado.')
        }

        audioFile = new File(
          [audioBlob],
          `captura-${activeSession.id}.${extensionFromMimeType(audioBlob.type || mimeType)}`,
          { type: audioBlob.type || mimeType || 'audio/webm' },
        )
      }

      const pendingUpload = await queuePendingUpload({
        sessionId: activeSession.id,
        provisionalFolderName: activeSession.provisionalFolderName,
        platformSource: activeSession.platformSource,
        startedAt: activeSession.startedAt,
        endedAt,
        durationMs,
        fileName: audioFile.name,
        mimeType: audioFile.type || 'audio/webm',
        blob: audioFile,
      })

      try {
        const persistedSession = await flushPendingCaptureUploadRecord(pendingUpload)
        setSavedSession(persistedSession)
      } catch {
        setSavedSession(null)
      }

      setError(null)
      interruptionHandledRef.current = false
      setPhase('saved')
    } catch (captureError) {
      cleanupBrowserRecordingResources()
      await failActiveSession(activeSession.id)
      setPhase('error')
      setError(mapSafeCaptureError(captureError))
    } finally {
      recordedChunksRef.current = []
      activeSessionRef.current = null
    }
  }, [
    cleanupBrowserRecordingResources,
    failActiveSession,
    measureSessionDuration,
    phase,
    queuePendingUpload,
    stopMobileCapture,
    usesMobileNativeCapture,
  ])

  useEffect(() => {
    if (usesMobileNativeCapture) {
      return
    }

    void refreshBrowserPermissionState().catch(() => null)
  }, [refreshBrowserPermissionState, usesMobileNativeCapture])

  useEffect(() => {
    if (!usesMobileNativeCapture || phase !== 'recording' || mobileAvailabilityState !== 'interrupted') {
      return
    }

    void handleCaptureInterruption(
      mobileInterruptionReason ?? 'platform-restriction',
      error || 'A captura foi interrompida por uma restricao da plataforma.',
    )
  }, [
    error,
    handleCaptureInterruption,
    mobileAvailabilityState,
    mobileInterruptionReason,
    phase,
    usesMobileNativeCapture,
  ])

  return {
    isSupported,
    phase,
    error,
    pendingUploadsError,
    savedSession,
    pendingUploads,
    currentPendingUpload,
    capabilities: capabilities as AudioCaptureCapabilities,
    permissionState,
    availabilityState,
    interruptionReason,
    isPendingUploadStoreSupported,
    isRetryingPendingUpload,
    isRecording: phase === 'recording',
    isSavingSession: phase === 'saving-session',
    startCapture,
    stopCapture,
    retryPendingUpload,
    reset,
    clearError,
  }
}
