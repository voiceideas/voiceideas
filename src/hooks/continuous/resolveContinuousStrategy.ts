import type { ContinuousStrategy } from './types'

export type ResolveContinuousStrategyArgs = {
  platform: 'web' | 'macos' | 'android'
  canUseWebSpeechRecognition: boolean
  canUseAndroidNativeRecognition: boolean
  shouldUseAudioFallback: boolean
}

export function resolveContinuousStrategy(
  args: ResolveContinuousStrategyArgs,
): ContinuousStrategy {
  if (args.platform === 'android' && args.canUseAndroidNativeRecognition) {
    return 'android-native'
  }

  if (
    (args.platform === 'web' || args.platform === 'macos') &&
    args.canUseWebSpeechRecognition
  ) {
    return 'web-speech'
  }

  if (args.shouldUseAudioFallback) {
    return 'audio-fallback'
  }

  return 'audio-fallback'
}
