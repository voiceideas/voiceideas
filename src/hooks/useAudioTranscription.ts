import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribeAudio } from '../lib/transcribe'

const AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg;codecs=opus',
]

function isAudioRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return ''
  }

  return AUDIO_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || ''
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

function mapRecorderError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Permita o uso do microfone para gravar sua ideia.'
    }

    if (error.name === 'NotFoundError') {
      return 'Nenhum microfone foi encontrado neste aparelho.'
    }
  }

  return 'Nao foi possivel gravar o audio. Tente novamente.'
}

export function useAudioTranscription() {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef('')

  const isSupported = isAudioRecordingSupported()

  const clearRecorder = useCallback(() => {
    recorderRef.current = null
    chunksRef.current = []
    mimeTypeRef.current = ''
    stopMediaStream(streamRef.current)
    streamRef.current = null
  }, [])

  const reset = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }

    clearRecorder()
    setIsRecording(false)
    setIsTranscribing(false)
    setTranscript('')
    setError(null)
  }, [clearRecorder])

  const start = useCallback(async () => {
    if (!isSupported) {
      setError('Seu navegador nao suporta gravacao de audio.')
      return
    }

    setError(null)
    setTranscript('')
    chunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
      const mimeType = getSupportedMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      mimeTypeRef.current = recorder.mimeType || mimeType
      streamRef.current = stream

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        setError('A gravacao foi interrompida antes da transcricao.')
        setIsRecording(false)
        setIsTranscribing(false)
        clearRecorder()
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeTypeRef.current || chunksRef.current[0]?.type || 'audio/webm',
        })

        setIsRecording(false)
        clearRecorder()

        if (blob.size === 0) {
          setError('O audio gravado ficou vazio. Tente falar um pouco mais perto do microfone.')
          return
        }

        setIsTranscribing(true)
        void transcribeAudio(blob)
          .then((text) => {
            setTranscript(text)
          })
          .catch((transcriptionError: unknown) => {
            setError(
              transcriptionError instanceof Error
                ? transcriptionError.message
                : 'Falha ao transcrever o audio.',
            )
          })
          .finally(() => {
            setIsTranscribing(false)
          })
      }

      recorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch (recordingError) {
      clearRecorder()
      setIsRecording(false)
      setError(mapRecorderError(recordingError))
    }
  }, [clearRecorder, isSupported])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder) return

    if (recorder.state === 'inactive') {
      clearRecorder()
      setIsRecording(false)
      return
    }

    recorder.stop()
  }, [clearRecorder])

  useEffect(() => {
    return () => {
      stopMediaStream(streamRef.current)
    }
  }, [])

  return {
    isSupported,
    isRecording,
    isTranscribing,
    transcript,
    error,
    start,
    stop,
    reset,
    setTranscript,
  }
}
