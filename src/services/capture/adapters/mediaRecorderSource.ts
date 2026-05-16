/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B2 (2026-05-15)
 *
 * `MediaRecorderSource` — adapter de fonte de áudio baseado na Web
 * MediaRecorder API. Usado por Safe Capture quando a plataforma é
 * web/desktop (não-Capacitor). Em B3+ vai consolidar a lógica que
 * hoje vive em `useSafeCaptureMode` (chunks via MediaRecorder, MIME
 * negotiation opus/webm/mp4).
 *
 * Para Capacitor nativo (iOS/Android com plugin), o source análogo
 * será `CapacitorPluginSource` — arquivo separado em B3.
 *
 * Para Manual no browser (downsample WAV via Web Audio API), ver
 * `webAudioSource.ts`.
 *
 * **Status (B2):** APENAS interface + stub que lança erro.
 *   - Nenhum hook consome.
 *   - Não inicia captura real.
 *   - `useSafeCaptureMode` permanece intocado.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §2 (adapter chain).
 */

import type { CaptureProfile, CaptureResult } from '../captureEngine'

/**
 * Resultado de um ciclo de captura no nível do source (antes do engine
 * orquestrar persist/transcribe/upload).
 */
export interface MediaSourceResult {
  /** Blob bruto produzido pelo source. */
  blob: Blob
  /** Formato detectado pelo MediaRecorder (depende de MIME negotiation). */
  format: CaptureResult['format']
  /** Duração estimada em milissegundos. */
  durationMs: number
  /**
   * Chunks intermediários se o source operou em modo segmentado.
   * Vazio para sources que produzem só um blob final.
   */
  chunks: ReadonlyArray<MediaSourceChunk>
}

/**
 * Fragmento de áudio produzido durante a gravação. Sources com
 * `MediaRecorder.start(timeslice)` emitem múltiplos chunks; sources
 * que produzem blob único reportam um único chunk equivalente ao
 * blob final.
 */
export interface MediaSourceChunk {
  id: string
  blob: Blob
  /** Sequência monotônica (0-indexed) na sessão. */
  sequence: number
  /** Timestamp relativo ao start() em ms. */
  startedAtMs: number
}

/**
 * Lifecycle comum a TODOS os sources (MediaRecorder, WebAudio,
 * CapacitorPlugin). Cada implementação preenche os métodos de acordo
 * com sua API nativa, mas a forma é a mesma.
 */
export interface MediaSourceLifecycle {
  /**
   * Configura e inicia gravação. O profile dita comportamento (chunks
   * vs blob único, formato preferido). Idempotente se já recording
   * com mesmo profile; reject se profile diferente.
   */
  start(profile: CaptureProfile): Promise<void>
  /** Para gravação e finaliza blob/chunks. */
  stop(): Promise<MediaSourceResult>
  /** Cancela gravação em andamento. Descarta blob. NÃO emite resultado. */
  cancel(): Promise<void>
  /** Indica se há gravação corrente. */
  readonly isRecording: boolean
}

/**
 * Source baseado em Web MediaRecorder API.
 * Usado por Safe Capture web/desktop quando plugin nativo não disponível.
 */
export interface MediaRecorderSource extends MediaSourceLifecycle {
  readonly kind: 'media-recorder'
}

/**
 * Erro lançado por stubs B2.
 */
export class MediaRecorderSourceUnimplementedError extends Error {
  constructor(method: string) {
    super(`MediaRecorderSource.${method} is not implemented yet (BREAK B2 stub).`)
    this.name = 'MediaRecorderSourceUnimplementedError'
  }
}

/**
 * Stub factory. Retorna source cujos métodos lançam erro. Não consome
 * MediaStream nem inicia gravação. Apenas para validação de tipos.
 *
 * **Não consumir em produção em B2.** Implementação real em B3+.
 */
export function createMediaRecorderSourceStub(): MediaRecorderSource {
  return {
    kind: 'media-recorder',
    isRecording: false,
    start: async () => {
      throw new MediaRecorderSourceUnimplementedError('start')
    },
    stop: async () => {
      throw new MediaRecorderSourceUnimplementedError('stop')
    },
    cancel: async () => {
      throw new MediaRecorderSourceUnimplementedError('cancel')
    },
  }
}
