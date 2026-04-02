import { useState, useRef, useCallback, useEffect } from 'react'
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition'
import { transcribeAudio } from '../lib/transcribe'
import { isAndroidNativeShellApp, isTauriApp } from '../lib/platform'
import {
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  mergeTranscriptSegments,
  normalizeTranscript,
  sanitizeTranscript,
  stripTranscriptPrefix,
  type BrowserSpeechRecognitionInstance,
} from '../lib/speech'
import {
  resolveContinuousStrategy,
} from './continuous/resolveContinuousStrategy'
import { useAndroidContinuousSpeech } from './continuous/useAndroidContinuousSpeech'
import { useAudioFallbackContinuous } from './continuous/useAudioFallbackContinuous'
import { useWebContinuousSpeech } from './continuous/useWebContinuousSpeech'
import type {
  ContinuousCallbacks,
  ContinuousLogEvent,
  ContinuousPlatform,
  ContinuousRuntimeState,
  ContinuousStrategy,
  NativeListenerHandle,
  SegmentSnapshot,
} from './continuous/types'

const SAVE_KEYWORDS = ['salvar nota', 'salvar', 'gravar nota', 'pronto']
const CANCEL_KEYWORDS = ['cancelar nota', 'cancelar', 'apagar']
const DUPLICATE_SAVE_WINDOW_MS = 3000
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096
const TARGET_SAMPLE_RATE = 16000
const CONTINUOUS_SILENCE_THRESHOLD = 0.015
const CONTINUOUS_NOTE_BREAK_MS = 5500
const CONTINUOUS_AUDIO_ONLY_SILENCE_HOLD_MS = 5500
const CONTINUOUS_MIN_SEGMENT_MS = 900
const CONTINUOUS_PREROLL_MS = 250
const NATIVE_SEGMENT_SILENCE_MS = 4500
const NATIVE_SEGMENT_RESTART_GRACE_MS = 600

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

interface SaveNoteOptions {
  audioBlob?: Blob | null
  callbacks?: ContinuousCallbacks | null
  stripKeywords?: string[]
}

interface StopContinuousOptions {
  savePending?: boolean
}

