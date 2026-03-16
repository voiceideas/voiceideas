import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribeAudio } from '../lib/transcribe'

const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096
const TARGET_SAMPLE_RATE = 16000

type BrowserAudioContextConstructor = new (contextOptions?: AudioContextOptions) => AudioContext

function getAudioContextConstructor(): BrowserAudioContextConstructor | null {
  if (typeof window === 'undefined') return null

  const browserWindow = window as Window & {
    webkitAudioContext?: BrowserAudioContextConstructor
  }
  const standardAudioContext = typeof AudioContext !== 'undefined'
    ? (AudioContext as BrowserAudioContextConstructor)
    : null

  return standardAudioContext || browserWindow.webkitAudioContext || null
}

function isAudioRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!getAudioContextConstructor()
  )
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

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

function mergeSamples(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Float32Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  return merged
}

function downsampleBuffer(buffer: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (!buffer.length || outputRate >= inputRate) return buffer

  const ratio = inputRate / outputRate
  const outputLength = Math.round(buffer.length / ratio)
  const result = new Float32Array(outputLength)
  let offsetBuffer = 0

  for (let index = 0; index < outputLength; index += 1) {
    const nextOffsetBuffer = Math.round((index + 1) * ratio)
    let total = 0
    let count = 0

    for (let sampleIndex = offsetBuffer; sampleIndex < nextOffsetBuffer && sampleIndex < buffer.length; sampleIndex += 1) {
      total += buffer[sampleIndex] || 0
      count += 1
    }

    result[index] = count ? total / count : 0
    offsetBuffer = nextOffsetBuffer
  }

  return result
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const outputBuffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(outputBuffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] || 0))
    const pcmValue = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    view.setInt16(offset, pcmValue, true)
    offset += bytesPerSample
  }

  return new Blob([outputBuffer], { type: 'audio/wav' })
}

export function useAudioTranscription() {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const sampleRateRef = useRef(TARGET_SAMPLE_RATE)
  const sampleChunksRef = useRef<Float32Array[]>([])
  const isCapturingRef = useRef(false)

  const isSupported = isAudioRecordingSupported()

  const clearCapture = useCallback(() => {
    isCapturingRef.current = false
    sampleChunksRef.current = []
    sampleRateRef.current = TARGET_SAMPLE_RATE

    processorNodeRef.current?.disconnect()
    sourceNodeRef.current?.disconnect()
    gainNodeRef.current?.disconnect()
    processorNodeRef.current = null
    sourceNodeRef.current = null
    gainNodeRef.current = null

    stopMediaStream(streamRef.current)
    streamRef.current = null

    const audioContext = audioContextRef.current
    audioContextRef.current = null

    if (audioContext) {
      void audioContext.close().catch(() => undefined)
    }
  }, [])

  const reset = useCallback(() => {
    clearCapture()
    setIsRecording(false)
    setIsTranscribing(false)
    setTranscript('')
    setError(null)
  }, [clearCapture])

  const start = useCallback(async () => {
    if (!isSupported) {
      setError('Seu navegador nao suporta gravacao de audio.')
      return
    }

    setError(null)
    setTranscript('')
    sampleChunksRef.current = []

    try {
      const AudioContextConstructor = getAudioContextConstructor()
      if (!AudioContextConstructor) {
        throw new Error('AudioContext unavailable')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })

      let audioContext: AudioContext

      try {
        audioContext = new AudioContextConstructor({ sampleRate: TARGET_SAMPLE_RATE })
      } catch {
        audioContext = new AudioContextConstructor()
      }

      if (audioContext.state === 'suspended') {
        await audioContext.resume().catch(() => undefined)
      }

      const sourceNode = audioContext.createMediaStreamSource(stream)
      const processorNode = audioContext.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1)
      const gainNode = audioContext.createGain()
      gainNode.gain.value = 0

      processorNode.onaudioprocess = (event) => {
        if (!isCapturingRef.current) return

        const channelData = event.inputBuffer.getChannelData(0)
        if (!channelData.length) return

        sampleChunksRef.current.push(new Float32Array(channelData))
      }

      sourceNode.connect(processorNode)
      processorNode.connect(gainNode)
      gainNode.connect(audioContext.destination)

      audioContextRef.current = audioContext
      streamRef.current = stream
      sourceNodeRef.current = sourceNode
      processorNodeRef.current = processorNode
      gainNodeRef.current = gainNode
      sampleRateRef.current = audioContext.sampleRate
      isCapturingRef.current = true

      setIsRecording(true)
    } catch (recordingError) {
      clearCapture()
      setIsRecording(false)
      setError(mapRecorderError(recordingError))
    }
  }, [clearCapture, isSupported])

  const stop = useCallback(() => {
    if (!audioContextRef.current) return

    isCapturingRef.current = false
    setIsRecording(false)

    processorNodeRef.current?.disconnect()
    sourceNodeRef.current?.disconnect()
    gainNodeRef.current?.disconnect()
    processorNodeRef.current = null
    sourceNodeRef.current = null
    gainNodeRef.current = null

    stopMediaStream(streamRef.current)
    streamRef.current = null

    const audioContext = audioContextRef.current
    audioContextRef.current = null
    if (audioContext) {
      void audioContext.close().catch(() => undefined)
    }

    const mergedSamples = mergeSamples(sampleChunksRef.current)
    sampleChunksRef.current = []

    if (!mergedSamples.length) {
      setError('O audio gravado ficou vazio. Tente falar um pouco mais perto do microfone.')
      return
    }

    const inputSampleRate = sampleRateRef.current
    const outputSampleRate = inputSampleRate > TARGET_SAMPLE_RATE
      ? TARGET_SAMPLE_RATE
      : inputSampleRate
    const outputSamples = inputSampleRate > TARGET_SAMPLE_RATE
      ? downsampleBuffer(mergedSamples, inputSampleRate, TARGET_SAMPLE_RATE)
      : mergedSamples
    const wavBlob = encodeWav(outputSamples, outputSampleRate)

    if (wavBlob.size === 0) {
      setError('O audio gravado ficou vazio. Tente falar um pouco mais perto do microfone.')
      return
    }

    setIsTranscribing(true)
    void transcribeAudio(wavBlob)
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
  }, [])

  useEffect(() => {
    return () => {
      clearCapture()
    }
  }, [clearCapture])

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
