/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B9D (2026-05-16)
 *
 * Smoke isolado do CaptureEngine usando adapters fake em memória.
 * Roda via Node `--experimental-strip-types` (Node 22.6+).
 *
 * **Como executar:**
 *   ```
 *   npm run smoke:capture-engine
 *   ```
 * ou diretamente:
 *   ```
 *   node --experimental-strip-types \
 *     src/services/capture/__smoke__/captureEngine.smoke.ts
 *   ```
 *
 * **NÃO executa em produção.** Não importa Supabase real, não chama
 * edge functions, não toca Storage. Todos os adapters são fakes em
 * memória.
 *
 * Cenários cobertos:
 *   1. Manual retainAudio=false (transcribe + sem upload)
 *   2. Manual retainAudio=true (transcribe + upload com metadata C1)
 *   3. Permission denied → permission-denied + markFailed
 *   4. Transcribe failure → transcription-error + markFailed
 *   5. Upload failure (após transcribe ok) → storage-error + markFailed (sem mascarar)
 *   6. Cancel após session criada → markCancelled
 *   7. Reset + clearError limpam estado
 *   8. Safe Capture (chunk_or_session) → safe-async-reserved + markFailed
 *   9. C1: Manual+retainAudio=true passa metadata; Safe não recebe metadata Manual
 */

import { getCaptureProfile } from '../captureProfiles'
import { createCaptureEngine } from '../createCaptureEngine'
import type {
  CaptureEngineAdapters,
  CaptureEngineUserIdResolver,
} from '../createCaptureEngine'
import { CaptureEngineError } from '../createCaptureEngine'
import type {
  PermissionAdapter,
  PermissionSnapshot,
  MediaRecorderSource,
  MediaSourceResult,
  WebAudioSource,
} from '../adapters'
import type {
  CapturePersistence,
  CaptureSessionInput,
  CaptureSessionRecord,
} from '../capturePersistence'
import type {
  CaptureStorage,
  CaptureStorageUploadInput,
  CaptureStorageUploadResult,
} from '../captureStorage'
import type {
  CaptureTranscription,
  CaptureTranscriptionInput,
  CaptureTranscriptionResult,
} from '../captureTranscription'

// ─── Fake capabilities support ───────────────────────────────────────
// detectCaptureCapabilities() em Node retorna platform='ssr' e capacities
// false. Para os fakes, NÃO precisamos engine real para iniciar source —
// passamos sources fakes que IGNORAM capabilities. Mas pickSource() interno
// verifica capabilities.mediaRecorder.available, etc.
//
// Workaround: monkey-patch globals do Node para fingir que MediaRecorder
// e AudioContext existem. Suficiente para hasAnyCaptureSource() retornar
// true e pickSource() escolher o MediaRecorderSource fake.

function defineGlobal(name: string, value: unknown): void {
  // Em Node 25, alguns globals (navigator) são getters read-only; precisa
  // Object.defineProperty para sobrescrever. Para outros, simples atribuição
  // funciona — defineProperty cobre ambos casos.
  try {
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    })
  } catch {
    // fallback silencioso
    ;(globalThis as unknown as Record<string, unknown>)[name] = value
  }
}

function installFakeBrowserGlobals(): void {
  defineGlobal('window', globalThis)

  const fakeNavigator = {
    userAgent: 'node-smoke',
    mediaDevices: {
      getUserMedia: async () => {
        throw new Error('fake getUserMedia — not used in smoke')
      },
    },
    permissions: undefined,
  }
  defineGlobal('navigator', fakeNavigator)

  class FakeMediaRecorder {
    static isTypeSupported(mimeType: string): boolean {
      return mimeType.length > 0
    }
  }
  defineGlobal('MediaRecorder', FakeMediaRecorder)

  class FakeAudioContext {
    sampleRate = 48000
    state = 'running'
    createMediaStreamSource(): unknown {
      throw new Error('fake AudioContext — not used in smoke')
    }
    createScriptProcessor(): unknown {
      return {}
    }
    close(): Promise<void> {
      return Promise.resolve()
    }
  }
  defineGlobal('AudioContext', FakeAudioContext)
}

