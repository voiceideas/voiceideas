/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B7 (2026-05-15)
 *
 * Phase/state machine pura do CaptureEngine. Reducer sem side-effects,
 * com tabela explícita de transições válidas, eventos tipados e Result
 * controlado para transições inválidas (não throw — engine pode logar
 * e continuar).
 *
 * **Status (B7):** APENAS lógica pura.
 *   - Não importa adapters reais (só tipos de `captureEngine.ts`).
 *   - Não executa side-effects (rede, mic, storage).
 *   - Não consumido por hooks/components em B7.
 *
 * **Por que reducer puro?**
 *   Permite testes determinísticos da máquina de estados sem mockar
 *   browser APIs, e isola a lógica de transição de quaisquer detalhes
 *   de execução (que vivem nos adapters).
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §4 BREAK B5+
 * (originalmente "phase machine reducer", deferido em 4.43-4.46
 * para depois da factory).
 */

import type { CapturePhase, CapturePhaseStatus } from './captureEngine'

// ─── Eventos ─────────────────────────────────────────────────────────

/**
 * União discriminada de eventos que disparam transições.
 *
 * Convenção: nomes em UPPER_SNAKE_CASE para destacar que são "intents"
 * lógicos (não chamadas de método). O engine (B8+) mapeia ações reais
 * (start/stop/etc) e callbacks dos adapters para esses eventos antes
 * de chamar o reducer.
 */
export type CaptureEvent =
  | { type: 'START_REQUESTED' }
  | { type: 'PERMISSION_PROMPTED' }
  | { type: 'PERMISSION_GRANTED' }
  | { type: 'PERMISSION_DENIED'; reason?: string }
  | { type: 'RECORDING_STARTED' }
  | { type: 'STOP_REQUESTED' }
  /**
   * Blob produzido pelo MediaSource adapter. `nextStep` indica para
   * onde a máquina deve transitar baseado no profile:
   *   - 'transcribe': profile.transcriptionTrigger !== 'none'
   *   - 'upload': profile.transcriptionTrigger === 'none' && retainAudio
   *   - 'complete': nem transcribe nem retain (descartar)
   */
  | { type: 'BLOB_READY'; nextStep: 'transcribe' | 'upload' | 'complete' }
  /**
   * Transcrição concluiu. `nextStep`:
   *   - 'upload': profile.retainAudio === true
   *   - 'complete': profile.retainAudio === false
   */
  | { type: 'TRANSCRIPTION_COMPLETE'; nextStep: 'upload' | 'complete' }
  | { type: 'UPLOAD_COMPLETE' }
  | { type: 'ERROR_OCCURRED'; message: string }
  | { type: 'CANCEL_REQUESTED' }
  | { type: 'RESET' }
  | { type: 'CLEAR_ERROR' }

export type CaptureEventType = CaptureEvent['type']

// ─── Resultado da transição ──────────────────────────────────────────

export interface CaptureTransitionInvalid {
  ok: false
  error: 'invalid-transition'
  from: CapturePhaseStatus
  eventType: CaptureEventType
  /** Estado mantido inalterado quando inválido. */
  unchanged: CapturePhase
}

export interface CaptureTransitionApplied {
  ok: true
  next: CapturePhase
}

export type CaptureTransitionResult =
  | CaptureTransitionApplied
  | CaptureTransitionInvalid

// ─── Tabela de transições (data, não código) ─────────────────────────

/**
 * Próximo `status` resolvido a partir de `(from, event)`. Funções
 * inline permitem resolver branch baseado em payload (ex: BLOB_READY
 * com `nextStep`).
 *
 * `null` no slot = transição inválida nesse par.
 */
type TransitionResolver = (event: CaptureEvent) => CapturePhaseStatus | null

const ALWAYS_RESET: TransitionResolver = () => 'idle'
const ALWAYS_ERROR: TransitionResolver = () => 'error'

function resolveBlobReady(event: CaptureEvent): CapturePhaseStatus | null {
  if (event.type !== 'BLOB_READY') return null
  switch (event.nextStep) {
    case 'transcribe':
      return 'transcribing'
    case 'upload':
      return 'uploading'
    case 'complete':
      return 'completed'
  }
}

function resolveTranscriptionComplete(
  event: CaptureEvent,
): CapturePhaseStatus | null {
  if (event.type !== 'TRANSCRIPTION_COMPLETE') return null
  return event.nextStep === 'upload' ? 'uploading' : 'completed'
}

/**
 * Tabela completa de transições válidas. Slots ausentes = inválido.
 *
 * Coluna = `from` status. Linha = `event.type`. Valor = `TransitionResolver`.
 */
const TRANSITIONS: Record<
  CapturePhaseStatus,
  Partial<Record<CaptureEventType, TransitionResolver>>
