import { useMemo } from 'react'
import { sanitizeTranscript } from '../../lib/speech'
import { useSpeechRecognition } from '../useSpeechRecognition'
import type { ContinuousCallbacks } from './types'

type StopContinuousOptions = {
  savePending?: boolean
}

export function useContinuousSpeechController() {
  const speech = useSpeechRecognition()

  const currentTranscript = useMemo(
    () => sanitizeTranscript(`${speech.transcript} ${speech.interimTranscript}`),
    [speech.interimTranscript, speech.transcript],
  )

  return {
    state: speech.continuousRuntimeState,
    strategy: speech.continuousStrategy,
    isListening: speech.isListening,
    isSupported: speech.isSupported,
    isContinuousMode: speech.isContinuousMode,
    error: speech.error,
    transcript: speech.transcript,
    interimTranscript: speech.interimTranscript,
    currentTranscript,
    supportsVoiceCommands: speech.supportsVoiceCommands,
    usesAudioOnlyContinuousFallback: speech.usesAudioOnlyContinuousFallback,
    clearError: speech.clearError,
    stopSingleSpeech: speech.stop,
    startContinuous: (callbacks: ContinuousCallbacks) => {
      speech.startContinuous(callbacks)
    },
    stopContinuous: (options?: StopContinuousOptions) => {
      speech.stopContinuous(options)
    },
  }
}
