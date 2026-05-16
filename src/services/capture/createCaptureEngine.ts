/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B8 (2026-05-15)
 *
 * Implementação funcional **interna** do CaptureEngine. Compõe:
 *   - tipos do engine (`captureEngine.ts`) — B1
 *   - profiles/policies (`captureProfiles.ts`) — B3
 *   - adapters reais por default + stubs (`adapters/`) — B2/B6
 *   - phase machine + transitions (`capturePhaseMachine.ts`) — B7
 *   - capability detection SSR-safe (`captureCapabilities.ts`) — B7
 *   - feature flag (`captureEngineFeatureFlag.ts`) — B4 (apenas leitura)
 *
 * **Status (B8):** engine é instanciável e funcional para o ciclo
 * start → stop → completed em ambiente browser. Mas:
 *   - Nenhum hook ou componente consome.
 *   - Nenhum fluxo de produção chama.
 *   - Limites explícitos (ver §"Limites B8" abaixo) — sem upload,
 *     sem transcribe, sem persistência, sem TTL/lifecycle, sem UI.
 *
 * **Limites B8 (explícitos):**
 *   1. `CaptureResult.sessionId` é sempre `null` — engine NÃO cria
 *      row em `capture_sessions` (D1 será endereçado em B9+).
 *   2. `CaptureResult.audioStoragePath` é sempre `null` — engine NÃO
 *      sobe blob para Supabase Storage.
 *   3. `CaptureResult.transcript` é sempre `''` — engine NÃO chama
 *      edge `transcribe`/`transcribe-chunk`.
 *   4. `retryPendingUpload()` lança `not-supported` — recovery não
 *      implementado em B8 (D5: Manual sem recovery; Safe Capture
 *      mantém recovery via seu próprio caminho até B9+).
 *   5. `state.pendingUploads` sempre `[]`.
 *   6. Engine usa `state.currentResult.rawBlob` para entregar áudio
 *      ao caller — caller futuro decide upload/transcribe.
 *   7. CapacitorPluginSource ainda não modelado — engine só funciona
 *      em web (browser desktop/mobile). Em `native-capacitor`,
 *      `start()` lança `no-capture-source` por enquanto.
 *   8. Sem listener pattern — consumer precisa re-ler `engine.state`
 *      após cada chamada para snapshot atualizado.
 *   9. Feature flag `useUnifiedCaptureEngine` é lida via
 *      `getSelectedCaptureEngineMode()` mas o engine real só roda se
 *      o caller explicitamente o instanciar. Engine não consulta a
 *      flag internamente (é decisão do consumidor).
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §4 BREAK + §10.
 */

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

// ─── Adapter slot ────────────────────────────────────────────────────

