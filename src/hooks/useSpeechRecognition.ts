import { useState, useRef, useCallback } from 'react'
import { createSpeechRecognition, isSpeechRecognitionSupported } from '../lib/speech'

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)
  const finalTranscriptRef = useRef('')

  const isSupported = isSpeechRecognitionSupported()

  const start = useCallback(() => {
    setError(null)
    finalTranscriptRef.current = ''
    setTranscript('')
    setInterimTranscript('')

    const recognition = createSpeechRecognition(
      (result) => {
        if (result.isFinal) {
          finalTranscriptRef.current += result.transcript + ' '
          setTranscript(finalTranscriptRef.current.trim())
          setInterimTranscript('')
        } else {
          setInterimTranscript(result.transcript)
        }
      },
      (err) => setError(err),
      () => setIsListening(false),
    )

    if (recognition) {
      recognitionRef.current = recognition
      recognition.start()
      setIsListening(true)
    }
  }, [])

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setIsListening(false)
    setInterimTranscript('')
  }, [])

  const reset = useCallback(() => {
    stop()
    setTranscript('')
    setInterimTranscript('')
    finalTranscriptRef.current = ''
    setError(null)
  }, [stop])

  return {
    isListening,
    transcript,
    interimTranscript,
    error,
    isSupported,
    start,
    stop,
    reset,
    setTranscript,
  }
}
