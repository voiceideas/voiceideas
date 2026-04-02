import { useCallback } from 'react'

type UseWebContinuousSpeechArgs = {
  clearAudioCapture: () => void
  startRecognition: () => void
}

export function useWebContinuousSpeech({
  clearAudioCapture,
  startRecognition,
}: UseWebContinuousSpeechArgs) {
  return useCallback(async () => {
    clearAudioCapture()
    startRecognition()
  }, [clearAudioCapture, startRecognition])
}