> = {
  idle: {
    START_REQUESTED: () => 'preparing',
    CANCEL_REQUESTED: () => 'idle',
    RESET: ALWAYS_RESET,
    ERROR_OCCURRED: ALWAYS_ERROR,
    CLEAR_ERROR: () => 'idle',
  },
  preparing: {
    PERMISSION_PROMPTED: () => 'awaiting_permission',
    PERMISSION_GRANTED: () => 'preparing',
    RECORDING_STARTED: () => 'recording',
    CANCEL_REQUESTED: () => 'idle',
    RESET: ALWAYS_RESET,
    ERROR_OCCURRED: ALWAYS_ERROR,
  },
  awaiting_permission: {
    PERMISSION_GRANTED: () => 'preparing',
    PERMISSION_DENIED: ALWAYS_ERROR,
    CANCEL_REQUESTED: () => 'idle',
    RESET: ALWAYS_RESET,
    ERROR_OCCURRED: ALWAYS_ERROR,
  },
  recording: {
    STOP_REQUESTED: () => 'finalizing',
    PERMISSION_GRANTED: () => 'recording',
    CANCEL_REQUESTED: () => 'idle',
    RESET: ALWAYS_RESET,
    ERROR_OCCURRED: ALWAYS_ERROR,
  },
  finalizing: {
    BLOB_READY: resolveBlobReady,
    CANCEL_REQUESTED: () => 'idle',
    RESET: ALWAYS_RESET,
    ERROR_OCCURRED: ALWAYS_ERROR,
  },
  transcribing: {
    TRANSCRIPTION_COMPLETE: resolveTranscriptionComplete,
    CANCEL_REQUESTED: () => 'idle',
    RESET: ALWAYS_RESET,
    ERROR_OCCURRED: ALWAYS_ERROR,
  },
  uploading: {
    UPLOAD_COMPLETE: () => 'completed',
    CANCEL_REQUESTED: () => 'idle',
    RESET: ALWAYS_RESET,
    ERROR_OCCURRED: ALWAYS_ERROR,
  },
  completed: {
    START_REQUESTED: () => 'preparing',
    RESET: ALWAYS_RESET,
    CLEAR_ERROR: () => 'completed',
  },
  error: {
    START_REQUESTED: () => 'preparing',
    RESET: ALWAYS_RESET,
    CLEAR_ERROR: () => 'idle',
  },
}

// ─── Reducer ─────────────────────────────────────────────────────────

/**
 * Aplica um evento ao estado atual. Retorna `CaptureTransitionResult`:
 *   - `{ ok: true, next }` se transição válida.
 *   - `{ ok: false, error: 'invalid-transition', from, eventType, unchanged }`
 *     se inválida (engine pode logar para diagnóstico mas mantém estado).
 *
 * Pure function — não muta state nem produz side-effects.
 */
export function applyCaptureEvent(
  state: CapturePhase,
  event: CaptureEvent,
): CaptureTransitionResult {
  const resolver = TRANSITIONS[state.status]?.[event.type]
  if (!resolver) {
    return {
      ok: false,
      error: 'invalid-transition',
      from: state.status,
      eventType: event.type,
      unchanged: state,
    }
  }

  const nextStatus = resolver(event)
  if (nextStatus === null) {
    return {
      ok: false,
      error: 'invalid-transition',
      from: state.status,
      eventType: event.type,
      unchanged: state,
    }
  }

  const detail =
    event.type === 'PERMISSION_DENIED'
      ? event.reason ?? null
      : event.type === 'ERROR_OCCURRED'
        ? event.message
        : null

  return {
    ok: true,
    next: {
      status: nextStatus,
      ...(detail !== null ? { detail } : {}),
    },
  }
}

/**
 * Variante "reducer estilo Redux/useReducer" — retorna o próximo state
 * (mantém o anterior se inválido). Útil para integração com
 * `useReducer` futuro do hook.
 */
export function capturePhaseReducer(
  state: CapturePhase,
  event: CaptureEvent,
): CapturePhase {
  const result = applyCaptureEvent(state, event)
  return result.ok ? result.next : result.unchanged
}

// ─── Helpers ─────────────────────────────────────────────────────────

const TERMINAL_STATUSES: ReadonlySet<CapturePhaseStatus> = new Set([
  'completed',
  'error',
])

const ACTIVE_STATUSES: ReadonlySet<CapturePhaseStatus> = new Set([
  'preparing',
  'awaiting_permission',
  'recording',
  'finalizing',
  'transcribing',
  'uploading',
])

/** True se o ciclo terminou (completed ou error). */
export function isCaptureTerminal(phase: CapturePhase): boolean {
  return TERMINAL_STATUSES.has(phase.status)
}

/** True se há um ciclo em andamento (não idle nem terminal). */
export function isCaptureActive(phase: CapturePhase): boolean {
  return ACTIVE_STATUSES.has(phase.status)
}

/** True se o engine está pronto para aceitar START_REQUESTED. */
export function canCaptureStart(phase: CapturePhase): boolean {
  return phase.status === 'idle' || isCaptureTerminal(phase)
}

/** True se o engine está gravando (record-in-progress). */
export function isCaptureRecording(phase: CapturePhase): boolean {
  return phase.status === 'recording'
}

/** Phase inicial canônica (idle). Útil em factories/reducers. */
export const INITIAL_CAPTURE_PHASE: CapturePhase = { status: 'idle' }
