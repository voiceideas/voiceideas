import { useCallback, type MutableRefObject } from 'react'

type UseAudioFallbackContinuousArgs = {
  audioOnlyContinuousRef: MutableRefObject<boolean>
  startHighQualityAudioCapture: () => Promise<string | null>
  onListeningStarted: () => void
  onStartFailure: (message: string) => void
}

export function useAudioFallbackContinuous({
  audioOnlyContinuousRef,
  startHighQualityAudioCapture,
  onListeningStarted,
  onStartFailure,
}: UseAudioFallbackContinuousArgs) {
  return useCallback(async () => {
    audioOnlyContinuousRef.current = true
    const captureError = await startHighQualityAudioCapture()

    if (captureError) {
      audioOnlyContinuousRef.current = false
      onStartFailure(captureError)
      return
    }

    onListeningStarted()
  }, [
    audioOnlyContinuousRef,
    onListeningStarted,
    onStartFailure,
    startHighQualityAudioCapture,
  ])
}
