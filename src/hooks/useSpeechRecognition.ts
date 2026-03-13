import { useState, useRef, useCallback } from 'react'
import { createSpeechRecognition, isSpeechRecognitionSupported } from '../lib/speech'

const SAVE_KEYWORDS = ['salvar nota', 'salvar', 'gravar nota', 'pronto']
const CANCEL_KEYWORDS = ['cancelar nota', 'cancelar', 'apagar']
const SILENCE_TIMEOUT_MS = 5000

function removeKeyword(text: string, keywords: string[]): string {
  const lower = text.toLowerCase().trim()
  for (const kw of keywords) {
    if (lower.endsWith(kw)) {
      return text.slice(0, text.length - kw.length).trim()
    }
  }
  return text.trim()
}

function endsWithKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase().trim()
  return keywords.some((kw) => lower.endsWith(kw))
}

interface ContinuousCallbacks {
  onAutoSave: (text: string) => void
  onAutoCancel: () => void
}

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isContinuousMode, setIsContinuousMode] = useState(false)
  const recognitionRef = useRef<any>(null)
  const finalTranscriptRef = useRef('')
  const continuousModeRef = useRef(false)
  const callbacksRef = useRef<ContinuousCallbacks | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartingRef = useRef(false)

  const isSupported = isSpeechRecognitionSupported()

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const resetTranscriptState = useCallback(() => {
    finalTranscriptRef.current = ''
    setTranscript('')
    setInterimTranscript('')
  }, [])

  const startRecognition = useCallback(() => {
    const recognition = createSpeechRecognition(
      (result) => {
        clearSilenceTimer()

        if (result.isFinal) {
          finalTranscriptRef.current += result.transcript + ' '
          const currentText = finalTranscriptRef.current.trim()
          setInterimTranscript('')

          // Check keywords in continuous mode
          if (continuousModeRef.current && callbacksRef.current) {
            if (endsWithKeyword(currentText, SAVE_KEYWORDS)) {
              const cleanText = removeKeyword(currentText, SAVE_KEYWORDS)
              if (cleanText) {
                callbacksRef.current.onAutoSave(cleanText)
              }
              finalTranscriptRef.current = ''
              setTranscript('')
              return
            }

            if (endsWithKeyword(currentText, CANCEL_KEYWORDS)) {
              callbacksRef.current.onAutoCancel()
              finalTranscriptRef.current = ''
              setTranscript('')
              return
            }
          }

          setTranscript(currentText)

          // Start silence timer in continuous mode
          if (continuousModeRef.current && callbacksRef.current && currentText) {
            const cb = callbacksRef.current
            silenceTimerRef.current = setTimeout(() => {
              if (finalTranscriptRef.current.trim()) {
                cb.onAutoSave(finalTranscriptRef.current.trim())
                finalTranscriptRef.current = ''
                setTranscript('')
              }
            }, SILENCE_TIMEOUT_MS)
          }
        } else {
          setInterimTranscript(result.transcript)
        }
      },
      (err) => setError(err),
      () => {
        // onend - auto-restart in continuous mode
        if (continuousModeRef.current && !restartingRef.current) {
          restartingRef.current = true
          setTimeout(() => {
            restartingRef.current = false
            if (continuousModeRef.current) {
              startRecognition()
            } else {
              setIsListening(false)
            }
          }, 300)
        } else if (!continuousModeRef.current) {
          setIsListening(false)
        }
      },
    )

    if (recognition) {
      recognitionRef.current = recognition
      try {
        recognition.start()
        setIsListening(true)
      } catch {
        // Already started, ignore
      }
    }
  }, [clearSilenceTimer])

  // Manual mode - single recording
  const start = useCallback(() => {
    setError(null)
    finalTranscriptRef.current = ''
    setTranscript('')
    setInterimTranscript('')
    continuousModeRef.current = false
    setIsContinuousMode(false)
    startRecognition()
  }, [startRecognition])

  const stop = useCallback(() => {
    clearSilenceTimer()
    continuousModeRef.current = false
    setIsContinuousMode(false)
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // Already stopped
      }
      recognitionRef.current = null
    }
    setIsListening(false)
    setInterimTranscript('')
  }, [clearSilenceTimer])

  // Continuous mode
  const startContinuous = useCallback(
    (callbacks: ContinuousCallbacks) => {
      setError(null)
      finalTranscriptRef.current = ''
      setTranscript('')
      setInterimTranscript('')
      callbacksRef.current = callbacks
      continuousModeRef.current = true
      setIsContinuousMode(true)
      startRecognition()
    },
    [startRecognition],
  )

  const stopContinuous = useCallback(() => {
    clearSilenceTimer()
    continuousModeRef.current = false
    setIsContinuousMode(false)
    callbacksRef.current = null
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // Already stopped
      }
      recognitionRef.current = null
    }
    setIsListening(false)
    setInterimTranscript('')
  }, [clearSilenceTimer])

  const reset = useCallback(() => {
    stop()
    resetTranscriptState()
    setError(null)
  }, [stop, resetTranscriptState])

  return {
    isListening,
    transcript,
    interimTranscript,
    error,
    isSupported,
    isContinuousMode,
    start,
    stop,
    reset,
    setTranscript,
    startContinuous,
    stopContinuous,
  }
}
