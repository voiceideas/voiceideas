import type { PlatformSource } from '../../lib/platform'
import { getPlatformSource, isCapacitorApp } from '../../lib/platform'

export type AudioCaptureSupportState = 'supported' | 'partial' | 'unavailable'

export type AudioCapturePermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable'

export type AudioCaptureAvailabilityState =
  | 'available'
  | 'permission-required'
  | 'permission-denied'
  | 'foreground-required'
  | 'interrupted'
  | 'unavailable'

export type AudioCaptureInterruptionReason =
  | 'app-backgrounded'
  | 'recorder-error'
  | 'media-stream-ended'
  | 'platform-restriction'
  | null

export type AudioCaptureEngine =
  | 'browser-media-recorder'
  | 'capacitor-native-recorder'
  | 'unavailable'

export interface AudioCaptureCapabilities {
  platformSource: PlatformSource
  supportState: AudioCaptureSupportState
  engine: AudioCaptureEngine
  canRecordLongSession: boolean
  requiresForeground: boolean
  notes: string[]
}

function hasBrowserMediaRecorderSupport() {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

export function getAudioCaptureCapabilities(): AudioCaptureCapabilities {
  const platformSource = getPlatformSource()

  if (isCapacitorApp() && (platformSource === 'android' || platformSource === 'ios')) {
    return {
      platformSource,
      supportState: platformSource === 'ios' ? 'partial' : 'supported',
      engine: 'capacitor-native-recorder',
      canRecordLongSession: true,
      requiresForeground: true,
      notes: [
        platformSource === 'ios'
          ? 'No iPhone, a captura segura funciona em primeiro plano e pode ser interrompida ao sair do app.'
          : 'No Android, a captura segura usa gravacao nativa e mantem a tela ativa durante a sessao.',
        'Mantenha a tela e o app ativos durante a sessao.',
      ],
    }
  }

  if (hasBrowserMediaRecorderSupport()) {
    return {
      platformSource,
      supportState: 'supported',
      engine: 'browser-media-recorder',
      canRecordLongSession: true,
      requiresForeground: false,
      notes: [
        'Usa MediaRecorder no ambiente atual.',
      ],
    }
  }

  return {
    platformSource,
    supportState: 'unavailable',
    engine: 'unavailable',
    canRecordLongSession: false,
    requiresForeground: false,
    notes: [
      'Nao ha engine de captura disponivel neste ambiente.',
    ],
  }
}

export function canUseMobileNativeAudioCapture(capabilities: AudioCaptureCapabilities) {
  return capabilities.engine === 'capacitor-native-recorder'
}
