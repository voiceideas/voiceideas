import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import {
  CapacitorAudioRecorder,
  RecordingStatus,
} from '@capgo/capacitor-audio-recorder'
import type {
  AudioCaptureAvailabilityState,
  AudioCaptureCapabilities,
  AudioCaptureInterruptionReason,
  AudioCapturePermissionState,
} from '../../utils/platform/audioCaptureCapabilities'
import { getAudioCaptureCapabilities } from '../../utils/platform/audioCaptureCapabilities'

export interface MobileAudioCaptureResult {
  blob: Blob | null
  durationMs: number
  mimeType: string | null
  uri: string | null
}

function mapMobileCaptureError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    if (message.includes('permission') || message.includes('microphone')) {
      return 'Permita o uso do microfone para iniciar a captura movel.'
    }
  }

  return 'Nao foi possivel iniciar ou encerrar a captura movel.'
}

function mapPermissionState(
  state: 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied' | undefined,
): AudioCapturePermissionState {
  if (!state) return 'unavailable'
  if (state === 'granted') return 'granted'
  if (state === 'denied') return 'denied'
  return 'prompt'
}

function availabilityFromPermission(
  permissionState: AudioCapturePermissionState,
  requiresForeground = false,
  isCaptureActive = false,
): AudioCaptureAvailabilityState {
  if (permissionState === 'granted') {
    if (requiresForeground && !isCaptureActive) return 'foreground-required'
    return 'available'
  }
  if (permissionState === 'denied') return 'permission-denied'
  if (permissionState === 'prompt') return 'permission-required'
  return 'unavailable'
}

