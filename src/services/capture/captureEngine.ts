/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B1 (2026-05-15)
 *
 * Interface + tipos do motor de captura unificado. Substitui (a prazo)
 * `useAudioTranscription` (Manual) e `useSafeCaptureMode` (Safe Capture)
 * sob um único engine cujo comportamento é definido por `CaptureProfile`.
 *
 * **Status deste arquivo (B1):** APENAS interface + tipos stub.
 *   - Nenhuma implementação real (todos os métodos lançam UNIMPLEMENTED).
 *   - Nenhum hook consome este engine ainda.
 *   - Safe Capture e Manual continuam usando seus hooks atuais sem mudança.
 *   - Build/typecheck PASS é o único critério desta entrega.
 *
 * Spec completa: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md`
 *
 * Decisões consolidadas que influenciam estes tipos (Gian, 2026-05-15):
 *   D1 — Manual sempre cria `capture_sessions` row
 *   D2 — formato áudio retido: nativo (M4A/WebM); sem WAV downsample
 *   D3 — TTL 30 dias para áudio Manual retido (ver C1)
 *   D4 — pipelines transcribe separados via `transcriptionTrigger`
 *   D5 — Manual sem recovery em refresh (`backgroundContinuation: false`)
 *   D6 — feature flag `useUnifiedCaptureEngine` em localStorage per-device
 *   D7 — mesmo bucket `voice-captures`, mesmo schema de path
 *
 * **C1 (regra obrigatória):** TTL de 30 dias aplica SOMENTE a áudio
 *   Manual. Safe Capture NÃO pode herdar TTL bucket-wide. Implementação
 *   em E5 deve marcar objetos Manual com tag/metadata `capture-mode=manual`
 *   e o lifecycle rule DEVE filtrar por essa tag. Se Supabase Storage não
 *   suportar filtro seguro por tag/metadata, criar cleanup job dedicado
 *   por banco/path/profile — NUNCA regra cega no bucket.
 */

import type { AudioCaptureCapabilities } from '../../utils/platform/audioCaptureCapabilities'
import type { PendingCaptureUploadRecord } from '../mobileLocalCaptureStore'

// ─── Profiles ────────────────────────────────────────────────────────

/**
 * Modo lógico de uso do engine. Determina o profile base mas não
 * substitui o profile — política completa vive em `CaptureProfile`.
 */
export type CaptureMode = 'manual' | 'safe_capture'

/**
 * Quando a transcrição é disparada relativa ao stop().
 * - `after_stop`: síncrono, blob → edge `transcribe` → texto (Manual).
 * - `chunk_or_session`: assíncrono via pipeline `transcribe-chunk` +
 *   `segment-audio-session` (Safe Capture).
 * - `none`: engine não dispara transcrição (caso futuro, ex: gravação
 *   só pra arquivo).
 */
export type TranscriptionTrigger = 'after_stop' | 'chunk_or_session' | 'none'

/**
 * Pré-processador opcional aplicado ao blob entre stop() e transcribe.
 * - `downsample_16k_wav`: comportamento legado do Manual (Web Audio API
 *   re-encode em WAV 16kHz mono). Mantido como opt-in caso o transcribe
 *   precise. Per D2 (formato nativo), default é `native` — não aplicar.
 * - `native`: usar o blob como veio do MediaSource sem re-encode.
 */
export type AudioPreprocessor = 'downsample_16k_wav' | 'native'

/**
 * Policy completa de uma sessão de captura. O engine resolve adapters
 * baseado neste profile + capabilities da plataforma.
 *
 * **Profiles canônicos** ficam em `captureProfiles.ts` (B2+). Aqui é só
 * o shape.
 */
export interface CaptureProfile {
  mode: CaptureMode
  /**
   * Permite gravação continuar com app em background. Implica plugin
   * nativo Capacitor + foreground service Android. Hoje só Safe Capture.
   */
  backgroundContinuation: boolean
  /**
   * Pipeline server-side detecta silêncios e segmenta em sub-notas.
   * Hoje só Safe Capture (`segment-audio-session` edge).
   */
  autoSegmentation: boolean
  /**
   * Sobe o áudio para Supabase Storage e mantém referência na nota.
   * Per D2, formato é nativo. Per D3+C1, áudio Manual com retain tem
   * TTL 30 dias; Safe Capture sem TTL automático.
   */
  retainAudio: boolean
  transcriptionTrigger: TranscriptionTrigger
  /**
   * Cria row em `capture_sessions` mesmo para gravação curta. Per D1,
   * Manual sempre cria (uniformidade com Safe).
   */
  createSession: boolean
  /** Aparece na lista de "notas recentes" da Home. */
  showInRecent: boolean
  /** Pré-processador opcional. Per D2, default `native`. */
  audioPreprocessor?: AudioPreprocessor
}

// ─── Phase machine ───────────────────────────────────────────────────

/**
 * Estado atômico do engine. Substitui as phase machines duplicadas
 * de `useAudioTranscription` e `useSafeCaptureMode`.
 *
 * - `idle`: pronto, sem gravação ativa.
 * - `preparing`: pediu start, ainda configurando MediaSource.
 * - `awaiting_permission`: aguarda usuário em prompt de permissão.
 * - `recording`: gravando.
 * - `finalizing`: stop() chamado, fechando MediaSource e produzindo blob.
 * - `transcribing`: blob enviado para transcrição (síncrono ou async).
 * - `uploading`: subindo áudio para Storage (só se retainAudio=true).
 * - `completed`: ciclo terminou com sucesso, resultado em
 *   `currentResult`.
 * - `error`: ciclo terminou com falha; `error` field populado.
 */
export type CapturePhaseStatus =
  | 'idle'
  | 'preparing'
  | 'awaiting_permission'
  | 'recording'
  | 'finalizing'
  | 'transcribing'
  | 'uploading'
  | 'completed'
  | 'error'

export interface CapturePhase {
  status: CapturePhaseStatus
  /** Detalhe legível (i18n key) para UX. */
  detail?: string
}

// ─── Result ──────────────────────────────────────────────────────────

/**
 * Resultado de um ciclo completo de captura (start → stop → finalize).
 */
export interface CaptureResult {
  /** Row id em `capture_sessions`. `null` se profile `createSession=false`. */
  sessionId: string | null
  /**
   * Path no bucket `voice-captures`. `null` se `retainAudio=false`.
   * Per D7: `{userId}/sessions/{sessionId}/chunks/{chunkId}.{ext}`.
   */
  audioStoragePath: string | null
  /** Texto transcrito. Vazio se `transcriptionTrigger='none'`. */
  transcript: string
  /**
   * Blob bruto disponível imediatamente após stop().
   * - Em profiles com `retainAudio=false` é descartado pelo engine
   *   depois que `transcript` for emitido.
   * - Em profiles com `retainAudio=true` o engine sobe para Storage
   *   e zera esta ref para liberar memória.
   * NÃO confiar nesta ref persistir entre re-renders.
   */
  rawBlob?: Blob
  /** Duração estimada em milissegundos. */
  durationMs: number
  /** Formato detectado/forçado pelo MediaSource. */
  format: 'wav' | 'webm' | 'opus' | 'm4a' | 'mp4'
}

// ─── Permission + availability ───────────────────────────────────────

/**
 * Estado de permissão do microfone. Espelha valores comuns de
 * navigator.permissions API + Capacitor.
 */
export type CapturePermission = 'granted' | 'denied' | 'prompt' | 'unavailable'

/**
 * Disponibilidade efetiva da captura — mais granular que `permission`,
 * porque considera contexto (foreground required, interrupted, etc).
 */
export type CaptureAvailability =
  | 'available'
  | 'permission-required'
  | 'permission-denied'
  | 'foreground-required'
  | 'interrupted'
  | 'unavailable'

// ─── Engine state ────────────────────────────────────────────────────

/**
 * Snapshot atômico do engine. UX consome este shape.
 */
export interface CaptureEngineState {
  phase: CapturePhase
  permission: CapturePermission
  availability: CaptureAvailability
  /** Motivo da última interrupção, se houver. */
  interruptionReason: string | null
  /** Capabilities detectadas para a plataforma corrente. */
  capabilities: AudioCaptureCapabilities | null
  /** Erro atual (i18n string ou raw — UX decide). `null` quando ok. */
  error: string | null
  /**
   * Uploads pendentes (Safe Capture com retainAudio). Vazio para
   * Manual per D5 (sem recovery).
   */
  pendingUploads: PendingCaptureUploadRecord[]
  /** Resultado do último ciclo completo. `null` antes do primeiro. */
  currentResult: CaptureResult | null
}

// ─── Engine interface ────────────────────────────────────────────────

/**
 * Contrato do motor unificado.
 *
 * **Esta interface ainda NÃO tem implementação.** O hook `useCaptureEngine`
 * será criado em B2/B3 com fábrica + reducer; consumo pelos componentes
 * acontece em E1+ sob feature flag `useUnifiedCaptureEngine`.
 *
 * Todos os métodos retornam Promise (mesmo `reset`/`clearError` ficam
 * Promise pra suportar implementações que precisem flush async — o
 * reducer pode resolver síncrono se preferir).
 */
export interface CaptureEngine {
  /** Snapshot reativo do estado do engine. */
  state: CaptureEngineState

  /**
   * Inicia gravação com o profile dado. Idempotente se já está em
   * `recording` com o MESMO profile; reject se profile diferente.
   *
   * Sequência interna esperada:
   *   1. Validate profile + check capabilities.
   *   2. Request/check permission. Transition `awaiting_permission` se prompt.
   *   3. If `createSession=true`: criar row em `capture_sessions`.
   *   4. Initialize MediaSource adapter (Web/Capacitor) baseado em
   *      profile + capabilities.
   *   5. Start recording. Phase = `recording`.
   */
  start(profile: CaptureProfile): Promise<void>

  /**
   * Para gravação. Resolve com `CaptureResult` quando finalização
   * (incluindo transcrição síncrona e/ou upload, se profile pede)
   * terminar.
   *
   * Para profiles com `transcriptionTrigger='chunk_or_session'`, a
   * transcrição pode continuar após stop() — `result.transcript` pode
   * vir vazio e ser populado depois via outro mecanismo (TBD em E3+).
   */
  stop(): Promise<CaptureResult>

  /**
   * Cancela gravação corrente. Descarta blob. NÃO sobe áudio. NÃO
   * transcreve. NÃO marca sessão como completa (apenas como cancelled
   * se já havia row).
   */
  cancel(): Promise<void>

  /**
   * Retry de uploads pendentes (Safe Capture). Para Manual, sempre
   * resolve sem ação (per D5).
   */
  retryPendingUpload(sessionId?: string): Promise<void>

  /** Reseta state machine sem mexer em sessões persistidas. */
  reset(): Promise<void>

  clearError(): Promise<void>
}

// ─── Stub factory (B1: throws UNIMPLEMENTED) ─────────────────────────

/**
 * Marca de stub para o engine antes da implementação real. Útil pra
 * testes de tipos e pra detectar consumidores acidentais durante o
 * BREAK. Será removido em B2/B3 quando a implementação real existir.
 */
export class CaptureEngineUnimplementedError extends Error {
  constructor(method: string) {
    super(`CaptureEngine.${method} is not implemented yet (BREAK B1 stub).`)
    this.name = 'CaptureEngineUnimplementedError'
  }
}

/**
 * Fábrica stub. Retorna um engine que rejeita todas as operações.
 * Nenhum código de produção deve consumir este factory em B1 — está
 * aqui apenas para validar tipos e servir como esqueleto.
 */
export function createCaptureEngineStub(): CaptureEngine {
  const initialState: CaptureEngineState = {
    phase: { status: 'idle' },
    permission: 'unavailable',
    availability: 'unavailable',
    interruptionReason: null,
    capabilities: null,
    error: null,
    pendingUploads: [],
    currentResult: null,
  }

  return {
    state: initialState,
    start: async () => {
      throw new CaptureEngineUnimplementedError('start')
    },
    stop: async () => {
      throw new CaptureEngineUnimplementedError('stop')
    },
    cancel: async () => {
      throw new CaptureEngineUnimplementedError('cancel')
    },
    retryPendingUpload: async () => {
      throw new CaptureEngineUnimplementedError('retryPendingUpload')
    },
    reset: async () => {
      throw new CaptureEngineUnimplementedError('reset')
    },
    clearError: async () => {
      throw new CaptureEngineUnimplementedError('clearError')
    },
  }
}
