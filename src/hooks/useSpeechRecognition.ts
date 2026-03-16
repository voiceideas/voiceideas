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
  const lastSavedTextRef = useRef('')

  const isSupported = isSpeechRecognitionSupported()

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const resetTranscriptState = useCallback(() => {
    finalTranscriptRef.current = ''
    lastSavedTextRef.current = ''
    setTranscript('')
    setInterimTranscript('')
  }, [])

  const doSave = useCallback((text: string) => {
    if (!text.trim() || !callbacksRef.current) return
    // Prevent saving the same text twice
    if (text.trim() === lastSavedTextRef.current) return
    lastSavedTextRef.current = text.trim()
    callbacksRef.current.onAutoSave(text.trim())
    finalTranscriptRef.current = ''
    setTranscript('')
  }, [])

  const startSilenceTimer = useCallback(() => {
    clearSilenceTimer()
    if (!continuousModeRef.current) return

    silenceTimerRef.current = setTimeout(() => {
      const text = finalTranscriptRef.current.trim()
      if (text) {
        doSave(text)
      }
    }, SILENCE_TIMEOUT_MS)
  }, [clearSilenceTimer, doSave])

  const startRecognition = useCallback(() => {
    // Stop any existing recognition first
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
      recognitionRef.current = null
    }

    const recognition = createSpeechRecognition(
      (result) => {
        clearSilenceTimer()

        if (result.isFinal) {
          const newText = result.transcript.trim()
          if (!newText) return

          // Skip if this is a duplicate of what we just saved
          if (newText === lastSavedTextRef.current) return

          finalTranscriptRef.current += result.transcript + ' '
          const currentText = finalTranscriptRef.current.trim()
          setInterimTranscript('')

          // Check keywords in continuous mode
          if (continuousModeRef.current && callbacksRef.current) {
            if (endsWithKeyword(currentText, SAVE_KEYWORDS)) {
              const cleanText = removeKeyword(currentText, SAVE_KEYWORDS)
              if (cleanText) {
                doSave(cleanText)
              } else {
                finalTranscriptRef.current = ''
                setTranscript('')
              }
              return
            }

            if (endsWithKeyword(currentText, CANCEL_KEYWORDS)) {
              callbacksRef.current.onAutoCancel()
              finalTranscriptRef.current = ''
              lastSavedTextRef.current = ''
              setTranscript('')
              return
            }
          }

          setTranscript(currentText)

          // Start silence timer in continuous mode
          if (continuousModeRef.current && currentText) {
            startSilenceTimer()
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

          // Save any pending text before restart
          const pendingText = finalTranscriptRef.current.trim()
          if (pendingText && !silenceTimerRef.current) {
            doSave(pendingText)
          }

          // Clear transcript state for fresh restart
          finalTranscriptRef.current = ''
          setTranscript('')
          setInterimTranscript('')

          setTimeout(() => {
            restartingRef.current = false
            if (continuousModeRef.current) {
              startRecognition()
            } else {
              setIsListening(false)
            }
          }, 500)
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
  }, [clearSilenceTimer, doSave, startSilenceTimer])

  // Manual mode - single recording
  const start = useCallback(() => {
    setError(null)
    resetTranscriptState()
    continuousModeRef.current = false
    setIsContinuousMode(false)
    startRecognition()
  }, [startRecognition, resetTranscriptState])

  const stop = useCallback(() => {
    clearSilenceTimer()
    continuousModeRef.current = false
    setIsContinuousMode(false)
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
      recognitionRef.current = null
    }
    setIsListening(false)
    setInterimTranscript('')
  }, [clearSilenceTimer])

  // Continuous mode
  const startContinuous = useCallback(
    (callbacks: ContinuousCallbacks) => {
      setError(null)
      resetTranscriptState()
      callbacksRef.current = callbacks
      continuousModeRef.current = true
      setIsContinuousMode(true)
      startRecognition()
    },
    [startRecognition, resetTranscriptState],
  )

  const stopContinuous = useCallback(() => {
    clearSilenceTimer()
    continuousModeRef.current = false
    setIsContinuousMode(false)
    callbacksRef.current = null
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
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
