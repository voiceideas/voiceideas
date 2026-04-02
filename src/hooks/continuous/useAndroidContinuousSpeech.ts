import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition'
import {
  mergeTranscriptSegments,
  sanitizeTranscript,
} from '../../lib/speech'
import type {
  ContinuousCallbacks,
  ContinuousLogEvent,
  ContinuousRuntimeState,
  NativeListenerHandle,
} from './types'

type SaveResult =
  | { ok: true; result?: unknown }
  | { ok: false; error?: unknown; skipped?: true }

type UseAndroidContinuousSpeechArgs = {
  callbacksRef: MutableRefObject<ContinuousCallbacks | null>
  continuousModeRef: MutableRefObject<boolean>
  nativeSpeechStopRequestedRef: MutableRefObject<boolean>
  nativeSegmentCommittedRef: MutableRefObject<boolean>
  nativeSessionStoppedRef: MutableRefObject<boolean>
  nativeRestartRequestedAfterSaveRef: MutableRefObject<boolean>
  nativeSpeechListenersRef: MutableRefObject<NativeListenerHandle[]>
  nativeRestartTimerRef: MutableRefObject<number | null>
  ensureNativeListeningRef: MutableRefObject<() => Promise<void>>
  finalTranscriptRef: MutableRefObject<string>
  interimTranscriptRef: MutableRefObject<string>
  lastSavedRef: MutableRefObject<{ text: string; at: number }>
  clearNativeSpeechListeners: () => Promise<void>
  clearNativeRestartTimer: () => void
  clearContinuousNoteBoundaryTimer: () => void
  clearCurrentNote: () => void
  setIsListening: Dispatch<SetStateAction<boolean>>
  setInterimTranscript: Dispatch<SetStateAction<string>>
  setTranscript: Dispatch<SetStateAction<string>>
  setContinuousRuntimeState: Dispatch<SetStateAction<ContinuousRuntimeState>>
  setError: Dispatch<SetStateAction<string | null>>
  logContinuousEvent: (event: ContinuousLogEvent, payload?: Record<string, unknown>) => void
  saveNativeContinuousNote: (
    text: string,
    options?: { stripKeywords?: string[] }
  ) => Promise<SaveResult>
  endsWithKeyword: (text: string, keywords: string[]) => boolean
  saveKeywords: string[]
  cancelKeywords: string[]
  segmentSilenceMs: number
  restartGraceMs: number
  onStartFailure: (message: string) => void
}