function createContinuousId(prefix: 'session' | 'segment') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
  const [continuousRuntimeState, setContinuousRuntimeState] = useState<ContinuousRuntimeState>('idle')
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
  const nativeSpeechListenersRef = useRef<NativeListenerHandle[]>([])
  const nativeSpeechStopRequestedRef = useRef(false)
  const nativeRestartTimerRef = useRef<number | null>(null)
  const continuousNoteBoundaryTimerRef = useRef<number | null>(null)
  const ensureNativeListeningRef = useRef<() => Promise<void>>(async () => undefined)
  const nativeSegmentCommittedRef = useRef(false)
  const nativeSessionStoppedRef = useRef(false)
  const nativeRestartRequestedAfterSaveRef = useRef(false)
  const currentSessionIdRef = useRef(createContinuousId('session'))
  const currentSegmentIdRef = useRef(createContinuousId('segment'))
  const currentStrategyRef = useRef<ContinuousStrategy | null>(null)
  const currentPlatformRef = useRef<ContinuousPlatform>('web')
  const lastSegmentSnapshotRef = useRef<SegmentSnapshot | null>(null)

  const usesNativeAndroidContinuousSpeech = isAndroidNativeShellApp()
  const isTauriShell = isTauriApp()
  const canUseAndroidNativeRecognition = usesNativeAndroidContinuousSpeech
  const canUseWebSpeechRecognition = !canUseAndroidNativeRecognition && isSpeechRecognitionSupported()
  const shouldUseAudioFallback = (
    !usesNativeAndroidContinuousSpeech && (
      shouldUseAudioOnlyContinuousFallback() ||
      !canUseWebSpeechRecognition
    ) &&
    (
      isHighQualityAudioCaptureSupported()
    )
  )
  const supportsVoiceCommands = canUseWebSpeechRecognition || canUseAndroidNativeRecognition
  const supportsAudioOnlyContinuous = shouldUseAudioFallback
  const isSupported = supportsVoiceCommands || supportsAudioOnlyContinuous
  const currentPlatform: ContinuousPlatform = usesNativeAndroidContinuousSpeech
    ? 'android'
    : isTauriShell
      ? 'macos'
      : 'web'
  currentPlatformRef.current = currentPlatform

  const logContinuousEvent = useCallback((
    event: ContinuousLogEvent,
    payload: Record<string, unknown> = {},
  ) => {
    console.debug('[voiceideas:continuous]', {
      event,
      sessionId: currentSessionIdRef.current,
      segmentId: currentSegmentIdRef.current,
      strategy: currentStrategyRef.current,
      platform: currentPlatformRef.current,
      ts: Date.now(),
      ...payload,
    })
  }, [])

  const getCurrentStrategy = useCallback((): ContinuousStrategy => {
    if (currentStrategyRef.current) return currentStrategyRef.current
    return resolveContinuousStrategy({
      platform: currentPlatform,
      canUseWebSpeechRecognition,
      canUseAndroidNativeRecognition,
      shouldUseAudioFallback,
    })
  }, [
    canUseAndroidNativeRecognition,
    canUseWebSpeechRecognition,
    currentPlatform,
    shouldUseAudioFallback,
  ])

  const startContinuousSession = useCallback((strategy: ContinuousStrategy) => {
    currentSessionIdRef.current = createContinuousId('session')
    currentSegmentIdRef.current = createContinuousId('segment')
    currentStrategyRef.current = strategy
    currentPlatformRef.current = currentPlatform
    lastSegmentSnapshotRef.current = null
    setContinuousRuntimeState('starting')
    logContinuousEvent('session-started', { strategy, platform: currentPlatform })
  }, [currentPlatform, logContinuousEvent])

  const prepareNextSegment = useCallback(() => {
    currentSegmentIdRef.current = createContinuousId('segment')
    lastSegmentSnapshotRef.current = null
  }, [])

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

  const createSegmentSnapshot = useCallback((
    text: string,
    source: ContinuousStrategy,
  ): SegmentSnapshot | null => {
    const nextText = sanitizeTranscript(text)
    if (!nextText) return null

    return {
      text: nextText,
      createdAt: Date.now(),
      source,
      sessionId: currentSessionIdRef.current,
      segmentId: currentSegmentIdRef.current,
    }
  }, [])

  const clearSegmentStateAfterSuccessfulSave = useCallback(() => {
    clearCurrentNote()
    resetCurrentAudioSegment()
    prepareNextSegment()
  }, [clearCurrentNote, prepareNextSegment, resetCurrentAudioSegment])

  const keepSegmentStateOnSaveFailure = useCallback((snapshot: SegmentSnapshot) => {
    lastSegmentSnapshotRef.current = snapshot
    finalTranscriptRef.current = snapshot.text
    interimTranscriptRef.current = ''
    setTranscript(snapshot.text)
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

  const clearNativeSpeechListeners = useCallback(async () => {
    const listeners = nativeSpeechListenersRef.current
    nativeSpeechListenersRef.current = []

    for (const listener of listeners) {
      try {
        await listener.remove()
      } catch {
        // Ignore listener cleanup failures.
      }
    }
  }, [])

  const clearNativeRestartTimer = useCallback(() => {
    if (nativeRestartTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(nativeRestartTimerRef.current)
    }
    nativeRestartTimerRef.current = null
  }, [])

  const clearContinuousNoteBoundaryTimer = useCallback(() => {
    if (continuousNoteBoundaryTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(continuousNoteBoundaryTimerRef.current)
    }
    continuousNoteBoundaryTimerRef.current = null
  }, [])

  const resetTranscriptState = useCallback(() => {
    lastSavedRef.current = { text: '', at: 0 }
    lastSegmentSnapshotRef.current = null
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

        if (audioOnlySilenceDurationMsRef.current >= CONTINUOUS_AUDIO_ONLY_SILENCE_HOLD_MS) {
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

  const saveContinuousSegmentTransaction = useCallback(async (
    snapshot: SegmentSnapshot,
    callbacks: ContinuousCallbacks | null = callbacksRef.current,
  ) => {
    if (!callbacks) {
      return {
        ok: false as const,
        error: new Error('Callbacks de escuta continua indisponiveis.'),
      }
    }

    lastSegmentSnapshotRef.current = snapshot
    logContinuousEvent('save-started', {
      source: snapshot.source,
      textLength: snapshot.text.length,
    })
    setContinuousRuntimeState('saving')

    try {
      const result = await Promise.resolve(callbacks.onAutoSave(snapshot.text))
      rememberSavedText(snapshot.text)
      clearSegmentStateAfterSuccessfulSave()
      setError(null)
      const nextState: ContinuousRuntimeState = continuousModeRef.current
        ? getCurrentStrategy() === 'android-native'
          ? 'restart-pending'
          : 'listening'
        : 'idle'
      setContinuousRuntimeState(nextState)
      logContinuousEvent('save-succeeded', {
        source: snapshot.source,
        textLength: snapshot.text.length,
      })
      return { ok: true as const, result }
    } catch (error) {
      lastSavedRef.current = { text: '', at: 0 }
      keepSegmentStateOnSaveFailure(snapshot)
      const message = error instanceof Error
        ? error.message
        : 'Nao foi possivel salvar a nota continua.'
      setError(message)
      setContinuousRuntimeState('error')
      logContinuousEvent('save-failed', {
        source: snapshot.source,
        message,
      })
      return { ok: false as const, error }
    }
  }, [
    clearSegmentStateAfterSuccessfulSave,
    getCurrentStrategy,
    keepSegmentStateOnSaveFailure,
    logContinuousEvent,
    rememberSavedText,
  ])

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

    const snapshot = createSegmentSnapshot(
      nextText,
      audioBlob && audioOnlyContinuousRef.current ? 'audio-fallback' : getCurrentStrategy(),
    )

    if (!snapshot) return

    await saveContinuousSegmentTransaction(snapshot, callbacks)

    if (continuousModeRef.current && !usesNativeAndroidContinuousSpeech) {
      void ensureNativeListeningRef.current().catch(() => undefined)
    }
  }, [
    createSegmentSnapshot,
    getCurrentStrategy,
    saveContinuousSegmentTransaction,
    usesNativeAndroidContinuousSpeech,
    wasRecentlySaved,
  ])

  const queueContinuousSave = useCallback((
    text: string,
    options: Omit<SaveNoteOptions, 'callbacks'> = {},
  ) => {
    const audioBlob = isAudioCapturingRef.current ? takeCurrentAudioSnapshot() : null
    void saveResolvedNote(text, { ...options, audioBlob })
  }, [saveResolvedNote, takeCurrentAudioSnapshot])

  const saveNativeContinuousNote = useCallback(async (
    text: string,
    options: {
      stripKeywords?: string[]
    } = {},
  ) => {
    const callbacks = callbacksRef.current
    if (!callbacks) {
      return {
        ok: false as const,
        error: new Error('Callbacks de escuta continua indisponiveis.'),
      }
    }

    const nextText = sanitizeTranscript(
      options.stripKeywords
        ? removeKeyword(text, options.stripKeywords)
        : text,
    )

    if (!nextText || wasRecentlySaved(nextText)) {
      clearCurrentNote()
      return { ok: false as const, skipped: true as const }
    }

    const snapshot = createSegmentSnapshot(nextText, 'android-native')
    if (!snapshot) {
      return { ok: false as const, skipped: true as const }
    }

    return saveContinuousSegmentTransaction(snapshot, callbacks)
  }, [
    clearCurrentNote,
    createSegmentSnapshot,
    saveContinuousSegmentTransaction,
    wasRecentlySaved,
  ])

  const scheduleContinuousNoteBoundarySave = useCallback(() => {
    clearContinuousNoteBoundaryTimer()
    if (typeof window === 'undefined') return

    continuousNoteBoundaryTimerRef.current = window.setTimeout(() => {
      continuousNoteBoundaryTimerRef.current = null

      if (!continuousModeRef.current || !callbacksRef.current) return

      const pendingText = sanitizeTranscript(
        mergeTranscriptSegments(finalTranscriptRef.current, interimTranscriptRef.current),
      )

      if (!pendingText) {
        clearCurrentNote()
        return
      }

      if (endsWithKeyword(pendingText, CANCEL_KEYWORDS)) {
        callbacksRef.current.onAutoCancel()
        lastSavedRef.current = { text: '', at: 0 }
        clearCurrentNote()
        return
      }

      setContinuousRuntimeState('segment-finalizing')
      logContinuousEvent('segment-ended', {
        source: getCurrentStrategy(),
        textLength: pendingText.length,
      })
      queueContinuousSave(pendingText, {
        stripKeywords: endsWithKeyword(pendingText, SAVE_KEYWORDS) ? SAVE_KEYWORDS : undefined,
      })
    }, CONTINUOUS_NOTE_BREAK_MS)
  }, [
    clearContinuousNoteBoundaryTimer,
    clearCurrentNote,
    getCurrentStrategy,
    logContinuousEvent,
    queueContinuousSave,
  ])

  const appendContinuousTranscript = useCallback((
    text: string,
    options: {
      markAsFinalChunk?: boolean
    } = {},
  ) => {
    const nextChunk = sanitizeTranscript(text)
    if (!nextChunk) return

    if (!finalTranscriptRef.current && wasRecentlySaved(nextChunk)) {
      return
    }

    if (options.markAsFinalChunk && nextChunk === lastFinalChunkRef.current) {
      return
    }

    const currentText = sanitizeTranscript(
      mergeTranscriptSegments(finalTranscriptRef.current, nextChunk),
    )

    finalTranscriptRef.current = currentText
    interimTranscriptRef.current = ''
    if (options.markAsFinalChunk) {
      lastFinalChunkRef.current = nextChunk
    }
    setInterimTranscript('')

    if (callbacksRef.current) {
      if (endsWithKeyword(currentText, SAVE_KEYWORDS)) {
        clearContinuousNoteBoundaryTimer()
        queueContinuousSave(currentText, { stripKeywords: SAVE_KEYWORDS })
        return
      }

      if (endsWithKeyword(currentText, CANCEL_KEYWORDS)) {
        clearContinuousNoteBoundaryTimer()
        callbacksRef.current.onAutoCancel()
        lastSavedRef.current = { text: '', at: 0 }
        resetCurrentAudioSegment()
        clearCurrentNote()
        return
      }

      setTranscript(currentText)
      scheduleContinuousNoteBoundarySave()
      return
    }

    setTranscript(currentText)
  }, [
    clearContinuousNoteBoundaryTimer,
    clearCurrentNote,
    queueContinuousSave,
    resetCurrentAudioSegment,
    scheduleContinuousNoteBoundarySave,
    wasRecentlySaved,
  ])

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

    setContinuousRuntimeState('segment-finalizing')
    logContinuousEvent('segment-ended', {
      source: 'audio-fallback',
      forced: force,
      textLength: 0,
    })
    setTranscript('Transcrevendo nota...')
    void saveResolvedNote('', { audioBlob, callbacks }).finally(() => {
      setTranscript('')
    })
  }, [logContinuousEvent, resetCurrentAudioSegment, saveResolvedNote, takeCurrentAudioSnapshot])

  useEffect(() => {
    finalizeAudioOnlySegmentRef.current = finalizeAudioOnlySegment
  }, [finalizeAudioOnlySegment])

  const startRecognition = useCallback(() => {
    stopRecognition(recognitionRef.current)
    recognitionRef.current = null

    const recognition = createSpeechRecognition(
      (result) => {
        if (result.isFinal) {
          appendContinuousTranscript(result.transcript, { markAsFinalChunk: true })
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
        if (continuousModeRef.current && nextInterim) {
          logContinuousEvent('partial-received', {
            source: 'web-speech',
            textLength: nextInterim.length,
          })
          scheduleContinuousNoteBoundarySave()
        }
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
        setContinuousRuntimeState('restart-pending')
        logContinuousEvent('restart-started', { source: 'web-speech' })

        setTimeout(() => {
          if (continuousModeRef.current) {
            startRecognitionRef.current()
          }
          restartingRef.current = false
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
      if (continuousModeRef.current) {
        setContinuousRuntimeState('listening')
        logContinuousEvent('listening', { source: 'web-speech' })
        if (restartingRef.current) {
          logContinuousEvent('restart-succeeded', { source: 'web-speech' })
        }
      }
    } catch {
      setError('Nao foi possivel iniciar a gravacao. Tente novamente.')
      if (continuousModeRef.current) {
        setContinuousRuntimeState('error')
        logContinuousEvent('restart-failed', { source: 'web-speech' })
      }
      setIsListening(false)
    }
  }, [appendContinuousTranscript, logContinuousEvent, scheduleContinuousNoteBoundarySave, wasRecentlySaved])

  useEffect(() => {
    startRecognitionRef.current = startRecognition
  }, [startRecognition])

  useEffect(() => {
    return () => {
      ensureNativeListeningRef.current = async () => undefined
      stopRecognition(recognitionRef.current)
      clearAudioCapture()
      clearNativeRestartTimer()
      clearContinuousNoteBoundaryTimer()
      void clearNativeSpeechListeners()
    }
  }, [clearAudioCapture, clearContinuousNoteBoundaryTimer, clearNativeRestartTimer, clearNativeSpeechListeners])

  const start = useCallback(() => {
    setError(null)
    resetTranscriptState()
    ensureNativeListeningRef.current = async () => undefined
    callbacksRef.current = null
    activeCallbacksRef.current = null
    continuousModeRef.current = false
    audioOnlyContinuousRef.current = false
    currentStrategyRef.current = null
    setContinuousRuntimeState('idle')
    setIsContinuousMode(false)
    clearAudioCapture()
    clearContinuousNoteBoundaryTimer()
    startRecognition()
  }, [clearAudioCapture, clearContinuousNoteBoundaryTimer, resetTranscriptState, startRecognition])

  const stop = useCallback(() => {
    continuousModeRef.current = false
    audioOnlyContinuousRef.current = false
    ensureNativeListeningRef.current = async () => undefined
    activeCallbacksRef.current = null
    currentStrategyRef.current = null
    setContinuousRuntimeState('idle')
    setIsContinuousMode(false)
    stopRecognition(recognitionRef.current)
    recognitionRef.current = null
    clearAudioCapture()
    clearContinuousNoteBoundaryTimer()
    setIsListening(false)
    interimTranscriptRef.current = ''
    setInterimTranscript('')
    logContinuousEvent('session-stopped')
  }, [clearAudioCapture, clearContinuousNoteBoundaryTimer, logContinuousEvent])

  const handleContinuousStartFailure = useCallback((message: string) => {
    ensureNativeListeningRef.current = async () => undefined
    audioOnlyContinuousRef.current = false
    continuousModeRef.current = false
    callbacksRef.current = null
    activeCallbacksRef.current = null
    currentStrategyRef.current = null
    nativeSessionStoppedRef.current = false
    nativeRestartRequestedAfterSaveRef.current = false
    setIsContinuousMode(false)
    setIsListening(false)
    setContinuousRuntimeState('error')
    setError(message)
  }, [])

  const markAudioFallbackListening = useCallback(() => {
    setIsListening(true)
    setContinuousRuntimeState('listening')
    logContinuousEvent('listening', { source: 'audio-fallback' })
  }, [logContinuousEvent])

  const startWebContinuousSpeech = useWebContinuousSpeech({
    clearAudioCapture,
    startRecognition,
  })

  const startAudioFallbackContinuous = useAudioFallbackContinuous({
    audioOnlyContinuousRef,
    startHighQualityAudioCapture,
    onListeningStarted: markAudioFallbackListening,
    onStartFailure: handleContinuousStartFailure,
  })

  const startAndroidContinuousSpeech = useAndroidContinuousSpeech({
    callbacksRef,
    continuousModeRef,
    nativeSpeechStopRequestedRef,
    nativeSegmentCommittedRef,
    nativeSessionStoppedRef,
    nativeRestartRequestedAfterSaveRef,
    nativeSpeechListenersRef,
    nativeRestartTimerRef,
    ensureNativeListeningRef,
    finalTranscriptRef,
    interimTranscriptRef,
    lastSavedRef,
    clearNativeSpeechListeners,
    clearNativeRestartTimer,
    clearContinuousNoteBoundaryTimer,
    clearCurrentNote,
    setIsListening,
    setInterimTranscript,
    setTranscript,
    setContinuousRuntimeState,
    setError,
    logContinuousEvent,
    saveNativeContinuousNote,
    endsWithKeyword,
    saveKeywords: SAVE_KEYWORDS,
    cancelKeywords: CANCEL_KEYWORDS,
    segmentSilenceMs: NATIVE_SEGMENT_SILENCE_MS,
    restartGraceMs: NATIVE_SEGMENT_RESTART_GRACE_MS,
    onStartFailure: handleContinuousStartFailure,
  })

  const startContinuous = useCallback((callbacks: ContinuousCallbacks) => {
    setError(null)
    resetTranscriptState()
    ensureNativeListeningRef.current = async () => undefined
    callbacksRef.current = callbacks
    activeCallbacksRef.current = callbacks
    continuousModeRef.current = true
    setIsContinuousMode(true)
    nativeSpeechStopRequestedRef.current = false
    clearNativeRestartTimer()
    clearContinuousNoteBoundaryTimer()

    const strategy = resolveContinuousStrategy({
      platform: currentPlatform,
      canUseWebSpeechRecognition,
      canUseAndroidNativeRecognition,
      shouldUseAudioFallback,
    })
    startContinuousSession(strategy)

    void (async () => {
      if (strategy === 'android-native') {
        audioOnlyContinuousRef.current = false
        await startAndroidContinuousSpeech()
        return
      }

      if (strategy === 'web-speech') {
        audioOnlyContinuousRef.current = false
        await startWebContinuousSpeech()
        return
      }

      if (strategy === 'audio-fallback') {
        await startAudioFallbackContinuous()
        return
      }

      audioOnlyContinuousRef.current = false
      clearAudioCapture()
      setError('Seu navegador nao suporta reconhecimento de voz continuo.')
      continuousModeRef.current = false
      callbacksRef.current = null
      activeCallbacksRef.current = null
      currentStrategyRef.current = null
      setIsContinuousMode(false)
      setIsListening(false)
      setContinuousRuntimeState('error')
    })()
  }, [
    clearNativeRestartTimer,
    clearContinuousNoteBoundaryTimer,
    clearAudioCapture,
    canUseAndroidNativeRecognition,
    canUseWebSpeechRecognition,
    currentPlatform,
    resetTranscriptState,
    startAndroidContinuousSpeech,
    startAudioFallbackContinuous,
    startContinuousSession,
    startWebContinuousSpeech,
    shouldUseAudioFallback,
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
    nativeSpeechStopRequestedRef.current = true
    ensureNativeListeningRef.current = async () => undefined
    clearNativeRestartTimer()
    clearContinuousNoteBoundaryTimer()
    setIsContinuousMode(false)
    callbacksRef.current = null
    activeCallbacksRef.current = null
    currentStrategyRef.current = null
    stopRecognition(recognitionRef.current)
    recognitionRef.current = null
    void (async () => {
      if (usesNativeAndroidContinuousSpeech) {
        await SpeechRecognition.stop().catch(() => undefined)
        await SpeechRecognition.removeAllListeners().catch(() => undefined)
        await clearNativeSpeechListeners()
      }
    })()
    clearAudioCapture()
    setIsListening(false)
    setContinuousRuntimeState('idle')
    interimTranscriptRef.current = ''
    setInterimTranscript('')
    logContinuousEvent('session-stopped', {
      savePending: Boolean(options.savePending && callbacks && (pendingText || audioBlob)),
    })

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
  }, [
    clearAudioCapture,
    clearContinuousNoteBoundaryTimer,
    clearNativeRestartTimer,
    clearNativeSpeechListeners,
    logContinuousEvent,
    saveResolvedNote,
    takeCurrentAudioSnapshot,
    usesNativeAndroidContinuousSpeech,
  ])

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
    continuousRuntimeState,
    continuousStrategy: currentStrategyRef.current,
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