export interface CaptureEngineAdapters {
  permission: PermissionAdapter
  webAudioSource: WebAudioSource
  mediaRecorderSource: MediaRecorderSource
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
  | 'not-supported'

export class CaptureEngineError extends Error {
  readonly code: CaptureEngineErrorCode
  constructor(code: CaptureEngineErrorCode, message: string) {
    super(`CaptureEngine[${code}]: ${message}`)
    this.name = 'CaptureEngineError'
    this.code = code
  }
}

// ─── Helpers internos ────────────────────────────────────────────────

function pickSource(
  profile: CaptureProfile,
  capabilities: CaptureCapabilities,
  adapters: CaptureEngineAdapters,
): MediaSourceLifecycle {
  // Profile pediu explicitamente WAV downsample → WebAudio.
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
  // Default 'native' → MediaRecorder.
  if (capabilities.mediaRecorder.available) {
    return adapters.mediaRecorderSource
  }
  // Fallback para WebAudio se MediaRecorder indisponível.
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

function describeSourceError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'source error'
}

// ─── Factory principal ───────────────────────────────────────────────

/**
 * Cria um `CaptureEngine` funcional para o profile bundle dado.
 *
 * Adapters default = implementações reais (B6). Caller pode override
 * com stubs (`adapters?: { permission: createPermissionAdapterStub() }`)
 * para tests.
 *
 * **Em B8 o engine NÃO consulta `useUnifiedCaptureEngine` internamente.**
 * Quem chama este factory já decidiu (via leitura própria) instanciar
 * o engine novo. A flag fica disponível via `getSelectedCaptureEngineMode()`.
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

  const setPhaseViaEvent = (event: CaptureEvent): void => {
    const result = applyCaptureEvent(internalState.phase, event)
    if (result.ok) {
      internalState = { ...internalState, phase: result.next }
    }
    // Transição inválida = no-op (state mantido). Engine real
    // poderia logar; B8 silencioso para não poluir console.
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

  return {
    // State é exposto via getter — consumer re-lê após cada chamada
    // para snapshot atualizado. Sem listener pattern em B8.
    get state(): CaptureEngineState {
      return internalState
    },

    async start(profile: CaptureProfile): Promise<void> {
      // 1. Sanity de capabilities — atualiza state.capabilities para
      //    consumer poder inspecionar.
      internalState = { ...internalState, capabilities }
      if (!hasAnyCaptureSource(capabilities)) {
        const message = `No capture source available on platform ${capabilities.platform}`
        setError(message)
        throw new CaptureEngineError('unsupported', message)
      }

      // 2. Inicia transição.
      setPhaseViaEvent({ type: 'START_REQUESTED' })

      // 3. Permission flow.
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

      // 4. Seleciona source baseado em profile + capabilities.
      let source: MediaSourceLifecycle
      try {
        source = pickSource(profile, capabilities, resolvedAdapters)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'source pick failed'
        setError(message)
        throw err instanceof CaptureEngineError
          ? err
          : new CaptureEngineError('no-capture-source', message)
      }

      // 5. Inicia source.
      try {
        await source.start(profile)
      } catch (err) {
        const message = describeSourceError(err)
        setError(message)
        throw new CaptureEngineError('source-error', message)
      }

      activeSource = source
      activeProfile = profile
      setPhaseViaEvent({ type: 'RECORDING_STARTED' })
    },

    async stop(): Promise<CaptureResult> {
      const source = activeSource
      if (!source) {
        const message = 'stop() called without active recording'
        setError(message)
        throw new CaptureEngineError('not-recording', message)
      }

      setPhaseViaEvent({ type: 'STOP_REQUESTED' })

      let sourceResult: Awaited<ReturnType<MediaSourceLifecycle['stop']>>
      try {
        sourceResult = await source.stop()
      } catch (err) {
        const message = describeSourceError(err)
        activeSource = null
        activeProfile = null
        setError(message)
        throw new CaptureEngineError('source-error', message)
      }

      activeSource = null
      activeProfile = null

      // B8: pula transcribe + upload — vai direto para `completed`.
      // Quando B9+ implementar transcribe/upload, este branch decide
      // baseado em `profile.transcriptionTrigger` + `profile.retainAudio`.
      setPhaseViaEvent({ type: 'BLOB_READY', nextStep: 'complete' })

      const captureResult: CaptureResult = {
        sessionId: null, // B8: sem persistência em capture_sessions
        audioStoragePath: null, // B8: sem upload
        transcript: '', // B8: sem transcrição
        rawBlob: sourceResult.blob,
        durationMs: sourceResult.durationMs,
        format: sourceResult.format,
      }
      internalState = { ...internalState, currentResult: captureResult }
      return captureResult
    },

    async cancel(): Promise<void> {
      if (activeSource) {
        try {
          await activeSource.cancel()
        } catch {
          // Cancel deve ser idempotente — swallow erros do adapter.
        }
        activeSource = null
        activeProfile = null
      }
      setPhaseViaEvent({ type: 'CANCEL_REQUESTED' })
    },

    async retryPendingUpload(): Promise<void> {
      // B8: retry pendente não implementado. Manual (D5) não tem
      // recovery; Safe Capture mantém recovery via caminho legado
      // até B9+. Throws para deixar claro que consumidor não deve
      // chamar este método no engine novo ainda.
      throw new CaptureEngineError(
        'not-supported',
        'retryPendingUpload not implemented in B8',
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
        activeProfile = null
      }
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

  // `profileBundle` continua acessível via closure se algum método
  // futuro precisar (storage path template, policies, etc). B8 não
  // consulta diretamente — apenas o `profile` recebido em start().
  void profileBundle
  void activeProfile
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

/**
 * Helper para tests: gera adapters todos stubbed (throws em qualquer
 * chamada). Útil para validar que o engine não chama adapter quando
 * não deve.
 */
export function createAllStubAdapters(): CaptureEngineAdapters {
  return {
    permission: createPermissionAdapterStub(),
    webAudioSource: createWebAudioSourceStub(),
    mediaRecorderSource: createMediaRecorderSourceStub(),
  }
}

// ─── Feature flag bridge ─────────────────────────────────────────────

/**
 * Pure read da feature flag. Engine NÃO consulta esta função
 * internamente — é responsabilidade do caller (futuro hook) decidir
 * qual engine instanciar.
 */
export function getSelectedCaptureEngineMode(): CaptureEngineSelectedMode {
  return isUnifiedCaptureEngineEnabled() ? 'unified' : 'legacy'
}