export function useAndroidContinuousSpeech({
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
  saveKeywords,
  cancelKeywords,
  segmentSilenceMs,
  restartGraceMs,
  onStartFailure,
}: UseAndroidContinuousSpeechArgs) {
  return useCallback(async () => {
    try {
      await clearNativeSpeechListeners()
      await SpeechRecognition.removeAllListeners().catch(() => undefined)
      nativeSessionStoppedRef.current = false
      nativeRestartRequestedAfterSaveRef.current = false

      const permissions = await SpeechRecognition.requestPermissions()
      if (permissions.speechRecognition !== 'granted') {
        throw new Error('Permita o uso do microfone para gravar ideias por voz.')
      }

      const { available } = await SpeechRecognition.available()
      if (!available) {
        throw new Error('O reconhecimento continuo nao esta disponivel neste aparelho.')
      }

      const startNativeSession = async () => {
        nativeSegmentCommittedRef.current = false
        nativeSessionStoppedRef.current = false
        nativeRestartRequestedAfterSaveRef.current = false
        await SpeechRecognition.start({
          language: 'pt-BR',
          maxResults: 1,
          partialResults: true,
          popup: false,
          allowForSilence: segmentSilenceMs,
        })
      }

      const restartNativeSessionIfReady = async (
        reason: 'save-succeeded' | 'empty-session',
      ) => {
        if (!continuousModeRef.current || nativeSpeechStopRequestedRef.current) return

        const shouldRestart =
          reason === 'empty-session'
            ? nativeSessionStoppedRef.current
            : nativeSessionStoppedRef.current && nativeRestartRequestedAfterSaveRef.current

        if (!shouldRestart) return

        clearNativeRestartTimer()
        setContinuousRuntimeState('restart-pending')
        logContinuousEvent('restart-started', { source: 'android-native', reason })

        if (typeof window === 'undefined') return

        nativeRestartTimerRef.current = window.setTimeout(() => {
          nativeRestartTimerRef.current = null

          void (async () => {
            try {
              await startNativeSession()
              if (!continuousModeRef.current || nativeSpeechStopRequestedRef.current) return
              setContinuousRuntimeState('listening')
              setIsListening(true)
              logContinuousEvent('restart-succeeded', { source: 'android-native', reason })
            } catch (nativeError: unknown) {
              if (!continuousModeRef.current) return

              const message = nativeError instanceof Error
                ? nativeError.message
                : 'Nao foi possivel retomar a escuta continua.'
              setError(message)
              setContinuousRuntimeState('error')
              logContinuousEvent('restart-failed', {
                source: 'android-native',
                reason,
                message,
              })
              setIsListening(false)
            }
          })()
        }, restartGraceMs)
      }

      const finalizeNativeSegment = async (
        rawSegmentText: string,
        source: 'segmentResults' | 'listeningState-fallback',
      ) => {
        if (!continuousModeRef.current || nativeSpeechStopRequestedRef.current) return

        const segmentText = sanitizeTranscript(rawSegmentText)
        if (!segmentText || nativeSegmentCommittedRef.current) return

        nativeSegmentCommittedRef.current = true
        interimTranscriptRef.current = ''
        setInterimTranscript('')
        setContinuousRuntimeState('segment-finalizing')
        logContinuousEvent('segment-ended', {
          source: 'android-native',
          eventSource: source,
          textLength: segmentText.length,
        })

        const result = await saveNativeContinuousNote(segmentText, {
          stripKeywords: endsWithKeyword(segmentText, saveKeywords) ? saveKeywords : undefined,
        })

        if (!continuousModeRef.current || nativeSpeechStopRequestedRef.current) return
        if (result.ok) {
          nativeRestartRequestedAfterSaveRef.current = true
          await restartNativeSessionIfReady('save-succeeded')
        }
      }

      ensureNativeListeningRef.current = async () => {
        if (!continuousModeRef.current || nativeSpeechStopRequestedRef.current) return

        const listeningState = await SpeechRecognition.isListening().catch(() => ({ listening: false }))
        if (listeningState.listening) return

        clearNativeRestartTimer()
        await startNativeSession()
        setIsListening(true)
        setContinuousRuntimeState('listening')
        logContinuousEvent('listening', { source: 'android-native' })
      }

      nativeSpeechListenersRef.current = [
        await SpeechRecognition.addListener('partialResults', (event) => {
          if (!continuousModeRef.current) return

          const partialText = sanitizeTranscript(event.matches?.[0] ?? '')
          interimTranscriptRef.current = partialText
          setInterimTranscript(partialText)
          if (partialText) {
            logContinuousEvent('partial-received', {
              source: 'android-native',
              textLength: partialText.length,
            })
          }
          setTranscript(
            sanitizeTranscript(
              mergeTranscriptSegments(finalTranscriptRef.current, partialText),
            ),
          )
        }),
        await SpeechRecognition.addListener('segmentResults', (event) => {
          if (!continuousModeRef.current) return

          const segmentText = sanitizeTranscript(event.matches?.[0] ?? '')
          if (!segmentText) return

          void finalizeNativeSegment(segmentText, 'segmentResults')
        }),
        await SpeechRecognition.addListener('listeningState', (event) => {
          if (!continuousModeRef.current) return
          setIsListening(event.status === 'started')

          if (event.status === 'started') {
            nativeSessionStoppedRef.current = false
            clearNativeRestartTimer()
            clearContinuousNoteBoundaryTimer()
            setContinuousRuntimeState('listening')
            logContinuousEvent('listening', { source: 'android-native' })
            return
          }

          nativeSessionStoppedRef.current = true
          const pendingSegment = sanitizeTranscript(
            mergeTranscriptSegments(finalTranscriptRef.current, interimTranscriptRef.current),
          )

          if (!nativeSegmentCommittedRef.current && pendingSegment) {
            if (endsWithKeyword(pendingSegment, cancelKeywords)) {
              callbacksRef.current?.onAutoCancel()
              lastSavedRef.current = { text: '', at: 0 }
              clearCurrentNote()
            } else {
              void finalizeNativeSegment(pendingSegment, 'listeningState-fallback')
            }
            return
          }

          if (nativeSpeechStopRequestedRef.current) return
          if (nativeRestartRequestedAfterSaveRef.current) {
            void restartNativeSessionIfReady('save-succeeded')
            return
          }

          if (!pendingSegment) {
            void restartNativeSessionIfReady('empty-session')
          }
        }),
        await SpeechRecognition.addListener('endOfSegmentedSession', () => {
          if (!continuousModeRef.current || nativeSpeechStopRequestedRef.current) return
          nativeSessionStoppedRef.current = true
          if (nativeRestartRequestedAfterSaveRef.current) {
            void restartNativeSessionIfReady('save-succeeded')
          }
        }),
      ]

      await startNativeSession()
      setIsListening(true)
      setContinuousRuntimeState('listening')
      logContinuousEvent('listening', { source: 'android-native' })
    } catch (nativeError) {
      const message = nativeError instanceof Error
        ? nativeError.message
        : 'Nao foi possivel iniciar a escuta continua.'
      onStartFailure(message)
    }
  }, [
    callbacksRef,
    cancelKeywords,
    clearContinuousNoteBoundaryTimer,
    clearCurrentNote,
    clearNativeRestartTimer,
    clearNativeSpeechListeners,
    continuousModeRef,
    endsWithKeyword,
    ensureNativeListeningRef,
    finalTranscriptRef,
    interimTranscriptRef,
    lastSavedRef,
    logContinuousEvent,
    nativeRestartRequestedAfterSaveRef,
    nativeRestartTimerRef,
    nativeSegmentCommittedRef,
    nativeSessionStoppedRef,
    nativeSpeechListenersRef,
    nativeSpeechStopRequestedRef,
    onStartFailure,
    restartGraceMs,
    saveKeywords,
    saveNativeContinuousNote,
    segmentSilenceMs,
    setContinuousRuntimeState,
    setError,
    setInterimTranscript,
    setIsListening,
    setTranscript,
  ])
}
