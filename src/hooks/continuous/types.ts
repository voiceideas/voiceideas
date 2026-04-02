export type ContinuousPlatform = 'web' | 'macos' | 'android'

export type ContinuousStrategy =
  | 'web-speech'
  | 'android-native'
  | 'audio-fallback'

export type ContinuousRuntimeState =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'segment-finalizing'
  | 'saving'
  | 'restart-pending'
  | 'error'

export type SegmentSnapshot = {
  text: string
  createdAt: number
  source: ContinuousStrategy
  sessionId: string
  segmentId: string
}

export type ContinuousLogEvent =
  | 'session-started'
  | 'listening'
  | 'partial-received'
  | 'segment-ended'
  | 'save-started'
  | 'save-succeeded'
  | 'save-failed'
  | 'restart-started'
  | 'restart-succeeded'
  | 'restart-failed'
  | 'session-stopped'

export type ContinuousCallbacks = {
  onAutoSave: (text: string) => void | Promise<void>
  onAutoCancel: () => void
}

export type NativeListenerHandle = { remove: () => Promise<void> }
