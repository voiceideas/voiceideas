import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { KeepAwake } from '@capacitor-community/keep-awake'
import {
  CapacitorAudioRecorder,
  RecordingStatus,
} from '@capgo/capacitor-audio-recorder'
import {
  SecureCapture,
  type CaptureStatus as SecureCaptureStatus,
  type StartCaptureOptions as SecureCaptureStartCaptureOptions,
} from '../../plugins/secureCapture'
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
  const usesAndroidSecureCapture = capabilities.engine === 'android-secure-capture'
  const usesCapacitorRecorder = capabilities.engine === 'capacitor-native-recorder'
  const usesNativeCaptureEngine = usesAndroidSecureCapture || usesCapacitorRecorder
  const [error, setError] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [durationMs, setDurationMs] = useState(0)
  const [lastResult, setLastResult] = useState<MobileAudioCaptureResult | null>(null)
  const [permissionState, setPermissionState] = useState<AudioCapturePermissionState>(
    usesNativeCaptureEngine ? 'prompt' : 'unavailable',
  )
  const [availabilityState, setAvailabilityState] = useState<AudioCaptureAvailabilityState>(
    usesNativeCaptureEngine ? 'permission-required' : 'unavailable',
  )
  const [interruptionReason, setInterruptionReason] = useState<AudioCaptureInterruptionReason>(null)
  const [captureStatus, setCaptureStatus] = useState<SecureCaptureStatus | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const durationTimerRef = useRef<number | null>(null)
  const errorListenerRef = useRef<PluginListenerHandle | null>(null)
  const appStateListenerRef = useRef<PluginListenerHandle | null>(null)
  const secureCaptureListenerRef = useRef<PluginListenerHandle | null>(null)
  const keepAwakeActiveRef = useRef(false)

  const shouldKeepScreenAwake = capabilities.platformSource === 'android' && !usesAndroidSecureCapture

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

  const allowDeviceSleep = useCallback(async () => {
    if (!shouldKeepScreenAwake || !keepAwakeActiveRef.current) {
      return
    }

    try {
      await KeepAwake.allowSleep()
    } catch {
      // Ignore native wake-lock cleanup failures.
    } finally {
      keepAwakeActiveRef.current = false
    }
  }, [shouldKeepScreenAwake])

  const keepDeviceAwake = useCallback(async () => {
    if (!shouldKeepScreenAwake || keepAwakeActiveRef.current) {
      return
    }

    try {
      await KeepAwake.keepAwake()
      keepAwakeActiveRef.current = true
    } catch {
      // If wake-lock is unavailable, keep recording anyway.
    }
  }, [shouldKeepScreenAwake])

  const applySecureCaptureStatus = useCallback((status: SecureCaptureStatus) => {
    setCaptureStatus(status)
    setDurationMs(status.elapsedMs ?? 0)

    const active = status.state === 'starting' || status.state === 'recording' || status.state === 'stopping'
    setIsRecording(active)

    if (status.state === 'error') {
      setInterruptionReason('recorder-error')
      setAvailabilityState('interrupted')
      setError(status.error || 'A captura movel encontrou um erro.')
      return
    }

    setInterruptionReason(null)
    setAvailabilityState(availabilityFromPermission(permissionState, capabilities.requiresForeground, active))
  }, [capabilities.requiresForeground, permissionState])

  const syncSecureCaptureStatus = useCallback(async () => {
    if (!usesAndroidSecureCapture) {
      return null
    }

    try {
      const status = await SecureCapture.getCaptureStatus()
      applySecureCaptureStatus(status)
      return status
    } catch {
      return null
    }
  }, [applySecureCaptureStatus, usesAndroidSecureCapture])

  const refreshPermissionState = useCallback(async () => {
    if (!usesNativeCaptureEngine) {
      setPermissionState('unavailable')
      setAvailabilityState('unavailable')
      return 'unavailable' as const
    }

    const permissions = await CapacitorAudioRecorder.checkPermissions()
    const nextPermissionState = mapPermissionState(permissions.recordAudio)
    setPermissionState(nextPermissionState)
    setAvailabilityState(
      availabilityFromPermission(
        nextPermissionState,
        capabilities.requiresForeground,
        usesAndroidSecureCapture ? isRecording : false,
      ),
    )
    return nextPermissionState
  }, [capabilities.requiresForeground, isRecording, usesAndroidSecureCapture, usesNativeCaptureEngine])

  const getCurrentDuration = useCallback(() => {
    if (usesAndroidSecureCapture) {
      return captureStatus?.elapsedMs ?? durationMs
    }

    if (!startedAtRef.current || !isRecording) return durationMs
    return Date.now() - startedAtRef.current
  }, [captureStatus?.elapsedMs, durationMs, isRecording, usesAndroidSecureCapture])

  const getCaptureResult = useCallback(() => lastResult, [lastResult])

  const getCaptureCapabilities = useCallback(() => capabilities, [capabilities])

  const cancelCapture = useCallback(async () => {
    if (!usesNativeCaptureEngine) {
      return
    }

    if (usesAndroidSecureCapture) {
      try {
        const status = await SecureCapture.stopCapture()
        applySecureCaptureStatus(status)
      } catch {
        // Ignore native cleanup errors.
      } finally {
        setDurationMs(0)
        setLastResult(null)
      }
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
      await allowDeviceSleep()
      stopDurationTicker()
      startedAtRef.current = null
      setIsRecording(false)
      setDurationMs(0)
      if (interruptionReason === null) {
        setAvailabilityState(availabilityFromPermission(permissionState, capabilities.requiresForeground, false))
      }
    }
  }, [
    allowDeviceSleep,
    applySecureCaptureStatus,
    capabilities.requiresForeground,
    interruptionReason,
    permissionState,
    stopDurationTicker,
    usesAndroidSecureCapture,
    usesNativeCaptureEngine,
  ])

  const startCaptureWithOptions = useCallback(async (options: SecureCaptureStartCaptureOptions = { mode: 'safe' }) => {
    if (!usesNativeCaptureEngine) {
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

      if (usesAndroidSecureCapture) {
        const status = await SecureCapture.startCapture(options)
        applySecureCaptureStatus(status)
        return
      }

      await CapacitorAudioRecorder.startRecording({
        sampleRate: 16000,
        bitRate: 64000,
      })
      await keepDeviceAwake()
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
  }, [
    applySecureCaptureStatus,
    cancelCapture,
    capabilities.requiresForeground,
    keepDeviceAwake,
    refreshPermissionState,
    startDurationTicker,
    usesAndroidSecureCapture,
    usesNativeCaptureEngine,
  ])

  const stopCapture = useCallback(async () => {
    if (!usesNativeCaptureEngine) {
      throw new Error('Captura movel nativa indisponivel neste ambiente.')
    }

    try {
      if (usesAndroidSecureCapture) {
        const status = await SecureCapture.stopCapture()
        applySecureCaptureStatus(status)

        if (status.state === 'error') {
          throw new Error(status.error || 'Nao foi possivel finalizar a captura movel.')
        }

        const captureResult: MobileAudioCaptureResult = {
          blob: null,
          durationMs: status.elapsedMs ?? getCurrentDuration(),
          mimeType: status.mimeType ?? null,
          uri: status.outputUri ?? null,
        }

        setLastResult(captureResult)
        return captureResult
      }

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
      await allowDeviceSleep()
      stopDurationTicker()
      startedAtRef.current = null
      if (!usesAndroidSecureCapture) {
        setIsRecording(false)
      }
    }
  }, [
    allowDeviceSleep,
    applySecureCaptureStatus,
    capabilities.requiresForeground,
    getCurrentDuration,
    permissionState,
    stopDurationTicker,
    usesAndroidSecureCapture,
    usesNativeCaptureEngine,
  ])

  useEffect(() => {
    if (!usesNativeCaptureEngine) {
      return
    }

    let active = true

    void refreshPermissionState().catch(() => null)

    if (usesAndroidSecureCapture) {
      void syncSecureCaptureStatus().catch(() => null)

      void SecureCapture.addListener('secureCaptureEvent', (event) => {
        if (!active) return
        applySecureCaptureStatus(event.status)
      }).then((listener) => {
        if (active) {
          secureCaptureListenerRef.current = listener
        } else {
          void listener.remove()
        }
      }).catch(() => null)

      void CapacitorApp.addListener('appStateChange', (state) => {
        if (!active || !state.isActive) return
        void syncSecureCaptureStatus().catch(() => null)
      }).then((listener) => {
        if (active) {
          appStateListenerRef.current = listener
        } else {
          void listener.remove()
        }
      }).catch(() => null)

      return () => {
        active = false
        void secureCaptureListenerRef.current?.remove()
        secureCaptureListenerRef.current = null
        void appStateListenerRef.current?.remove()
        appStateListenerRef.current = null
      }
    }

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
        setError(
          capabilities.platformSource === 'ios'
            ? 'A captura foi interrompida porque o app saiu do primeiro plano. No iOS, mantenha o VoiceIdeas aberto para nao interromper a gravacao.'
            : 'A captura foi interrompida porque o app saiu do primeiro plano.',
        )
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
      void allowDeviceSleep()
      stopDurationTicker()
      startedAtRef.current = null
      void errorListenerRef.current?.remove()
      errorListenerRef.current = null
      void appStateListenerRef.current?.remove()
      appStateListenerRef.current = null
    }
  }, [
    allowDeviceSleep,
    applySecureCaptureStatus,
    cancelCapture,
    capabilities.platformSource,
    capabilities.requiresForeground,
    isRecording,
    refreshPermissionState,
    stopDurationTicker,
    syncSecureCaptureStatus,
    usesAndroidSecureCapture,
    usesNativeCaptureEngine,
  ])

  return {
    capabilities,
    isSupported: capabilities.engine !== 'unavailable',
    isRecording,
    durationMs,
    error,
    permissionState,
    availabilityState,
    interruptionReason,
    captureStatus,
    startCapture: startCaptureWithOptions,
    stopCapture,
    cancelCapture,
    clearError,
    refreshPermissionState,
    getCurrentDuration,
    getCaptureResult,
    getCaptureCapabilities,
  }
}