// ─── Fake adapters ───────────────────────────────────────────────────

interface FakeAdapterRefs {
  permission: {
    grant: () => void
    deny: (reason?: string) => void
    requests: number
  }
  source: {
    startCalls: Array<{ profile: unknown }>
    stopCalls: number
    forceStopFail: (msg?: string) => void
  }
  persistence: {
    createCalls: Array<CaptureSessionInput>
    markCompletedCalls: Array<{ id: string; durationMs: number }>
    markCancelledCalls: string[]
    markFailedCalls: Array<{ id: string; reason: string }>
    attachAudioCalls: Array<{ id: string; path: string }>
    attachTranscriptCalls: Array<{ id: string; transcript: string }>
    sessions: CaptureSessionRecord[]
  }
  storage: {
    uploadCalls: CaptureStorageUploadInput[]
    forceUploadFail: (msg?: string) => void
  }
  transcription: {
    transcribeCalls: CaptureTranscriptionInput[]
    forceTranscribeFail: (msg?: string) => void
    transcriptText: string
  }
  resolveUserId: {
    calls: number
  }
}

function makeAdapters(): { adapters: CaptureEngineAdapters; refs: FakeAdapterRefs } {
  let permissionSnapshot: PermissionSnapshot = {
    permission: 'granted',
    availability: 'available',
    reason: null,
  }
  let permissionRequests = 0

  const permission: PermissionAdapter = {
    get snapshot() {
      return permissionSnapshot
    },
    refresh: async () => permissionSnapshot,
    request: async () => {
      permissionRequests += 1
      return permissionSnapshot
    },
    subscribe: () => () => undefined,
  }

  const startCalls: Array<{ profile: unknown }> = []
  let stopCalls = 0
  let stopShouldFail: string | null = null
  let recording = false

  const sharedSourceLifecycle = {
    get isRecording() {
      return recording
    },
    async start(profile: unknown) {
      startCalls.push({ profile })
      recording = true
    },
    async stop(): Promise<MediaSourceResult> {
      stopCalls += 1
      recording = false
      if (stopShouldFail) {
        throw new Error(stopShouldFail)
      }
      const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
        type: 'audio/webm',
      })
      return {
        blob,
        format: 'webm',
        durationMs: 1234,
        chunks: [],
      }
    },
    async cancel() {
      recording = false
    },
  }
  const mediaRecorderSource: MediaRecorderSource = {
    kind: 'media-recorder' as const,
    ...sharedSourceLifecycle,
  }
  const webAudioSource: WebAudioSource = {
    kind: 'web-audio' as const,
    targetSampleRate: 16000,
    ...sharedSourceLifecycle,
  }

  const sessions: CaptureSessionRecord[] = []
  const createCalls: Array<CaptureSessionInput> = []
  const markCompletedCalls: Array<{ id: string; durationMs: number }> = []
  const markCancelledCalls: string[] = []
  const markFailedCalls: Array<{ id: string; reason: string }> = []
  const attachAudioCalls: Array<{ id: string; path: string }> = []
  const attachTranscriptCalls: Array<{ id: string; transcript: string }> = []
  let sessionCounter = 0

  const persistence: CapturePersistence = {
    createSession: async (input) => {
      createCalls.push(input)
      sessionCounter += 1
      const record: CaptureSessionRecord = {
        id: `session-${sessionCounter}`,
        mode: input.mode,
        status: 'pending',
        startedAt: input.startedAt,
        completedAt: null,
        cancelledAt: null,
        failedAt: null,
        failureReason: null,
        durationMs: null,
        audioStoragePath: null,
        transcript: null,
      }
      sessions.push(record)
      return record
    },
    markCompleted: async (id, durationMs) => {
      markCompletedCalls.push({ id, durationMs })
      const record = sessions.find((s) => s.id === id)
      if (!record) throw new Error('session not found')
      record.status = 'completed'
      record.completedAt = new Date().toISOString()
      record.durationMs = durationMs
      return record
    },
    markCancelled: async (id) => {
      markCancelledCalls.push(id)
      const record = sessions.find((s) => s.id === id)
      if (!record) throw new Error('session not found')
      record.status = 'cancelled'
      record.cancelledAt = new Date().toISOString()
      return record
    },
    markFailed: async (id, reason) => {
      markFailedCalls.push({ id, reason })
      const record = sessions.find((s) => s.id === id)
      if (!record) throw new Error('session not found')
      record.status = 'failed'
      record.failedAt = new Date().toISOString()
      record.failureReason = reason
      return record
    },
    attachAudio: async (id, path) => {
      attachAudioCalls.push({ id, path })
      const record = sessions.find((s) => s.id === id)
      if (!record) throw new Error('session not found')
      record.audioStoragePath = path
      return record
    },
    attachTranscript: async (id, transcript) => {
      attachTranscriptCalls.push({ id, transcript })
      const record = sessions.find((s) => s.id === id)
      if (!record) throw new Error('session not found')
      record.transcript = transcript
      return record
    },
  }

  const uploadCalls: CaptureStorageUploadInput[] = []
  let uploadShouldFail: string | null = null

  const storage: CaptureStorage = {
    uploadAudio: async (
      input: CaptureStorageUploadInput,
    ): Promise<CaptureStorageUploadResult> => {
      uploadCalls.push(input)
      if (uploadShouldFail) {
        throw new Error(uploadShouldFail)
      }
      return {
        bucket: input.bucket,
        storagePath: `${input.userId}/sessions/${input.sessionId}/chunks/fake.${input.format}`,
        chunkId: 'fake-chunk-id',
        bytes: input.blob.size,
        uploadedAt: new Date().toISOString(),
      }
    },
    deleteAudio: async () => undefined,
  }

  const transcribeCalls: CaptureTranscriptionInput[] = []
  let transcribeShouldFail: string | null = null
  let transcriptText = 'fake transcript text'

  const transcription: CaptureTranscription = {
    transcribe: async (
      input: CaptureTranscriptionInput,
    ): Promise<CaptureTranscriptionResult> => {
      transcribeCalls.push(input)
      if (transcribeShouldFail) {
        throw new Error(transcribeShouldFail)
      }
      return {
        text: transcriptText,
        language: input.language ?? 'pt',
        durationMs: 100,
        source: 'transcribe-sync',
      }
    },
    transcribeChunkAsync: async () => {
      throw new Error('not used in smoke')
    },
    transcribeSessionAsync: async () => {
      throw new Error('not used in smoke')
    },
  }

  let resolveUserIdCalls = 0
  const resolveUserId: CaptureEngineUserIdResolver = async () => {
    resolveUserIdCalls += 1
    return 'fake-user-id'
  }

  return {
    adapters: {
      permission,
      webAudioSource,
      mediaRecorderSource,
      persistence,
      storage,
      transcription,
      resolveUserId,
    },
    refs: {
      permission: {
        grant: () => {
          permissionSnapshot = {
            permission: 'granted',
            availability: 'available',
            reason: null,
          }
        },
        deny: (reason = 'NotAllowedError') => {
          permissionSnapshot = {
            permission: 'denied',
            availability: 'permission-denied',
            reason,
          }
        },
        get requests() {
          return permissionRequests
        },
      },
      source: {
        startCalls,
        get stopCalls() {
          return stopCalls
        },
        forceStopFail: (msg = 'fake stop fail') => {
          stopShouldFail = msg
        },
      },
      persistence: {
        createCalls,
        markCompletedCalls,
        markCancelledCalls,
        markFailedCalls,
        attachAudioCalls,
        attachTranscriptCalls,
        sessions,
      },
      storage: {
        uploadCalls,
        forceUploadFail: (msg = 'fake upload fail') => {
          uploadShouldFail = msg
        },
      },
      transcription: {
        transcribeCalls,
        forceTranscribeFail: (msg = 'fake transcribe fail') => {
          transcribeShouldFail = msg
        },
        get transcriptText() {
          return transcriptText
        },
        set transcriptText(v: string) {
          transcriptText = v
        },
      },
      resolveUserId: {
        get calls() {
          return resolveUserIdCalls
        },
      },
    },
  }
}

