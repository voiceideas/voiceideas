/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B9D (2026-05-16)
 *
 * **Factory PURA** do CaptureEngine. Não importa Supabase client nem
 * adapters reais B9B. Recebe TODOS os adapters via parâmetro
 * obrigatório (incluindo `resolveUserId`). Permite ser executado em
 * ambientes neutros (Node strip-types, tests, smokes) sem ativar
 * a chain do supabase.
 *
 * **Atalhos com defaults reais** (Manual/Safe shortcuts que injetam
 * supabase + adapters B9B) ficam em
 * `createCaptureEngineWithDefaults.ts`.
 *
 * **Status (B9D):**
 *   - Engine continua funcional end-to-end (B9C).
 *   - Safe Capture (`transcriptionTrigger='chunk_or_session'`) agora
 *     **lança erro controlado** (`not-supported` com motivo
 *     `safe-async-reserved`) ao invés de retornar sucesso silencioso
 *     com `transcript=''`. Per ordem B9D #3 — não deve "parecer
 *     sucesso completo" por acidente.
 *   - Zero consumo em produção (hooks legados continuam).
 *
 * **Limites B9D:**
 *   - `attachTranscript` continua no-op (limitação B9B schema).
 *   - `retryPendingUpload` continua `not-supported`.
 *   - CapacitorPluginSource não modelado.
 *   - Sem listener pattern.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §4 EXECUTE.
 */

import type {
  CaptureEngine,
  CaptureEngineState,
  CaptureProfile,
  CaptureResult,
} from './captureEngine'
import type { CaptureProfileBundle } from './captureProfiles'
import type {
  MediaRecorderSource,
  MediaSourceLifecycle,
  PermissionAdapter,
  WebAudioSource,
} from './adapters'
import {
  createMediaRecorderSourceStub,
  createPermissionAdapterStub,
  createWebAudioSourceStub,
} from './adapters'
import {
  applyCaptureEvent,
  INITIAL_CAPTURE_PHASE,
  type CaptureEvent,
} from './capturePhaseMachine'
import {
  detectCaptureCapabilities,
  hasAnyCaptureSource,
  type CaptureCapabilities,
} from './captureCapabilities'
import { isUnifiedCaptureEngineEnabled } from '../../lib/captureEngineFeatureFlag'
import { log } from '../../lib/log'
import type {
  CapturePersistence,
  CaptureSessionRecord,
} from './capturePersistence'
import {
  createCapturePersistenceStub,
  toSessionProfileSnapshot,
} from './capturePersistence'
import type { CaptureStorage } from './captureStorage'
import { createCaptureStorageStub } from './captureStorage'
import type { CaptureTranscription } from './captureTranscription'
import { createCaptureTranscriptionStub } from './captureTranscription'

// ─── Adapter slot ────────────────────────────────────────────────────

/**
 * Resolve userId do contexto atual. Default real (with-defaults) usa
 * `supabase.auth.getUser()`. Smoke/tests passam função fake. Engine
 * NÃO importa supabase diretamente.
 */
export type CaptureEngineUserIdResolver = () => Promise<string>

export interface CaptureEngineAdapters {
  permission: PermissionAdapter
  webAudioSource: WebAudioSource
  mediaRecorderSource: MediaRecorderSource
  persistence: CapturePersistence
  storage: CaptureStorage
  transcription: CaptureTranscription
  /**
   * Resolve o `userId` autenticado no momento do upload. Engine puro
   * NÃO sabe nada sobre Supabase — caller injeta a estratégia.
   */
  resolveUserId: CaptureEngineUserIdResolver
}

export type CaptureEngineSelectedMode = 'unified' | 'legacy'

// ─── Errors tipados ──────────────────────────────────────────────────

export type CaptureEngineErrorCode =
  | 'unsupported'
  | 'no-capture-source'
  | 'permission-denied'
  | 'not-recording'
  | 'invalid-transition'
  | 'source-error'
  | 'persistence-error'
  | 'storage-error'
  | 'transcription-error'
  | 'auth-error'
  | 'not-supported'
  | 'safe-async-reserved'

