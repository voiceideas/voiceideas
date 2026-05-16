/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B9C (2026-05-16)
 *
 * CaptureEngine completo: source + permission + persistence + storage +
 * transcription. Engine consome adapters reais por default; caller pode
 * override com stubs para tests.
 *
 * **Status (B9C):** engine instanciável e capaz de rodar fluxo Manual
 * end-to-end em ambiente browser/dev (criar capture_session, gravar,
 * transcrever via edge `transcribe`, fazer upload condicional ao
 * `retainAudio`, marcar session completed). **Zero consumidor em
 * produção.** Hooks legados intocados.
 *
 * **Fluxo Manual implementado:**
 *   - start():
 *     1. Sanity de capabilities.
 *     2. Fluxo de permissão (refresh → prompt → request → granted).
 *     3. Se profile.createSession=true → cria capture_session via
 *        persistence.createSession({ mode, startedAt, profileSnapshot }).
 *     4. pickSource (WebAudio vs MediaRecorder).
 *     5. source.start(profile) → RECORDING_STARTED.
 *   - stop():
 *     1. STOP_REQUESTED → source.stop() → blob.
 *     2. Se transcriptionTrigger='after_stop' →
 *        transcription.transcribe(); falha aqui = error + markFailed + throw.
 *     3. Se profile.retainAudio=true → storage.uploadAudio() com
 *        metadataTag=`capture-mode:manual` se profile.retain.storageMetadataTag
 *        presente; falha aqui = error + markFailed + throw (NÃO mascara
 *        sucesso parcial mesmo que transcribe tenha completado).
 *     4. attachAudio(sessionId, storagePath) se sessionId existe.
 *     5. attachTranscript(sessionId, transcript) — no-op no schema atual
 *        (limitação B9B), retorna sem erro.
 *     6. markCompleted(sessionId, durationMs) — falha é warning não-bloqueante.
 *     7. Retorna CaptureResult{ sessionId, audioStoragePath, transcript,
 *        rawBlob, durationMs, format }.
 *   - cancel():
 *     1. source.cancel() (idempotente).
 *     2. Se sessionId existe → markCancelled(sessionId) (best-effort).
 *   - reset()/clearError(): mantidos como B8.
 *
 * **Safe Capture (transcriptionTrigger='chunk_or_session'):**
 *   Engine NÃO ativa pipeline async em B9C — `transcribeChunkAsync`/
 *   `transcribeSessionAsync` do adapter B9B throws `unsupported`. Engine
 *   **silencia** essa branch: pula transcribe (transcript='') e segue
 *   para upload+completed. Caller que quiser pipeline async deve aguardar
 *   B9D+ ou consumir via outra rota. Documentado como "caminho reservado".
 *
 * **Limites B9C (explícitos):**
 *   - Engine não consome `useUnifiedCaptureEngine` internamente; quem
 *     instancia decide.
 *   - `CaptureResult.sessionId` é populado quando profile.createSession=true.
 *   - `CaptureResult.audioStoragePath` é populado quando retainAudio=true
 *     e upload sucesso.
 *   - `CaptureResult.transcript` é populado quando trigger='after_stop'
 *     e transcribe sucesso. Para Safe (trigger='chunk_or_session'): vazio.
 *   - `attachTranscript` na persistência é no-op por limitação de schema
 *     (B9B). Transcript só vive no `CaptureResult` retornado em memória.
 *   - `retryPendingUpload()` continua throw `not-supported` (D5).
 *   - CapacitorPluginSource não modelado — native-capacitor recebe
 *     `no-capture-source`.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §4 EXECUTE.
 */

import { supabase } from '../../lib/supabase'
import type {
  CaptureEngine,
  CaptureEngineState,
  CaptureMode,
  CaptureProfile,
  CaptureResult,
} from './captureEngine'
import type {
  CaptureProfileBundle,
  GetCaptureProfileOptions,
} from './captureProfiles'
import { getCaptureProfile } from './captureProfiles'
import type {
  MediaRecorderSource,
  MediaSourceLifecycle,
  PermissionAdapter,
  WebAudioSource,
} from './adapters'
import {
  createMediaRecorderSource,
  createMediaRecorderSourceStub,
  createPermissionAdapter,
  createPermissionAdapterStub,
  createWebAudioSource,
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
import type {
  CapturePersistence,
  CaptureSessionRecord,
} from './capturePersistence'
import {
  createCapturePersistenceStub,
  toSessionProfileSnapshot,
} from './capturePersistence'
import { createSupabaseCapturePersistence } from './captureSupabasePersistence'
import type { CaptureStorage } from './captureStorage'
import { createCaptureStorageStub } from './captureStorage'
import { createSupabaseCaptureStorage } from './captureSupabaseStorage'
import type { CaptureTranscription } from './captureTranscription'
import { createCaptureTranscriptionStub } from './captureTranscription'
import { createCaptureTranscriptionAdapter } from './captureTranscriptionAdapter'

// ─── Adapter slot ────────────────────────────────────────────────────

export interface CaptureEngineAdapters {
  permission: PermissionAdapter
  webAudioSource: WebAudioSource
  mediaRecorderSource: MediaRecorderSource
  persistence: CapturePersistence
  storage: CaptureStorage
  transcription: CaptureTranscription
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

async function resolveCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user?.id) {
    throw new CaptureEngineError(
      'auth-error',
      'Usuário não autenticado — não é possível resolver userId para storage upload.',
    )
  }
  return data.user.id
}

