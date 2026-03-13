import { useState, useRef, useCallback } from 'react'
import { transcribeAudio } from '../lib/whisper'

export function useWhisperRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const isSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  const startRecording = useCallback(async () => {
    setError(null)
    setTranscript('')
    chunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // Prefer webm, fallback to mp4, then any
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : ''

      const options: MediaRecorderOptions = mimeType ? { mimeType } : {}
      const recorder = new MediaRecorder(stream, options)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      recorder.start(1000) // collect data every 1s
      setIsRecording(true)
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Permissão de microfone negada. Habilite nas configurações do navegador.')
      } else {
        setError('Erro ao acessar microfone: ' + (err.message || err.name))
      }
    }
  }, [])

  const stopRecording = useCallback(async (): Promise<string> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        setIsRecording(false)
        resolve('')
        return
      }

      recorder.onstop = async () => {
        // Stop all tracks
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setIsRecording(false)

        if (chunksRef.current.length === 0) {
          resolve('')
          return
        }

        const mimeType = recorder.mimeType || 'audio/webm'
        const audioBlob = new Blob(chunksRef.current, { type: mimeType })
        chunksRef.current = []

        // Skip very short recordings (< 0.5s worth of data)
        if (audioBlob.size < 1000) {
          resolve('')
          return
        }

        setIsTranscribing(true)
        try {
          const text = await transcribeAudio(audioBlob)
          setTranscript(text)
          setIsTranscribing(false)
          resolve(text)
        } catch (err: any) {
          setError(err.message || 'Erro na transcrição')
          setIsTranscribing(false)
          resolve('')
        }
      }

      recorder.stop()
    })
  }, [])

  const reset = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
    setIsRecording(false)
    setIsTranscribing(false)
    setTranscript('')
    setError(null)
  }, [])

  return {
    isRecording,
    isTranscribing,
    transcript,
    error,
    isSupported,
    startRecording,
    stopRecording,
    reset,
    setTranscript,
  }
}
