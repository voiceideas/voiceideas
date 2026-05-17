/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B9A (2026-05-16)
 *
 * Contrato neutro para transcrição. Define como o CaptureEngine envia
 * blob/chunks para edge functions de transcrição.
 *
 * **Status (B9A):** APENAS interface + stub. Nenhuma chamada real às
 * edges. Nenhum hook consome.
 *
 * **Regras refletidas (D4):**
 *   - **D4 — pipelines separados via profile:**
 *     * `transcriptionTrigger: 'after_stop'` (Manual) → adapter usa
 *       `transcribe()` síncrono. Internamente chama edge `transcribe`
 *       stateless (mesma rota atual do Manual).
 *     * `transcriptionTrigger: 'chunk_or_session'` (Safe Capture) →
 *       adapter usa `transcribeChunkAsync()` ou
 *       `transcribeSessionAsync()` (pipeline assíncrono com
 *       `transcribe-chunk` + `segment-audio-session`).
 *     * `transcriptionTrigger: 'none'` → engine não chama adapter.
 *
 * **Limites B9A:**
 *   - Não chama edge `transcribe`/`transcribe-chunk`.
 *   - Stub throws.
 *   - Não toca `src/lib/transcribe.ts` (legado consumido por
 *     `useAudioTranscription`) — implementação real (B9B+) pode
 *     reusar internamente.
 *   - `transcribeChunkAsync`/`transcribeSessionAsync` ficam reservados
 *     como contrato — não consumidos em B8 (engine vai direto pra
 *     `completed` sem transcribe).
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §4 EXECUTE + §7 D4.
 */

import type { CaptureResult } from './captureEngine'
import type { TranscriptionMode, TranscriptionTrigger } from './captureEngine'

// ─── Sync transcribe (Manual after_stop) ─────────────────────────────

export interface CaptureTranscriptionInput {
  /** Blob produzido pelo MediaSource. */
  blob: Blob
  /** Format hint para edge function (algumas variants ajudam Whisper). */
  format: CaptureResult['format']
  /**
   * Idioma preferido. Default 'pt' para alinhar com o comportamento
   * atual do edge `transcribe` consumido por Manual.
   */
  language?: string
  /**
   * Trigger declarado pelo profile. Adapter usa para escolher edge
   * (sync `transcribe` vs async `transcribe-chunk`). Engine sempre
   * passa o trigger do profile efetivo.
   */
  trigger: TranscriptionTrigger
  /**
   * VI_MANUAL_TRANSCRIPTION_VERBATIM_MODE (2026-05-17). Política de
   * fidelidade. `'verbatim'` → adapter envia `transcription_mode=verbatim`
   * ao edge function (Whisper recebe prompt restritivo) e
   * `sanitizeTranscript` preserva repetições no client. `'natural'` ou
   * undefined → comportamento legado.
   */
  mode?: TranscriptionMode
}

export interface CaptureTranscriptionResult {
  text: string
  language: string
  /** Tempo de processamento server-side (se reportado pela edge). */
  durationMs: number | null
  /** Caminho usado (audit). */
  source: 'transcribe-sync' | 'transcribe-chunk-async'
}

// ─── Async pipeline (Safe Capture chunk_or_session) ──────────────────

/**
 * Input para enfileirar um chunk no pipeline assíncrono. Usado quando
 * `profile.transcriptionTrigger === 'chunk_or_session'` e o source
 * emitiu chunks intermediários durante a gravação.
 */
export interface ChunkTranscriptionInput {
  sessionId: string
  chunkId: string
  /** Path no Storage (já uploadado). */
  storagePath: string
  /** Bucket onde o objeto está. */
  bucket: string
  /** Sequência ordinal na sessão. */
  sequence: number
}

/**
 * Ticket retornado pelo enfileiramento. Permite consumer polar status
 * ou correlacionar callbacks futuros. Conteúdo final do transcript
 * vem por outro caminho (DB poll, realtime subscription, ou Edge
 * function que avisa o cliente).
 */
export interface ChunkTranscriptionTicket {
  sessionId: string
  chunkId: string
  enqueuedAt: string
}

/**
 * Input para disparar transcrição agregada da sessão inteira (após
 * `segment-audio-session` rodar e gerar segmentos finais).
 */
export interface SessionTranscriptionInput {
  sessionId: string
  /** Bucket onde os chunks vivem. */
  bucket: string
}

export interface SessionTranscriptionTicket {
  sessionId: string
  enqueuedAt: string
}

// ─── Errors ──────────────────────────────────────────────────────────

export type CaptureTranscriptionErrorCode =
  | 'unsupported'
  | 'invalid-trigger'
  | 'transcribe-failed'
  | 'network-error'
  | 'quota-exceeded'
  | 'too-large'

export class CaptureTranscriptionError extends Error {
  readonly code: CaptureTranscriptionErrorCode
  constructor(code: CaptureTranscriptionErrorCode, message: string) {
    super(`CaptureTranscription[${code}]: ${message}`)
    this.name = 'CaptureTranscriptionError'
    this.code = code
  }
}

export class CaptureTranscriptionUnimplementedError extends Error {
  constructor(method: string) {
    super(
      `CaptureTranscription.${method} is not implemented yet (BREAK B9A stub).`,
    )
    this.name = 'CaptureTranscriptionUnimplementedError'
  }
}

// ─── Contrato ────────────────────────────────────────────────────────

/**
 * Contrato consumido pelo engine quando o profile pede transcrição.
 *
 * Dois caminhos (D4):
 *   - Síncrono (`transcribe`) — Manual, retorna texto no resolve.
 *   - Assíncrono (`transcribeChunkAsync` + `transcribeSessionAsync`)
 *     — Safe Capture, retorna ticket; texto chega via outro canal.
 */
export interface CaptureTranscription {
  transcribe(
    input: CaptureTranscriptionInput,
  ): Promise<CaptureTranscriptionResult>
  /** Enfileira chunk no pipeline async (Safe Capture). */
  transcribeChunkAsync(
    input: ChunkTranscriptionInput,
  ): Promise<ChunkTranscriptionTicket>
  /** Dispara segmentação + transcribe agregado da sessão (Safe Capture). */
  transcribeSessionAsync(
    input: SessionTranscriptionInput,
  ): Promise<SessionTranscriptionTicket>
}

/**
 * Stub factory. Todos os métodos throw. NÃO consumir em produção
 * em B9A.
 */
export function createCaptureTranscriptionStub(): CaptureTranscription {
  return {
    transcribe: async () => {
      throw new CaptureTranscriptionUnimplementedError('transcribe')
    },
    transcribeChunkAsync: async () => {
      throw new CaptureTranscriptionUnimplementedError('transcribeChunkAsync')
    },
    transcribeSessionAsync: async () => {
      throw new CaptureTranscriptionUnimplementedError('transcribeSessionAsync')
    },
  }
}

/**
 * Helper interno: classifica trigger em "sync" vs "async pipeline".
 * Usado pelo engine para escolher qual método do adapter chamar.
 */
export function classifyTranscriptionTrigger(
  trigger: TranscriptionTrigger,
): 'sync' | 'async' | 'none' {
  if (trigger === 'after_stop') return 'sync'
  if (trigger === 'chunk_or_session') return 'async'
  return 'none'
}