// ─── Factory principal ───────────────────────────────────────────────

/**
 * Cria um `CaptureEngine` funcional para o profile bundle dado.
 *
 * Adapters default = implementações reais (B6/B9B). Caller pode
 * override com stubs (`createAllStubAdapters()` ou Partial<adapters>).
 *
 * Engine NÃO consulta `useUnifiedCaptureEngine` internamente — caller
 * decide quando instanciar.
 */
export function createCaptureEngine(
  profileBundle: CaptureProfileBundle,
  adapters?: Partial<CaptureEngineAdapters>,
): CaptureEngine {
  const resolvedAdapters: CaptureEngineAdapters = {
    permission: adapters?.permission ?? createPermissionAdapter(),
    webAudioSource: adapters?.webAudioSource ?? createWebAudioSource(),
    mediaRecorderSource:
      adapters?.mediaRecorderSource ?? createMediaRecorderSource(),
    persistence: adapters?.persistence ?? createSupabaseCapturePersistence(),
    storage: adapters?.storage ?? createSupabaseCaptureStorage(),
    transcription:
      adapters?.transcription ?? createCaptureTranscriptionAdapter(),
  }

  const capabilities = detectCaptureCapabilities()

  let internalState: CaptureEngineState = {
    phase: INITIAL_CAPTURE_PHASE,
    permission: resolvedAdapters.permission.snapshot.permission,
    availability: resolvedAdapters.permission.snapshot.availability,
    interruptionReason: resolvedAdapters.permission.snapshot.reason,
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
    const snap = resolvedAdapters.permission.snapshot
    internalState = {
      ...internalState,
      permission: snap.permission,
      availability: snap.availability,
      interruptionReason: snap.reason,
    }
  }

  /**
   * Tenta marcar session como failed sem propagar erro do markFailed
   * em si — engine já está em fluxo de erro; falha aninhada não pode
   * mascarar a falha original do caller.
   */
  const tryMarkSessionFailed = async (reason: string): Promise<void> => {
    if (!activeSession) return
    try {
      await resolvedAdapters.persistence.markFailed(activeSession.id, reason)
    } catch {
      // Engulo: erro principal já vai propagar.
    }
  }

  /**
   * Tenta marcar session como cancelled sem propagar erro nested.
   */
  const tryMarkSessionCancelled = async (): Promise<void> => {
    if (!activeSession) return
    try {
      await resolvedAdapters.persistence.markCancelled(activeSession.id)
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
      let permSnap = await resolvedAdapters.permission.refresh()
      syncPermissionSnapshot()
      if (permSnap.permission !== 'granted') {
        setPhaseViaEvent({ type: 'PERMISSION_PROMPTED' })
        permSnap = await resolvedAdapters.permission.request()
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
      // profile.createSession=true (default Manual e Safe per B3) → cria
      // row em capture_sessions antes do source.start, para que erro
      // futuro possa ser registrado contra essa session.
      if (profile.createSession) {
        try {
          activeSession = await resolvedAdapters.persistence.createSession({
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
        source = pickSource(profile, capabilities, resolvedAdapters)
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
        throw new CaptureEngineError('source-error', message)
      }

      activeSource = null
      // Mantenho activeProfile e activeSession até a final do stop,
      // necessários para upload/persistence steps abaixo.

      // ─── Transcribe (D4) ─────────────────────────────────────────
      let transcript = ''
      if (profile.transcriptionTrigger === 'after_stop') {
        setPhaseViaEvent({ type: 'BLOB_READY', nextStep: 'transcribe' })
        try {
          const r = await resolvedAdapters.transcription.transcribe({
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
          throw new CaptureEngineError('transcription-error', message)
        }
        const nextStep = profile.retainAudio ? 'upload' : 'complete'
        setPhaseViaEvent({ type: 'TRANSCRIPTION_COMPLETE', nextStep })
      } else {
        // 'chunk_or_session' (Safe Capture) — pipeline async reservado;
        // engine NÃO consome em B9C. Skip silencioso, transcript fica
        // vazio. Caller real do Safe Capture continua usando o caminho
        // legado (useSafeCaptureMode) até B9D+.
        // 'none' → simplesmente skip.
        const nextStep = profile.retainAudio ? 'upload' : 'complete'
        setPhaseViaEvent({ type: 'BLOB_READY', nextStep })
      }

      // ─── Upload (D3 + C1) ────────────────────────────────────────
      let audioStoragePath: string | null = null
      if (profile.retainAudio) {
        let userId: string
        try {
          userId = await resolveCurrentUserId()
        } catch (err) {
          const message = describeError(err)
          setError(message)
          await tryMarkSessionFailed(message)
          activeProfile = null
          activeSession = null
          throw err instanceof CaptureEngineError
            ? err
            : new CaptureEngineError('auth-error', message)
        }

        try {
          const uploadResult = await resolvedAdapters.storage.uploadAudio({
            sessionId: sessionRef?.id ?? 'unattached',
            blob: sourceResult.blob,
            format: sourceResult.format,
            bucket: profileBundle.storage.bucket,
            pathTemplate: profileBundle.storage.pathTemplate,
            userId,
            // C1: tag obrigatória Manual com retain=true; safeCaptureProfile
            // tem storageMetadataTag=undefined → tag não é propagada.
            metadataTag: profileBundle.retain.storageMetadataTag,
          })
          audioStoragePath = uploadResult.storagePath

          if (sessionRef) {
            await resolvedAdapters.persistence.attachAudio(
              sessionRef.id,
              uploadResult.storagePath,
            )
          }
        } catch (err) {
          const message = describeError(err)
          setError(message)
          await tryMarkSessionFailed(message)
          activeProfile = null
          activeSession = null
          // Mesmo se transcribe deu certo, upload falha = throw.
          // Não mascarar como sucesso parcial.
          throw err instanceof CaptureEngineError
            ? err
            : new CaptureEngineError('storage-error', message)
        }
        setPhaseViaEvent({ type: 'UPLOAD_COMPLETE' })
      }

      // ─── Attach transcript (no-op real per B9B limitation) ──────
      if (transcript && sessionRef) {
        try {
          await resolvedAdapters.persistence.attachTranscript(
            sessionRef.id,
            transcript,
          )
        } catch {
          // attachTranscript é no-op no schema atual. Se algum dia
          // virar real e falhar, não bloqueia retorno do result.
        }
      }

      // ─── Mark session completed ──────────────────────────────────
      if (sessionRef) {
        try {
          await resolvedAdapters.persistence.markCompleted(
            sessionRef.id,
            sourceResult.durationMs,
          )
        } catch (err) {
          // Falha aqui é warning não-bloqueante: blob, transcript e
          // storage path estão OK. Sessão pode ser reconciliada por
          // job externo. Engine reporta no internalState.error.
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
      }
      internalState = { ...internalState, currentResult: captureResult }
      activeProfile = null
      activeSession = null
      return captureResult
    },

    async cancel(): Promise<void> {
      if (activeSource) {
        try {
          await activeSource.cancel()
        } catch {
          // Cancel idempotente.
        }
        activeSource = null
      }
      // Mark cancelled se já havia session criada.
      await tryMarkSessionCancelled()
      activeProfile = null
      activeSession = null
      setPhaseViaEvent({ type: 'CANCEL_REQUESTED' })
    },

    async retryPendingUpload(): Promise<void> {
      // D5: Manual sem recovery; Safe Capture mantém recovery via
      // caminho legado até B9D+. Throws para consumidor não confundir.
      throw new CaptureEngineError(
        'not-supported',
        'retryPendingUpload not implemented in B9C',
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
        permission: resolvedAdapters.permission.snapshot.permission,
        availability: resolvedAdapters.permission.snapshot.availability,
        interruptionReason: resolvedAdapters.permission.snapshot.reason,
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

// ─── Atalhos por mode ────────────────────────────────────────────────

export function createManualCaptureEngine(
  options?: GetCaptureProfileOptions,
  adapters?: Partial<CaptureEngineAdapters>,
): CaptureEngine {
  const bundle = getCaptureProfile('manual', options)
  return createCaptureEngine(bundle, adapters)
}

export function createSafeCaptureEngine(
  options?: GetCaptureProfileOptions,
  adapters?: Partial<CaptureEngineAdapters>,
): CaptureEngine {
  const bundle = getCaptureProfile('safe_capture', options)
  return createCaptureEngine(bundle, adapters)
}

export function createCaptureEngineForMode(
  mode: CaptureMode,
  options?: GetCaptureProfileOptions,
  adapters?: Partial<CaptureEngineAdapters>,
): CaptureEngine {
  return mode === 'manual'
    ? createManualCaptureEngine(options, adapters)
    : createSafeCaptureEngine(options, adapters)
}

// ─── Adapters all-stub (tests) ───────────────────────────────────────

export function createAllStubAdapters(): CaptureEngineAdapters {
  return {
    permission: createPermissionAdapterStub(),
    webAudioSource: createWebAudioSourceStub(),
    mediaRecorderSource: createMediaRecorderSourceStub(),
    persistence: createCapturePersistenceStub(),
    storage: createCaptureStorageStub(),
    transcription: createCaptureTranscriptionStub(),
  }
}

// ─── Feature flag bridge ─────────────────────────────────────────────

export function getSelectedCaptureEngineMode(): CaptureEngineSelectedMode {
  return isUnifiedCaptureEngineEnabled() ? 'unified' : 'legacy'
}
