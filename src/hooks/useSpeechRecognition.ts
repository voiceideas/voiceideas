import { useState, useRef, useCallback, useEffect } from 'react'
import { transcribeAudio } from '../lib/transcribe'
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
const DUPLICATE_SAVE_WINDOW_MS = 3000
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096
const TARGET_SAMPLE_RATE = 16000
const CONTINUOUS_SILENCE_THRESHOLD = 0.015
const CONTINUOUS_SILENCE_HOLD_MS = 1400
const CONTINUOUS_MIN_SEGMENT_MS = 900
const CONTINUOUS_PREROLL_MS = 250

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

function isHighQualityAudioCaptureSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!getAudioContextConstructor()
  )
}

function shouldUseAudioOnlyContinuousFallback(): boolean {
  if (typeof window === 'undefined') return false

  const browserWindow = window as Window & { __TAURI_INTERNALS__?: unknown }
  return Boolean(browserWindow.__TAURI_INTERNALS__)
}

function mapAudioCaptureError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Permita o uso do microfone para gravar ideias por voz.'
    }

    if (error.name === 'NotFoundError') {
      return 'Nenhum microfone foi encontrado neste aparelho.'
    }
  }

  return 'Nao foi possivel acessar o microfone para a escuta continua.'
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
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

    for (
      let sampleIndex = offsetBuffer;
      sampleIndex < nextOffsetBuffer && sampleIndex < buffer.length;
      sampleIndex += 1
    ) {
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

function getChunkDurationMs(chunk: Float32Array, sampleRate: number) {
  if (!sampleRate) return 0
  return (chunk.length / sampleRate) * 1000
}

function getChunkRms(chunk: Float32Array) {
  if (!chunk.length) return 0

  let sumSquares = 0

  for (let index = 0; index < chunk.length; index += 1) {
    const sample = chunk[index] || 0
    sumSquares += sample * sample
  }

  return Math.sqrt(sumSquares / chunk.length)
}

function removeKeyword(text: string, keywords: string[]): string {
  const normalizedText = sanitizeTranscript(text)
  const lower = normalizedText.toLowerCase()

  for (const keyword of keywords) {
    if (lower.endsWith(keyword)) {
      return normalizedText.slice(0, normalizedText.length - keyword.length).trim()
    }
  }

  return normalizedText
}

function endsWithKeyword(text: string, keywords: string[]): boolean {
  const lower = normalizeTranscript(text).toLowerCase()
  return keywords.some((keyword) => lower.endsWith(keyword))
}

interface ContinuousCallbacks {
  onAutoSave: (text: string) => void | Promise<void>
  onAutoCancel: () => void
}

interface SaveNoteOptions {
  audioBlob?: Blob | null
  callbacks?: ContinuousCallbacks | null
  stripKeywords?: string[]
}

interface StopContinuousOptions {
  savePending?: boolean
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
  const interimTranscriptRef = useRef('')
  const continuousModeRef = useRef(false)
  const callbacksRef = useRef<ContinuousCallbacks | null>(null)
  const restartingRef = useRef(false)
  const lastSavedRef = useRef({ text: '', at: 0 })
  const lastFinalChunkRef = useRef('')
  const startRecognitionRef = useRef<() => void>(() => undefined)
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const sampleRateRef = useRef(TARGET_SAMPLE_RATE)
  const sampleChunksRef = useRef<Float32Array[]>([])
  const isAudioCapturingRef = useRef(false)
  const audioOnlyContinuousRef = useRef(false)
  const audioOnlySpeechActiveRef = useRef(false)
  const audioOnlySegmentDurationMsRef = useRef(0)
  const audioOnlySilenceDurationMsRef = useRef(0)
  const audioOnlyPreRollChunksRef = useRef<Float32Array[]>([])
  const audioOnlyPreRollDurationMsRef = useRef(0)
  const activeCallbacksRef = useRef<ContinuousCallbacks | null>(null)
  const finalizeAudioOnlySegmentRef = useRef<(force?: boolean) => void>(() => undefined)

  const supportsVoiceCommands = isSpeechRecognitionSupported()
  const supportsAudioOnlyContinuous = (
    !supportsVoiceCommands &&
    shouldUseAudioOnlyContinuousFallback() &&
    isHighQualityAudioCaptureSupported()
  )
  const isSupported = supportsVoiceCommands || supportsAudioOnlyContinuous

  const resetCurrentAudioSegment = useCallback(() => {
    sampleChunksRef.current = []
    sampleRateRef.current = TARGET_SAMPLE_RATE
    audioOnlySpeechActiveRef.current = false
    audioOnlySegmentDurationMsRef.current = 0
    audioOnlySilenceDurationMsRef.current = 0
    audioOnlyPreRollChunksRef.current = []
    audioOnlyPreRollDurationMsRef.current = 0
  }, [])

  const clearCurrentNote = useCallback(() => {
    finalTranscriptRef.current = ''
    interimTranscriptRef.current = ''
    lastFinalChunkRef.current = ''
    setTranscript('')
    setInterimTranscript('')
  }, [])

  const clearAudioCapture = useCallback(() => {
    isAudioCapturingRef.current = false
    resetCurrentAudioSegment()

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
  }, [resetCurrentAudioSegment])

  const resetTranscriptState = useCallback(() => {
    lastSavedRef.current = { text: '', at: 0 }
    clearCurrentNote()
    resetCurrentAudioSegment()
  }, [clearCurrentNote, resetCurrentAudioSegment])

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

  const takeCurrentAudioSnapshot = useCallback((): Blob | null => {
    const inputSampleRate = sampleRateRef.current
    const mergedSamples = mergeSamples(sampleChunksRef.current)
    resetCurrentAudioSegment()

    if (!mergedSamples.length) {
      return null
    }

    const outputSampleRate = inputSampleRate > TARGET_SAMPLE_RATE
      ? TARGET_SAMPLE_RATE
      : inputSampleRate
    const outputSamples = inputSampleRate > TARGET_SAMPLE_RATE
      ? downsampleBuffer(mergedSamples, inputSampleRate, TARGET_SAMPLE_RATE)
      : mergedSamples
    const wavBlob = encodeWav(outputSamples, outputSampleRate)

    return wavBlob.size > 0 ? wavBlob : null
  }, [resetCurrentAudioSegment])

  const startHighQualityAudioCapture = useCallback(async (): Promise<string | null> => {
    if (!isHighQualityAudioCaptureSupported()) {
      return 'Seu navegador nao suporta captura continua de audio.'
    }

    clearAudioCapture()

    try {
      const AudioContextConstructor = getAudioContextConstructor()
      if (!AudioContextConstructor) {
        return 'AudioContext indisponivel para a escuta continua.'
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
        if (!isAudioCapturingRef.current) return

        const channelData = event.inputBuffer.getChannelData(0)
        if (!channelData.length) return
        const chunk = new Float32Array(channelData)

        if (!audioOnlyContinuousRef.current) {
          sampleChunksRef.current.push(chunk)
          return
        }

        const sampleRate = sampleRateRef.current || audioContext.sampleRate || TARGET_SAMPLE_RATE
        const chunkDurationMs = getChunkDurationMs(chunk, sampleRate)
        const isSpeaking = getChunkRms(chunk) >= CONTINUOUS_SILENCE_THRESHOLD

        if (!audioOnlySpeechActiveRef.current) {
          audioOnlyPreRollChunksRef.current.push(chunk)
          audioOnlyPreRollDurationMsRef.current += chunkDurationMs

          while (
            audioOnlyPreRollDurationMsRef.current > CONTINUOUS_PREROLL_MS &&
            audioOnlyPreRollChunksRef.current.length > 1
          ) {
            const removedChunk = audioOnlyPreRollChunksRef.current.shift()
            if (removedChunk) {
              audioOnlyPreRollDurationMsRef.current -= getChunkDurationMs(removedChunk, sampleRate)
            }
          }

          if (!isSpeaking) {
            return
          }

          audioOnlySpeechActiveRef.current = true
          sampleChunksRef.current = [...audioOnlyPreRollChunksRef.current]
          audioOnlySegmentDurationMsRef.current = audioOnlyPreRollDurationMsRef.current
          audioOnlySilenceDurationMsRef.current = 0
          audioOnlyPreRollChunksRef.current = []
          audioOnlyPreRollDurationMsRef.current = 0
          setTranscript('Capturando nota...')
          setInterimTranscript('')
        }

        sampleChunksRef.current.push(chunk)
        audioOnlySegmentDurationMsRef.current += chunkDurationMs

        if (isSpeaking) {
          audioOnlySilenceDurationMsRef.current = 0
          return
        }

        audioOnlySilenceDurationMsRef.current += chunkDurationMs

        if (audioOnlySilenceDurationMsRef.current >= CONTINUOUS_SILENCE_HOLD_MS) {
          finalizeAudioOnlySegmentRef.current()
        }
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
      isAudioCapturingRef.current = true

      return null
    } catch (error) {
      clearAudioCapture()
      return mapAudioCaptureError(error)
    }
  }, [clearAudioCapture])

  const saveResolvedNote = useCallback(async (
    fallbackText: string,
    options: SaveNoteOptions = {},
  ) => {
    const callbacks = options.callbacks ?? callbacksRef.current
    if (!callbacks) return

    const fallbackNormalized = sanitizeTranscript(
      options.stripKeywords
        ? removeKeyword(fallbackText, options.stripKeywords)
        : fallbackText,
    )
    const audioBlob = options.audioBlob ?? null

    clearCurrentNote()

    let nextText = fallbackNormalized

    if (audioBlob) {
      try {
        const transcribedText = await transcribeAudio(audioBlob)
        const cleanedText = options.stripKeywords
          ? removeKeyword(transcribedText, options.stripKeywords)
          : transcribedText

        nextText = sanitizeTranscript(cleanedText) || fallbackNormalized
      } catch {
        nextText = fallbackNormalized
      }
    }

    if (!nextText || wasRecentlySaved(nextText)) {
      return
    }

    rememberSavedText(nextText)

    try {
      await Promise.resolve(callbacks.onAutoSave(nextText))
    } catch {
      lastSavedRef.current = { text: '', at: 0 }
      finalTranscriptRef.current = nextText
      interimTranscriptRef.current = ''
      setTranscript(nextText)
    }
  }, [clearCurrentNote, rememberSavedText, wasRecentlySaved])

  const queueContinuousSave = useCallback((
    text: string,
    options: Omit<SaveNoteOptions, 'callbacks'> = {},
  ) => {
    const audioBlob = isAudioCapturingRef.current ? takeCurrentAudioSnapshot() : null
    void saveResolvedNote(text, { ...options, audioBlob })
  }, [saveResolvedNote, takeCurrentAudioSnapshot])

  const finalizeAudioOnlySegment = useCallback((force = false) => {
    const callbacks = activeCallbacksRef.current
    if (!callbacks) return

    if (!sampleChunksRef.current.length) {
      resetCurrentAudioSegment()
      return
    }

    if (!force && audioOnlySegmentDurationMsRef.current < CONTINUOUS_MIN_SEGMENT_MS) {
      return
    }

    const audioBlob = takeCurrentAudioSnapshot()
    if (!audioBlob) {
      return
    }

    setTranscript('Transcrevendo nota...')
    void saveResolvedNote('', { audioBlob, callbacks }).finally(() => {
      setTranscript('')
    })
  }, [resetCurrentAudioSegment, saveResolvedNote, takeCurrentAudioSnapshot])

  useEffect(() => {
    finalizeAudioOnlySegmentRef.current = finalizeAudioOnlySegment
  }, [finalizeAudioOnlySegment])

  const startRecognition = useCallback(() => {
    stopRecognition(recognitionRef.current)
    recognitionRef.current = null

    const recognition = createSpeechRecognition(
      (result) => {
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
          interimTranscriptRef.current = ''
          lastFinalChunkRef.current = newText
          setInterimTranscript('')

          if (continuousModeRef.current && callbacksRef.current) {
            if (endsWithKeyword(currentText, SAVE_KEYWORDS)) {
              queueContinuousSave(currentText, { stripKeywords: SAVE_KEYWORDS })
              return
            }

            if (endsWithKeyword(currentText, CANCEL_KEYWORDS)) {
              callbacksRef.current.onAutoCancel()
              lastSavedRef.current = { text: '', at: 0 }
              resetCurrentAudioSegment()
              clearCurrentNote()
              return
            }
          }

          setTranscript(currentText)
          return
        }

        const nextInterim = sanitizeTranscript(
          stripTranscriptPrefix(finalTranscriptRef.current, result.transcript),
        )
        interimTranscriptRef.current = nextInterim

        if (!finalTranscriptRef.current && wasRecentlySaved(nextInterim)) {
          interimTranscriptRef.current = ''
          setInterimTranscript('')
          return
        }

        setInterimTranscript(nextInterim)
      },
      (recognitionError) => setError(recognitionError),
      () => {
        if (!continuousModeRef.current) {
          setIsListening(false)
          interimTranscriptRef.current = ''
          setInterimTranscript('')
          return
        }

        if (restartingRef.current) {
          return
        }

        restartingRef.current = true
        setIsListening(false)

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
  }, [clearCurrentNote, queueContinuousSave, resetCurrentAudioSegment, wasRecentlySaved])

  useEffect(() => {
    startRecognitionRef.current = startRecognition
  }, [startRecognition])

  useEffect(() => {
    return () => {
      stopRecognition(recognitionRef.current)
      clearAudioCapture()
    }
  }, [clearAudioCapture])

  const start = useCallback(() => {
    setError(null)
    resetTranscriptState()
    callbacksRef.current = null
    activeCallbacksRef.current = null
    continuousModeRef.current = false
    audioOnlyContinuousRef.current = false
    setIsContinuousMode(false)
    clearAudioCapture()
    startRecognition()
  }, [clearAudioCapture, resetTranscriptState, startRecognition])

  const stop = useCallback(() => {
    continuousModeRef.current = false
    audioOnlyContinuousRef.current = false
    activeCallbacksRef.current = null
    setIsContinuousMode(false)
    stopRecognition(recognitionRef.current)
    recognitionRef.current = null
    clearAudioCapture()
    setIsListening(false)
    interimTranscriptRef.current = ''
    setInterimTranscript('')
  }, [clearAudioCapture])

  const startContinuous = useCallback((callbacks: ContinuousCallbacks) => {
    setError(null)
    resetTranscriptState()
    callbacksRef.current = callbacks
    activeCallbacksRef.current = callbacks
    continuousModeRef.current = true
    setIsContinuousMode(true)

    void (async () => {
      if (supportsVoiceCommands) {
        audioOnlyContinuousRef.current = false

        // Preserve the older desktop behavior: keep browser voice recognition
        // active when available, and use raw audio capture only as a quality boost.
        await startHighQualityAudioCapture()
        startRecognition()
        return
      }

      if (supportsAudioOnlyContinuous) {
        audioOnlyContinuousRef.current = true
        const captureError = await startHighQualityAudioCapture()

        if (captureError) {
          audioOnlyContinuousRef.current = false
          continuousModeRef.current = false
          callbacksRef.current = null
          activeCallbacksRef.current = null
          setIsContinuousMode(false)
          setIsListening(false)
          setError(captureError)
          return
        }

        setIsListening(true)
        return
      }

      audioOnlyContinuousRef.current = false
      clearAudioCapture()
      setError('Seu navegador nao suporta reconhecimento de voz continuo.')
      continuousModeRef.current = false
      callbacksRef.current = null
      activeCallbacksRef.current = null
      setIsContinuousMode(false)
      setIsListening(false)
    })()
  }, [
    clearAudioCapture,
    resetTranscriptState,
    startHighQualityAudioCapture,
    startRecognition,
    supportsAudioOnlyContinuous,
    supportsVoiceCommands,
  ])

  const stopContinuous = useCallback((options: StopContinuousOptions = {}) => {
    const callbacks = callbacksRef.current
    const usingAudioOnlyContinuous = audioOnlyContinuousRef.current
    const pendingText = sanitizeTranscript(
      mergeTranscriptSegments(finalTranscriptRef.current, interimTranscriptRef.current),
    )
    const audioBlob = isAudioCapturingRef.current ? takeCurrentAudioSnapshot() : null

    continuousModeRef.current = false
    audioOnlyContinuousRef.current = false
    setIsContinuousMode(false)
    callbacksRef.current = null
    activeCallbacksRef.current = null
    stopRecognition(recognitionRef.current)
    recognitionRef.current = null
    clearAudioCapture()
    setIsListening(false)
    interimTranscriptRef.current = ''
    setInterimTranscript('')

    if (options.savePending && callbacks && (pendingText || audioBlob)) {
      if (usingAudioOnlyContinuous && audioBlob) {
        setTranscript('Transcrevendo nota...')
        void saveResolvedNote('', { audioBlob, callbacks }).finally(() => {
          setTranscript('')
        })
      } else {
        void saveResolvedNote(pendingText, { audioBlob, callbacks })
      }
    }
  }, [clearAudioCapture, saveResolvedNote, takeCurrentAudioSnapshot])

  const reset = useCallback(() => {
    stop()
    resetTranscriptState()
    setError(null)
  }, [resetTranscriptState, stop])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    isListening,
    transcript,
    interimTranscript,
    error,
    isSupported,
    supportsVoiceCommands,
    usesAudioOnlyContinuousFallback: supportsAudioOnlyContinuous,
    isContinuousMode,
    start,
    stop,
    reset,
    clearError,
    setTranscript,
    startContinuous,
    stopContinuous,
  }
}
