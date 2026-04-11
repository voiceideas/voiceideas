import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

export type SecureCaptureState =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'error'

export interface StartCaptureOptions {
  mode: 'safe' | 'continuous'
  sessionId?: string
  startedAt?: string
  userId?: string
  provisionalFolderName?: string
  platformSource?: string
}

export interface CaptureStatus {
  state: SecureCaptureState
  sessionId?: string
  startedAt?: string
  elapsedMs?: number
  error?: string
  outputUri?: string
  mimeType?: string
  updatedAt?: string
  currentOutput?: string
  chunkCount?: number
  provisionalFolderName?: string
  userId?: string
  platformSource?: string
  mode?: 'safe' | 'continuous'
}

export interface SecureCaptureEvent {
  type: 'statusChanged'
  status: CaptureStatus
}

export interface SecureCapturePlugin {
  startCapture(options: StartCaptureOptions): Promise<CaptureStatus>
  stopCapture(): Promise<CaptureStatus>
  getCaptureStatus(): Promise<CaptureStatus>
  addListener(
    eventName: 'secureCaptureEvent',
    listener: (event: SecureCaptureEvent) => void,
  ): Promise<PluginListenerHandle>
}

export const SecureCapture = registerPlugin<SecureCapturePlugin>('SecureCapture')