export function useMobileAudioCapture() {
  const capabilities = useMemo<AudioCaptureCapabilities>(() => getAudioCaptureCapabilities(), [])
  const [error, setError] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [durationMs, setDurationMs] = useState(0)
  const [lastResult, setLastResult] = useState<MobileAudioCaptureResult | null>(null)
  const [permissionState, setPermissionState] = useState<AudioCapturePermissionState>(
    capabilities.engine === 'capacitor-native-recorder' ? 'prompt' : 'unavailable',
  )
  const [availabilityState, setAvailabilityState] = useState<AudioCaptureAvailabilityState>(
    capabilities.engine === 'capacitor-native-recorder' ? 'permission-required' : 'unavailable',
  )
  const [interruptionReason, setInterruptionReason] = useState<AudioCaptureInterruptionReason>(null)
  const startedAtRef = useRef<number | null>(null)
  const durationTimerRef = useRef<number | null>(null)
  const errorListenerRef = useRef<PluginListenerHandle | null>(null)
  const appStateListenerRef = useRef<PluginListenerHandle | null>(null)

  const stopDurationTicker = useCallback(() => {
    if (durationTimerRef.current !== null) {
      window.clearInterval(durationTimerRef.current)
      durationTimerRef.current = null
    }
  }, [])

  const startDurationTicker = useCallback(() => {
    stopDurationTicker()
    durationTimerRef.current = window.setInterval(() => {
      if (startedAtRef.current) {
        setDurationMs(Date.now() - startedAtRef.current)
      }
    }, 250)
  }, [stopDurationTicker])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const refreshPermissionState = useCallback(async () => {
    if (capabilities.engine !== 'capacitor-native-recorder') {
      setPermissionState('unavailable')
      setAvailabilityState('unavailable')
      return 'unavailable' as const
    }

    const permissions = await CapacitorAudioRecorder.checkPermissions()
    const nextPermissionState = mapPermissionState(permissions.recordAudio)
    setPermissionState(nextPermissionState)
    setAvailabilityState(availabilityFromPermission(nextPermissionState, capabilities.requiresForeground, false))
    return nextPermissionState
  }, [capabilities.engine, capabilities.requiresForeground])

  const getCurrentDuration = useCallback(() => {
    if (!startedAtRef.current || !isRecording) return durationMs
    return Date.now() - startedAtRef.current
  }, [durationMs, isRecording])

  const getCaptureResult = useCallback(() => lastResult, [lastResult])

  const getCaptureCapabilities = useCallback(() => capabilities, [capabilities])

  const cancelCapture = useCallback(async () => {
    if (capabilities.engine !== 'capacitor-native-recorder') {
      return
    }

    try {
      const { status } = await CapacitorAudioRecorder.getRecordingStatus()

      if (status !== RecordingStatus.Inactive) {
        await CapacitorAudioRecorder.cancelRecording()
      }
    } catch {
      // Ignore native cleanup errors.
    } finally {
      stopDurationTicker()
      startedAtRef.current = null
      setIsRecording(false)
      setDurationMs(0)
      if (interruptionReason === null) {
        setAvailabilityState(availabilityFromPermission(permissionState, capabilities.requiresForeground, false))
      }
    }
  }, [capabilities.engine, capabilities.requiresForeground, interruptionReason, permissionState, stopDurationTicker])

  const startCapture = useCallback(async () => {
    if (capabilities.engine !== 'capacitor-native-recorder') {
      throw new Error('Captura movel nativa indisponivel neste ambiente.')
    }

    setError(null)
    setLastResult(null)
    setInterruptionReason(null)

    const currentPermissionState = await refreshPermissionState()
    if (currentPermissionState === 'denied') {
      const permissionError = new Error('Permita o uso do microfone para iniciar a captura movel.')
      setError(permissionError.message)
      setAvailabilityState('permission-denied')
      throw permissionError
    }

    try {
      const permissions = await CapacitorAudioRecorder.requestPermissions()
      const requestedPermissionState = mapPermissionState(permissions.recordAudio)
      setPermissionState(requestedPermissionState)
      setAvailabilityState(availabilityFromPermission(requestedPermissionState, capabilities.requiresForeground, false))

      if (requestedPermissionState !== 'granted') {
        const permissionError = new Error('Permita o uso do microfone para iniciar a captura movel.')
        setError(permissionError.message)
        throw permissionError
      }

      await cancelCapture()
      await CapacitorAudioRecorder.startRecording({
        sampleRate: 16000,
        bitRate: 64000,
      })
      startedAtRef.current = Date.now()
      setDurationMs(0)
      setIsRecording(true)
      setAvailabilityState('available')
      startDurationTicker()
    } catch (captureError) {
      const message = mapMobileCaptureError(captureError)
      setError(message)
      throw new Error(message)
    }
  }, [cancelCapture, capabilities.engine, capabilities.requiresForeground, refreshPermissionState, startDurationTicker])

  const stopCapture = useCallback(async () => {
    if (capabilities.engine !== 'capacitor-native-recorder') {
      throw new Error('Captura movel nativa indisponivel neste ambiente.')
    }

    try {
      const result = await CapacitorAudioRecorder.stopRecording()
      const rawDurationMs = typeof result.duration === 'number' ? result.duration : 0
      const resolvedDurationMs = rawDurationMs > 0 ? rawDurationMs : getCurrentDuration()
      const captureResult: MobileAudioCaptureResult = {
        blob: result.blob ?? null,
        durationMs: resolvedDurationMs,
        mimeType: result.blob?.type ?? null,
        uri: result.uri ?? null,
      }

      console.debug('[voiceideas:mobile-capture]', {
        event: 'native-stop-recording-result',
        platform: Capacitor.getPlatform(),
        rawDurationMs,
        resolvedDurationMs,
        uri: result.uri ?? null,
        blobSize: result.blob?.size ?? 0,
        blobType: result.blob?.type ?? null,
      })

      setLastResult(captureResult)
      setDurationMs(captureResult.durationMs)
      setInterruptionReason(null)
      setAvailabilityState(availabilityFromPermission(permissionState, capabilities.requiresForeground, false))
      return captureResult
    } catch (captureError) {
      const message = mapMobileCaptureError(captureError)
      setError(message)
      throw new Error(message)
    } finally {
      stopDurationTicker()
      startedAtRef.current = null
      setIsRecording(false)
    }
  }, [capabilities.engine, capabilities.requiresForeground, getCurrentDuration, permissionState, stopDurationTicker])

  useEffect(() => {
    if (capabilities.engine !== 'capacitor-native-recorder') {
      return
    }

    let active = true

    void refreshPermissionState().catch(() => null)

    void CapacitorAudioRecorder.addListener('recordingError', (event) => {
      if (!active) return
      setInterruptionReason('recorder-error')
      setAvailabilityState('interrupted')
      setError(event.message || 'A captura movel encontrou um erro.')
    }).then((listener) => {
      if (active) {
        errorListenerRef.current = listener
      } else {
        void listener.remove()
      }
    }).catch(() => null)

    void CapacitorApp.addListener('appStateChange', (state) => {
      if (!active) return

      if (!state.isActive && isRecording && capabilities.requiresForeground) {
        setInterruptionReason('app-backgrounded')
        setAvailabilityState('interrupted')
        setError('A captura foi interrompida porque o app saiu do primeiro plano. No iPhone, mantenha o VoiceIdeas aberto durante a sessao.')
        void cancelCapture()
      }
    }).then((listener) => {
      if (active) {
        appStateListenerRef.current = listener
      } else {
        void listener.remove()
      }
    }).catch(() => null)

    return () => {
      active = false
      stopDurationTicker()
      startedAtRef.current = null
      void errorListenerRef.current?.remove()
      errorListenerRef.current = null
      void appStateListenerRef.current?.remove()
      appStateListenerRef.current = null
    }
  }, [cancelCapture, capabilities.engine, capabilities.requiresForeground, isRecording, refreshPermissionState, stopDurationTicker])

  return {
    capabilities,
    isSupported: capabilities.engine !== 'unavailable',
    isRecording,
    durationMs,
    error,
    permissionState,
    availabilityState,
    interruptionReason,
    startCapture,
    stopCapture,
    cancelCapture,
    clearError,
    refreshPermissionState,
    getCurrentDuration,
    getCaptureResult,
    getCaptureCapabilities,
  }
}
