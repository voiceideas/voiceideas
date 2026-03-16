import { useState, useRef, useCallback, useEffect } from 'react'
import {
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  mergeTranscriptSegments,
  normalizeTranscript,
  sanitizeTranscript,
  stripTranscriptPrefix,
  type BrowserSpeechRecognitionInstance,
} from '../lib/speech'

const SAVE_KEYWORDS = ['salvar nota', 'salvar', 'gravar nota', 'pronto']
const CANCEL_KEYWORDS = ['cancelar nota', 'cancelar', 'apagar']
const SILENCE_TIMEOUT_MS = 5000
const DUPLICATE_SAVE_WINDOW_MS = 3000

function removeKeyword(text: string, keywords: string[]): string {
  const normalizedText = sanitizeTranscript(text)
  const lower = normalizedText.toLowerCase()
  for (const kw of keywords) {
    if (lower.endsWith(kw)) {
      return normalizedText.slice(0, normalizedText.length - kw.length).trim()
    }
  }
  return normalizedText
}

function endsWithKeyword(text: string, keywords: string[]): boolean {
  const lower = normalizeTranscript(text).toLowerCase()
  return keywords.some((kw) => lower.endsWith(kw))
}

interface ContinuousCallbacks {
  onAutoSave: (text: string) => void | Promise<void>
  onAutoCancel: () => void
}

function stopRecognition(recognition: BrowserSpeechRecognitionInstance | null) {
  if (!recognition) return

  try {
    recognition.stop()
  } catch {
    // Browsers throw if stop() happens after the session already ended.
  }
}

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isContinuousMode, setIsContinuousMode] = useState(false)
  const recognitionRef = useRef<BrowserSpeechRecognitionInstance | null>(null)
  const finalTranscriptRef = useRef('')
  const continuousModeRef = useRef(false)
  const callbacksRef = useRef<ContinuousCallbacks | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartingRef = useRef(false)
  const lastSavedRef = useRef({ text: '', at: 0 })
  const lastFinalChunkRef = useRef('')
  const startRecognitionRef = useRef<() => void>(() => undefined)

  const isSupported = isSpeechRecognitionSupported()

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const clearCurrentNote = useCallback(() => {
    finalTranscriptRef.current = ''
    lastFinalChunkRef.current = ''
    setTranscript('')
    setInterimTranscript('')
  }, [])

  const resetTranscriptState = useCallback(() => {
    lastSavedRef.current = { text: '', at: 0 }
    clearCurrentNote()
  }, [clearCurrentNote])

  const wasRecentlySaved = useCallback((text: string) => {
    const normalizedText = sanitizeTranscript(text)
    if (!normalizedText) return false

    const { text: lastSavedText, at } = lastSavedRef.current
    return (
      normalizedText === lastSavedText &&
      Date.now() - at < DUPLICATE_SAVE_WINDOW_MS
    )
  }, [])

  const rememberSavedText = useCallback((text: string) => {
    lastSavedRef.current = { text: sanitizeTranscript(text), at: Date.now() }
  }, [])

  const doSave = useCallback((text: string) => {
    const normalizedText = sanitizeTranscript(text)
    if (!normalizedText || !callbacksRef.current || wasRecentlySaved(normalizedText)) {
      return
    }

    clearSilenceTimer()
    rememberSavedText(normalizedText)
    clearCurrentNote()
    void Promise.resolve(callbacksRef.current.onAutoSave(normalizedText)).catch(() => {
      lastSavedRef.current = { text: '', at: 0 }
      finalTranscriptRef.current = normalizedText
      setTranscript(normalizedText)
    })
  }, [clearCurrentNote, clearSilenceTimer, rememberSavedText, wasRecentlySaved])

  const startSilenceTimer = useCallback(() => {
    clearSilenceTimer()
    if (!continuousModeRef.current) return

    silenceTimerRef.current = setTimeout(() => {
      const text = sanitizeTranscript(finalTranscriptRef.current)
      if (text) {
        doSave(text)
      }
    }, SILENCE_TIMEOUT_MS)
  }, [clearSilenceTimer, doSave])

  const startRecognition = useCallback(() => {
    stopRecognition(recognitionRef.current)
    recognitionRef.current = null

    const recognition = createSpeechRecognition(
      (result) => {
        clearSilenceTimer()

        if (result.isFinal) {
          const newText = sanitizeTranscript(result.transcript)
          if (!newText) return

          if (!finalTranscriptRef.current && wasRecentlySaved(newText)) {
            return
          }

          if (newText === lastFinalChunkRef.current) {
            return
          }

          const currentText = sanitizeTranscript(
            mergeTranscriptSegments(finalTranscriptRef.current, newText),
          )
          finalTranscriptRef.current = currentText
          lastFinalChunkRef.current = newText
          setInterimTranscript('')

          if (continuousModeRef.current && callbacksRef.current) {
            if (endsWithKeyword(currentText, SAVE_KEYWORDS)) {
              const cleanText = removeKeyword(currentText, SAVE_KEYWORDS)
              if (cleanText) {
                doSave(cleanText)
              } else {
                clearCurrentNote()
              }
              return
            }

            if (endsWithKeyword(currentText, CANCEL_KEYWORDS)) {
              clearSilenceTimer()
              callbacksRef.current.onAutoCancel()
              lastSavedRef.current = { text: '', at: 0 }
              clearCurrentNote()
              return
            }
          }

          setTranscript(currentText)

          if (continuousModeRef.current) {
            startSilenceTimer()
          }

          return
        }

        const nextInterim = sanitizeTranscript(
          stripTranscriptPrefix(finalTranscriptRef.current, result.transcript),
        )
        if (!finalTranscriptRef.current && wasRecentlySaved(nextInterim)) {
          setInterimTranscript('')
          return
        }

        setInterimTranscript(nextInterim)
      },
      (err) => setError(err),
      () => {
        if (!continuousModeRef.current) {
          setIsListening(false)
          setInterimTranscript('')
          return
        }

        if (restartingRef.current) {
          return
        }

        restartingRef.current = true
        setIsListening(false)
        setInterimTranscript('')

        const pendingText = sanitizeTranscript(finalTranscriptRef.current)
        if (pendingText && !silenceTimerRef.current) {
          startSilenceTimer()
        }

        setTimeout(() => {
          restartingRef.current = false
          if (continuousModeRef.current) {
            startRecognitionRef.current()
          }
        }, 500)
      },
      { continuous: continuousModeRef.current },
    )

    if (!recognition) {
      setIsListening(false)
      return
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setIsListening(true)
    } catch {
      setError('Nao foi possivel iniciar a gravacao. Tente novamente.')
      setIsListening(false)
    }
  }, [clearCurrentNote, clearSilenceTimer, doSave, startSilenceTimer, wasRecentlySaved])

  useEffect(() => {
    startRecognitionRef.current = startRecognition
  }, [startRecognition])

  // Manual mode - single recording
  const start = useCallback(() => {
    setError(null)
    resetTranscriptState()
    callbacksRef.current = null
    continuousModeRef.current = false
    setIsContinuousMode(false)
    startRecognition()
  }, [startRecognition, resetTranscriptState])

  const stop = useCallback(() => {
    clearSilenceTimer()
    continuousModeRef.current = false
    setIsContinuousMode(false)
    stopRecognition(recognitionRef.current)
    recognitionRef.current = null
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
    stopRecognition(recognitionRef.current)
    recognitionRef.current = null
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