// ─── Assertion helpers ───────────────────────────────────────────────

interface ScenarioResult {
  name: string
  ok: boolean
  notes: string[]
}

function check(
  result: ScenarioResult,
  condition: boolean,
  message: string,
): void {
  if (condition) {
    result.notes.push(`✓ ${message}`)
  } else {
    result.ok = false
    result.notes.push(`✗ ${message}`)
  }
}

async function expectThrows(
  result: ScenarioResult,
  fn: () => Promise<unknown>,
  expectedCode: string,
  label: string,
): Promise<void> {
  try {
    await fn()
    check(result, false, `${label}: esperado throw, mas resolveu`)
  } catch (err) {
    if (err instanceof CaptureEngineError && err.code === expectedCode) {
      check(result, true, `${label}: throw com code=${expectedCode}`)
    } else {
      check(
        result,
        false,
        `${label}: throw inesperado: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

// ─── Cenários ────────────────────────────────────────────────────────

async function scenarioManualNoRetain(): Promise<ScenarioResult> {
  const r: ScenarioResult = {
    name: 'S1: Manual retainAudio=false',
    ok: true,
    notes: [],
  }
  const { adapters, refs } = makeAdapters()
  const bundle = getCaptureProfile('manual', { retainAudio: false })
  const engine = createCaptureEngine(bundle, adapters)

  await engine.start(bundle.engineProfile)
  check(r, refs.persistence.createCalls.length === 1, 'session criada no start')
  const result = await engine.stop()

  check(r, result.sessionId !== null, 'sessionId presente no result')
  check(r, result.transcript === 'fake transcript text', 'transcript populado')
  check(r, result.audioStoragePath === null, 'audioStoragePath null (sem upload)')
  check(r, refs.transcription.transcribeCalls.length === 1, 'transcribe chamado uma vez')
  check(r, refs.storage.uploadCalls.length === 0, 'storage.uploadAudio NÃO chamado')
  check(
    r,
    refs.persistence.markCompletedCalls.length === 1,
    'session marcada completed',
  )
  return r
}

async function scenarioManualWithRetain(): Promise<ScenarioResult> {
  const r: ScenarioResult = {
    name: 'S2: Manual retainAudio=true (C1 metadata)',
    ok: true,
    notes: [],
  }
  const { adapters, refs } = makeAdapters()
  const bundle = getCaptureProfile('manual', { retainAudio: true })
  const engine = createCaptureEngine(bundle, adapters)

  await engine.start(bundle.engineProfile)
  const result = await engine.stop()

  check(r, refs.storage.uploadCalls.length === 1, 'storage.uploadAudio chamado')
  const uploadCall = refs.storage.uploadCalls[0]!
  check(
    r,
    uploadCall.metadataTag?.key === 'capture-mode' &&
      uploadCall.metadataTag?.value === 'manual',
    'C1: metadata tag capture-mode=manual presente',
  )
  check(r, uploadCall.bucket === 'voice-captures', 'bucket=voice-captures (D7)')
  check(r, result.audioStoragePath !== null, 'audioStoragePath populado')
  check(r, result.transcript === 'fake transcript text', 'transcript populado')
  check(
    r,
    refs.persistence.attachAudioCalls.length === 1,
    'attachAudio chamado',
  )
  check(
    r,
    refs.persistence.markCompletedCalls.length === 1,
    'session marcada completed',
  )
  check(r, refs.resolveUserId.calls === 1, 'resolveUserId chamado uma vez')
  return r
}

async function scenarioPermissionDenied(): Promise<ScenarioResult> {
  const r: ScenarioResult = {
    name: 'S3: Permission denied',
    ok: true,
    notes: [],
  }
  const { adapters, refs } = makeAdapters()
  refs.permission.deny('NotAllowedError')
  const bundle = getCaptureProfile('manual')
  const engine = createCaptureEngine(bundle, adapters)

  await expectThrows(
    r,
    () => engine.start(bundle.engineProfile),
    'permission-denied',
    'start lança permission-denied',
  )
  check(
    r,
    refs.persistence.createCalls.length === 0,
    'session NÃO criada (permission falhou antes)',
  )
  return r
}

async function scenarioTranscribeFailure(): Promise<ScenarioResult> {
  const r: ScenarioResult = {
    name: 'S4: Transcribe failure',
    ok: true,
    notes: [],
  }
  const { adapters, refs } = makeAdapters()
  refs.transcription.forceTranscribeFail('Whisper API 500')
  const bundle = getCaptureProfile('manual', { retainAudio: true })
  const engine = createCaptureEngine(bundle, adapters)

  await engine.start(bundle.engineProfile)
  await expectThrows(
    r,
    () => engine.stop(),
    'transcription-error',
    'stop lança transcription-error',
  )
  check(r, refs.persistence.markFailedCalls.length === 1, 'session markFailed chamado')
  check(
    r,
    refs.storage.uploadCalls.length === 0,
    'upload NÃO foi chamado (transcribe falhou antes)',
  )
  return r
}

async function scenarioUploadFailure(): Promise<ScenarioResult> {
  const r: ScenarioResult = {
    name: "S5: Upload failure sob policy 'throw' (Safe-like, estrito)",
    ok: true,
    notes: [],
  }
  const { adapters, refs } = makeAdapters()
  refs.storage.forceUploadFail('Bucket quota exceeded')
  // E3 (2026-05-16): Manual+retain default é 'best-effort' agora; este
  // cenário força 'throw' explicitamente para preservar a cobertura do
  // path estrito (que Safe Capture vai usar quando integrar engine).
  const bundle = getCaptureProfile('manual', {
    retainAudio: true,
    audioFailurePolicy: 'throw',
  })
  const engine = createCaptureEngine(bundle, adapters)

  await engine.start(bundle.engineProfile)
  await expectThrows(
    r,
    () => engine.stop(),
    'storage-error',
    'stop lança storage-error sob policy throw',
  )
  check(
    r,
    refs.transcription.transcribeCalls.length === 1,
    'transcribe foi chamado (antes do upload falhar)',
  )
  check(
    r,
    refs.persistence.markFailedCalls.length === 1,
    'session markFailed sob policy throw',
  )
  check(
    r,
    refs.persistence.markCompletedCalls.length === 0,
    'session NÃO marcada completed sob policy throw',
  )
  return r
}

/**
 * VI_CAPTURE_ENGINE_UNIFICATION — E3 (2026-05-16). Upload falha mas
 * policy 'best-effort' (default de Manual+retain) preserva a nota:
 *   - stop() NÃO lança
 *   - result.audioStoragePath === null
 *   - result.audioStorageError populado com code + message
 *   - result.transcript preservado
 *   - session marcada completed (transcript foi sucesso)
 *   - markFailed NÃO chamado
 */
async function scenarioUploadFailureBestEffort(): Promise<ScenarioResult> {
  const r: ScenarioResult = {
    name: "S5b: Upload failure sob policy 'best-effort' (E3 Manual+retain)",
    ok: true,
    notes: [],
  }
  const { adapters, refs } = makeAdapters()
  refs.storage.forceUploadFail('Bucket quota exceeded')
  // Sem override de audioFailurePolicy — Manual+retain seta default
  // 'best-effort' automaticamente via getCaptureProfile.
  const bundle = getCaptureProfile('manual', { retainAudio: true })
  check(
    r,
    bundle.engineProfile.audioFailurePolicy === 'best-effort',
    "default policy de Manual+retain é 'best-effort'",
  )
  const engine = createCaptureEngine(bundle, adapters)

  await engine.start(bundle.engineProfile)
  let result: Awaited<ReturnType<typeof engine.stop>> | null = null
  let thrownError: unknown = null
  try {
    result = await engine.stop()
  } catch (err) {
    thrownError = err
  }

  check(r, thrownError === null, 'stop() NÃO lança sob best-effort')
  check(r, result !== null, 'stop() retorna CaptureResult')
  if (result) {
    check(r, result.audioStoragePath === null, 'audioStoragePath é null')
    check(
      r,
      result.audioStorageError !== undefined,
      'audioStorageError populado',
    )
    check(
      r,
      result.audioStorageError?.code === 'storage-error',
      'audioStorageError.code === storage-error',
    )
    check(
      r,
      typeof result.audioStorageError?.message === 'string' &&
        result.audioStorageError.message.length > 0,
      'audioStorageError.message não vazio',
    )
    check(
      r,
      result.transcript === 'fake transcript text',
      'transcript preservado mesmo com upload falho',
    )
  }
  check(
    r,
    refs.transcription.transcribeCalls.length === 1,
    'transcribe foi chamado antes do upload',
  )
  check(
    r,
    refs.persistence.markCompletedCalls.length === 1,
    'session marcada completed (transcript OK)',
  )
  check(
    r,
    refs.persistence.markFailedCalls.length === 0,
    'session NÃO marcada failed sob best-effort',
  )
  check(
    r,
    refs.persistence.attachAudioCalls.length === 0,
    'attachAudio NÃO chamado (upload falhou)',
  )
  return r
}

async function scenarioCancelAfterStart(): Promise<ScenarioResult> {
  const r: ScenarioResult = {
    name: 'S6: Cancel depois de session criada',
    ok: true,
    notes: [],
  }
  const { adapters, refs } = makeAdapters()
  const bundle = getCaptureProfile('manual')
  const engine = createCaptureEngine(bundle, adapters)

  await engine.start(bundle.engineProfile)
  check(r, refs.persistence.createCalls.length === 1, 'session criada')
  await engine.cancel()
  check(r, refs.persistence.markCancelledCalls.length === 1, 'markCancelled chamado')
  check(
    r,
    refs.persistence.markCompletedCalls.length === 0,
    'markCompleted NÃO chamado',
  )
  check(r, engine.state.phase.status === 'idle', 'engine phase voltou para idle')
  return r
}

async function scenarioResetClearError(): Promise<ScenarioResult> {
  const r: ScenarioResult = {
    name: 'S7: Reset + clearError',
    ok: true,
    notes: [],
  }
  const { adapters, refs } = makeAdapters()
  refs.permission.deny('test')
  const bundle = getCaptureProfile('manual')
  const engine = createCaptureEngine(bundle, adapters)

  await expectThrows(
    r,
    () => engine.start(bundle.engineProfile),
    'permission-denied',
    'permission-denied trava em error',
  )
  check(r, engine.state.phase.status === 'error', 'phase=error após falha')
  check(r, engine.state.error !== null, 'state.error populado')

  await engine.clearError()
  check(r, engine.state.error === null, 'clearError zera state.error')
  check(r, engine.state.phase.status === 'idle', 'clearError volta para idle')

  await engine.reset()
  check(
    r,
    engine.state.phase.status === 'idle' && engine.state.error === null,
    'reset retorna estado limpo',
  )
  return r
}

async function scenarioSafeAsyncReserved(): Promise<ScenarioResult> {
  const r: ScenarioResult = {
    name: 'S8: Safe Capture (chunk_or_session) → safe-async-reserved',
    ok: true,
    notes: [],
  }
  const { adapters, refs } = makeAdapters()
  refs.permission.grant()
  const bundle = getCaptureProfile('safe_capture')
  const engine = createCaptureEngine(bundle, adapters)

  await engine.start(bundle.engineProfile)
  check(r, refs.persistence.createCalls.length === 1, 'session criada')

  await expectThrows(
    r,
    () => engine.stop(),
    'safe-async-reserved',
    'stop lança safe-async-reserved',
  )
  check(
    r,
    refs.persistence.markFailedCalls.length === 1,
    'session markFailed (não retorna sucesso silencioso)',
  )
  check(
    r,
    refs.transcription.transcribeCalls.length === 0,
    'transcribe sync NÃO chamado para Safe',
  )
  check(
    r,
    refs.storage.uploadCalls.length === 0,
    'upload NÃO chamado (engine throws antes)',
  )
  return r
}

async function scenarioC1NoMetadataForSafe(): Promise<ScenarioResult> {
  // Como Safe Capture lança safe-async-reserved antes do upload em B9D,
  // não dá pra testar diretamente "upload Safe sem metadata" via stop().
  // Em vez disso, validamos o profile bundle diretamente:
  //   - manualCaptureProfile.retain.storageMetadataTag presente quando enabled
  //   - safeCaptureProfile.retain.storageMetadataTag undefined
  const r: ScenarioResult = {
    name: 'S9: C1 metadata profile invariants',
    ok: true,
    notes: [],
  }

  const manualRetainOn = getCaptureProfile('manual', { retainAudio: true })
  check(
    r,
    manualRetainOn.retain.storageMetadataTag?.key === 'capture-mode',
    'Manual retain=true: tag key=capture-mode',
  )
  check(
    r,
    manualRetainOn.retain.storageMetadataTag?.value === 'manual',
    'Manual retain=true: tag value=manual',
  )

  const manualRetainOff = getCaptureProfile('manual', { retainAudio: false })
  check(
    r,
    manualRetainOff.retain.enabled === false,
    'Manual retain=false: retain.enabled=false',
  )

  const safe = getCaptureProfile('safe_capture')
  check(
    r,
    safe.retain.storageMetadataTag === undefined,
    'Safe Capture: storageMetadataTag undefined (sem tag Manual)',
  )
  check(
    r,
    safe.retain.ttlDays === 0,
    'Safe Capture: ttlDays=0 (não herda TTL)',
  )
  return r
}

// ─── Runner ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  installFakeBrowserGlobals()

  const scenarios = [
    scenarioManualNoRetain,
    scenarioManualWithRetain,
    scenarioPermissionDenied,
    scenarioTranscribeFailure,
    scenarioUploadFailure,
    // E3 (2026-05-16): novo cenário para policy 'best-effort'.
    scenarioUploadFailureBestEffort,
    scenarioCancelAfterStart,
    scenarioResetClearError,
    scenarioSafeAsyncReserved,
    scenarioC1NoMetadataForSafe,
  ]

  console.log('=== CaptureEngine smoke (E3) ===\n')

  const results: ScenarioResult[] = []
  for (const scenario of scenarios) {
    try {
      const result = await scenario()
      results.push(result)
    } catch (err) {
      results.push({
        name: scenario.name,
        ok: false,
        notes: [
          `✗ scenario throw: ${err instanceof Error ? err.message : String(err)}`,
        ],
      })
    }
  }

  let allOk = true
  for (const result of results) {
    const status = result.ok ? 'PASS' : 'FAIL'
    console.log(`[${status}] ${result.name}`)
    for (const note of result.notes) {
      console.log(`  ${note}`)
    }
    if (!result.ok) allOk = false
  }

  console.log(`\n=== ${allOk ? 'ALL PASS' : 'SOME FAILED'} (${results.length} scenarios) ===`)
  // process só existe em Node — cast indireto evita @types/node dep.
  const proc = (globalThis as unknown as { process?: { exit?: (n: number) => void } })
    .process
  proc?.exit?.(allOk ? 0 : 1)
}

void main()