export class CaptureEngineError extends Error {
  readonly code: CaptureEngineErrorCode
  constructor(code: CaptureEngineErrorCode, message: string) {
    super(`CaptureEngine[${code}]: ${message}`)
    this.name = 'CaptureEngineError'
    this.code = code
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function pickSource(
  profile: CaptureProfile,
  capabilities: CaptureCapabilities,
  adapters: CaptureEngineAdapters,
): MediaSourceLifecycle {
  if (profile.audioPreprocessor === 'downsample_16k_wav') {
    if (
      !capabilities.audioContext.available ||
      !capabilities.scriptProcessorNode.available
    ) {
      throw new CaptureEngineError(
        'no-capture-source',
        'WebAudioSource requested but AudioContext/ScriptProcessor unavailable.',
      )
    }
    return adapters.webAudioSource
  }
  if (capabilities.mediaRecorder.available) {
    return adapters.mediaRecorderSource
  }
  if (
    capabilities.audioContext.available &&
    capabilities.scriptProcessorNode.available
  ) {
    return adapters.webAudioSource
  }
  throw new CaptureEngineError(
    'no-capture-source',
    `Platform ${capabilities.platform} has no available capture source.`,
  )
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'unknown error'
}

// ─── Factory principal ───────────────────────────────────────────────

/**
 * Cria um `CaptureEngine` funcional. Adapters TODOS obrigatórios —
 * caller (with-defaults ou test) injeta estratégias concretas.
 */
export function createCaptureEngine(
  profileBundle: CaptureProfileBundle,
  adapters: CaptureEngineAdapters,
): CaptureEngine {
  const capabilities = detectCaptureCapabilities()

  let internalState: CaptureEngineState = {
    phase: INITIAL_CAPTURE_PHASE,
    permission: adapters.permission.snapshot.permission,
    availability: adapters.permission.snapshot.availability,
    interruptionReason: adapters.permission.snapshot.reason,
    capabilities: null,
    error: null,
    pendingUploads: [],
    currentResult: null,
  }

  let activeSource: MediaSourceLifecycle | null = null
  let activeProfile: CaptureProfile | null = null
  let activeSession: CaptureSessionRecord | null = null

  const setPhaseViaEvent = (event: CaptureEvent): void => {
    const result = applyCaptureEvent(internalState.phase, event)
    if (result.ok) {
      internalState = { ...internalState, phase: result.next }
    }
  }

  const setError = (message: string): void => {
    internalState = { ...internalState, error: message }
    setPhaseViaEvent({ type: 'ERROR_OCCURRED', message })
  }

  const syncPermissionSnapshot = (): void => {
    const snap = adapters.permission.snapshot
    internalState = {
      ...internalState,
      permission: snap.permission,
      availability: snap.availability,
      interruptionReason: snap.reason,
    }
  }

  const tryMarkSessionFailed = async (reason: string): Promise<void> => {
    if (!activeSession) return
    try {
      await adapters.persistence.markFailed(activeSession.id, reason)
    } catch {
      // swallow nested error
    }
  }

  const tryMarkSessionCancelled = async (): Promise<void> => {
    if (!activeSession) return
    try {
      await adapters.persistence.markCancelled(activeSession.id)
    } catch {
      // swallow
    }
  }

  return {
    get state(): CaptureEngineState {
      return internalState
    },

    async start(profile: CaptureProfile): Promise<void> {
      internalState = { ...internalState, capabilities }
      if (!hasAnyCaptureSource(capabilities)) {
        const message = `No capture source available on platform ${capabilities.platform}`
        setError(message)
        throw new CaptureEngineError('unsupported', message)
      }

      setPhaseViaEvent({ type: 'START_REQUESTED' })

      // ─── Permission flow ─────────────────────────────────────────
      let permSnap = await adapters.permission.refresh()
      syncPermissionSnapshot()
      if (permSnap.permission !== 'granted') {
        setPhaseViaEvent({ type: 'PERMISSION_PROMPTED' })
        permSnap = await adapters.permission.request()
        syncPermissionSnapshot()
        if (permSnap.permission !== 'granted') {
          const reason = permSnap.reason ?? 'denied'
          setPhaseViaEvent({ type: 'PERMISSION_DENIED', reason })
          internalState = { ...internalState, error: reason }
          throw new CaptureEngineError(
            'permission-denied',
            `Microphone permission ${permSnap.permission}: ${reason}`,
          )
        }
        setPhaseViaEvent({ type: 'PERMISSION_GRANTED' })
      }

      // ─── Capture session (D1) ────────────────────────────────────
      if (profile.createSession) {
        try {
          activeSession = await adapters.persistence.createSession({
            mode: profile.mode,
            startedAt: new Date().toISOString(),
            profileSnapshot: toSessionProfileSnapshot(profile),
          })
        } catch (err) {
          const message = describeError(err)
          setError(message)
          throw new CaptureEngineError('persistence-error', message)
        }
      }

      // ─── Source selection + start ────────────────────────────────
      let source: MediaSourceLifecycle
      try {
        source = pickSource(profile, capabilities, adapters)
      } catch (err) {
        const message = describeError(err)
        setError(message)
        await tryMarkSessionFailed(message)
        activeSession = null
        throw err instanceof CaptureEngineError
          ? err
          : new CaptureEngineError('no-capture-source', message)
      }

      try {
        await source.start(profile)
      } catch (err) {
        const message = describeError(err)
        setError(message)
        await tryMarkSessionFailed(message)
        activeSession = null
        throw new CaptureEngineError('source-error', message)
      }

      activeSource = source
      activeProfile = profile
      setPhaseViaEvent({ type: 'RECORDING_STARTED' })
      log.info('capture-engine', 'start ok', {
        mode: profile.mode,
        sessionId: activeSession?.id ?? null,
        retainAudio: profile.retainAudio,
        audioFailurePolicy: profile.audioFailurePolicy ?? 'throw',
      })
    },

    async stop(): Promise<CaptureResult> {
      const source = activeSource
      const profile = activeProfile
      const sessionRef = activeSession
      if (!source || !profile) {
        const message = 'stop() called without active recording'
        setError(message)
        throw new CaptureEngineError('not-recording', message)
      }

      setPhaseViaEvent({ type: 'STOP_REQUESTED' })

      // ─── Stop source ─────────────────────────────────────────────
      let sourceResult: Awaited<ReturnType<MediaSourceLifecycle['stop']>>
      try {
        sourceResult = await source.stop()
      } catch (err) {
        const message = describeError(err)
        activeSource = null
        activeProfile = null
        setError(message)
        await tryMarkSessionFailed(message)
        activeSession = null
        log.error('capture-engine', 'source.stop failed', {
          mode: profile.mode,
          sessionId: sessionRef?.id ?? null,
          error: message,
        })
        throw new CaptureEngineError('source-error', message)
      }

      activeSource = null

      // ─── Safe Capture async — RESERVADO (B9D) ────────────────────
      // Per ordem B9D #3: não retornar "sucesso completo" silencioso
      // para profiles que pedem pipeline async não implementado.
      if (profile.transcriptionTrigger === 'chunk_or_session') {
        const message =
          'Safe Capture async transcription pipeline reservado (B9D+). Use o caminho legacy (useSafeCaptureMode) até B9E+.'
        setError(message)
        await tryMarkSessionFailed(message)
        activeProfile = null
        activeSession = null
        log.warn('capture-engine', 'safe-async path reserved', {
          mode: profile.mode,
          sessionId: sessionRef?.id ?? null,
        })
        throw new CaptureEngineError('safe-async-reserved', message)
      }

      // ─── Transcribe (D4 sync only) ───────────────────────────────
      let transcript = ''
      if (profile.transcriptionTrigger === 'after_stop') {
        setPhaseViaEvent({ type: 'BLOB_READY', nextStep: 'transcribe' })
        try {
          const r = await adapters.transcription.transcribe({
            blob: sourceResult.blob,
            format: sourceResult.format,
            trigger: profile.transcriptionTrigger,
          })
          transcript = r.text
        } catch (err) {
          const message = describeError(err)
          setError(message)
          await tryMarkSessionFailed(message)
          activeProfile = null
          activeSession = null
          log.error('capture-engine', 'transcribe failed', {
            mode: profile.mode,
            sessionId: sessionRef?.id ?? null,
            error: message,
          })
          throw new CaptureEngineError('transcription-error', message)
        }
        const nextStep = profile.retainAudio ? 'upload' : 'complete'
        setPhaseViaEvent({ type: 'TRANSCRIPTION_COMPLETE', nextStep })
      } else {
        // 'none' — sem transcribe.
        const nextStep = profile.retainAudio ? 'upload' : 'complete'
        setPhaseViaEvent({ type: 'BLOB_READY', nextStep })
      }

      // ─── Upload (D3 + C1) ────────────────────────────────────────
      let audioStoragePath: string | null = null
      // E3 (2026-05-16): captura erro de upload quando policy é
      // 'best-effort' — não throw, retorna no CaptureResult.
      let audioStorageErrorOut: CaptureResult['audioStorageError'] = undefined
      if (profile.retainAudio) {
        let userId: string
        try {
          userId = await adapters.resolveUserId()
          if (!userId) {
            throw new CaptureEngineError(
              'auth-error',
              'resolveUserId retornou valor vazio.',
            )
          }
        } catch (err) {
          const message = describeError(err)
          setError(message)
          await tryMarkSessionFailed(message)
          activeProfile = null
          activeSession = null
          log.error('capture-engine', 'auth resolveUserId failed', {
            mode: profile.mode,
            error: message,
          })
          throw err instanceof CaptureEngineError
            ? err
            : new CaptureEngineError('auth-error', message)
        }

        try {
          const uploadResult = await adapters.storage.uploadAudio({
            sessionId: sessionRef?.id ?? 'unattached',
            blob: sourceResult.blob,
            format: sourceResult.format,
            bucket: profileBundle.storage.bucket,
            pathTemplate: profileBundle.storage.pathTemplate,
            userId,
            // C1: Manual+retainAudio=true → tag presente; Safe → undefined.
            metadataTag: profileBundle.retain.storageMetadataTag,
          })
          audioStoragePath = uploadResult.storagePath

          if (sessionRef) {
            await adapters.persistence.attachAudio(
              sessionRef.id,
              uploadResult.storagePath,
            )
          }
          setPhaseViaEvent({ type: 'UPLOAD_COMPLETE' })
        } catch (err) {
          const message = describeError(err)
          const policy = profile.audioFailurePolicy ?? 'throw'
          const code =
            err instanceof CaptureEngineError ? err.code : 'storage-error'

          // E3: policy 'best-effort' — registra erro no result, NÃO throw.
          // Transcript já foi gerado com sucesso; preserva a nota.
          if (policy === 'best-effort') {
            audioStoragePath = null
            audioStorageErrorOut = { code, message }
            // Não chama setError() para não disparar phase 'error' —
            // ciclo é tratado como completed-com-aviso.
            log.warn(
              'capture-engine',
              'upload falhou sob best-effort: nota preservada sem áudio',
              {
                mode: profile.mode,
                sessionId: sessionRef?.id ?? null,
                code,
                error: message,
              },
            )
            // Não cancela `activeProfile/activeSession` aqui — fluxo
            // continua para markCompleted abaixo.
          } else {
            setError(message)
            await tryMarkSessionFailed(message)
            activeProfile = null
            activeSession = null
            log.error('capture-engine', 'upload falhou sob throw policy', {
              mode: profile.mode,
              sessionId: sessionRef?.id ?? null,
              code,
              error: message,
            })
            throw err instanceof CaptureEngineError
              ? err
              : new CaptureEngineError('storage-error', message)
          }
        }
      }

      // ─── Attach transcript (no-op real per B9B limitation) ───────
      if (transcript && sessionRef) {
        try {
          await adapters.persistence.attachTranscript(
            sessionRef.id,
            transcript,
          )
        } catch {
          // attachTranscript é no-op no schema atual.
        }
      }

      // ─── Mark session completed ──────────────────────────────────
      if (sessionRef) {
        try {
          await adapters.persistence.markCompleted(
            sessionRef.id,
            sourceResult.durationMs,
          )
        } catch (err) {
          // Falha aqui é warning não-bloqueante.
          const message = describeError(err)
          internalState = { ...internalState, error: message }
        }
      }

      const captureResult: CaptureResult = {
        sessionId: sessionRef?.id ?? null,
        audioStoragePath,
        transcript,
        rawBlob: sourceResult.blob,
        durationMs: sourceResult.durationMs,
        format: sourceResult.format,
        ...(audioStorageErrorOut
          ? { audioStorageError: audioStorageErrorOut }
          : {}),
      }
      internalState = { ...internalState, currentResult: captureResult }
      activeProfile = null
      activeSession = null
      log.info('capture-engine', 'stop completed', {
        mode: profile.mode,
        sessionId: sessionRef?.id ?? null,
        retainAudio: profile.retainAudio,
        audioPersisted: audioStoragePath !== null,
        audioStorageError: audioStorageErrorOut?.code ?? null,
        transcriptLength: transcript.length,
        durationMs: sourceResult.durationMs,
      })
      return captureResult
    },

    async cancel(): Promise<void> {
      if (activeSource) {
        try {
          await activeSource.cancel()
        } catch {
          // idempotente
        }
        activeSource = null
      }
      await tryMarkSessionCancelled()
      activeProfile = null
      activeSession = null
      setPhaseViaEvent({ type: 'CANCEL_REQUESTED' })
    },

    async retryPendingUpload(): Promise<void> {
      throw new CaptureEngineError(
        'not-supported',
        'retryPendingUpload not implemented in B9D',
      )
    },

    async reset(): Promise<void> {
      if (activeSource) {
        try {
          await activeSource.cancel()
        } catch {
          // swallow
        }
        activeSource = null
      }
      await tryMarkSessionCancelled()
      activeProfile = null
      activeSession = null
      internalState = {
        phase: INITIAL_CAPTURE_PHASE,
        permission: adapters.permission.snapshot.permission,
        availability: adapters.permission.snapshot.availability,
        interruptionReason: adapters.permission.snapshot.reason,
        capabilities,
        error: null,
        pendingUploads: [],
        currentResult: null,
      }
    },

    async clearError(): Promise<void> {
      setPhaseViaEvent({ type: 'CLEAR_ERROR' })
      internalState = { ...internalState, error: null }
    },
  }
}

// ─── Adapters all-stub (tests/smokes) ────────────────────────────────

export function createAllStubAdapters(): CaptureEngineAdapters {
  return {
    permission: createPermissionAdapterStub(),
    webAudioSource: createWebAudioSourceStub(),
    mediaRecorderSource: createMediaRecorderSourceStub(),
    persistence: createCapturePersistenceStub(),
    storage: createCaptureStorageStub(),
    transcription: createCaptureTranscriptionStub(),
    resolveUserId: async () => 'stub-user-id',
  }
}

// ─── Feature flag bridge ─────────────────────────────────────────────

export function getSelectedCaptureEngineMode(): CaptureEngineSelectedMode {
  return isUnifiedCaptureEngineEnabled() ? 'unified' : 'legacy'
}
