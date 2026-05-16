/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B9B (2026-05-16)
 *
 * Implementação real de `CaptureTranscription`:
 *   - **Sync (`transcribe`):** delega para `transcribeAudio()` em
 *     `src/lib/transcribe.ts` (mesma rota que o Manual usa hoje).
 *     Não modifica o módulo legado — apenas importa e chama.
 *   - **Async (`transcribeChunkAsync` + `transcribeSessionAsync`):**
 *     contratos reservados para Safe Capture pipeline. NÃO implementados
 *     em B9B — adapter throws com `unsupported`. Engine B8 não
 *     consome esses métodos (Manual usa só sync).
 *
 * **Status (B9B):** adapter real instanciável para o caminho sync.
 * NÃO consumido pelo engine B8 nem por hooks. Existe lado a lado
 * com o stub B9A.
 *
 * **Limites B9B:**
 *   - `transcribeChunkAsync`/`transcribeSessionAsync` throw
 *     `CaptureTranscriptionError('unsupported', ...)`. Implementação
 *     real exige integrar pipeline `transcribe-chunk` +
 *     `segment-audio-session` — fora de escopo B9B.
 *   - `useAudioTranscription` continua usando seu próprio caminho;
 *     este adapter só reaproveita a função `transcribeAudio` (módulo
 *     legado intocado).
 *   - Engine não chama transcribe em B8 — engine vai direto pra
 *     completed após stop().
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §4 EXECUTE + §7 D4.
 */

import { transcribeAudio } from '../../lib/transcribe'
import type {
  CaptureTranscription,
  CaptureTranscriptionInput,
  CaptureTranscriptionResult,
  ChunkTranscriptionTicket,
  SessionTranscriptionTicket,
} from './captureTranscription'
import { CaptureTranscriptionError } from './captureTranscription'

const DEFAULT_LANGUAGE = 'pt'

/**
 * Cria implementação real de `CaptureTranscription`. Em B9B NÃO é
 * consumida por nenhum hook ou pelo engine B8.
 */
export function createCaptureTranscriptionAdapter(): CaptureTranscription {
  return {
    async transcribe(
      input: CaptureTranscriptionInput,
    ): Promise<CaptureTranscriptionResult> {
      if (input.trigger !== 'after_stop') {
        throw new CaptureTranscriptionError(
          'invalid-trigger',
          `transcribe() called with trigger=${input.trigger}; expected 'after_stop'.`,
        )
      }

      if (!input.blob || input.blob.size === 0) {
        throw new CaptureTranscriptionError(
          'transcribe-failed',
          'Blob vazio ou ausente.',
        )
      }

      const startedAt = Date.now()
      let text: string
      try {
        // transcribeAudio (módulo legado src/lib/transcribe.ts) faz:
        //   - normaliza blob (downsample WAV se necessário)
        //   - POST FormData ao edge function `transcribe`
        //   - retorna texto sanitizado
        // Usa idioma fixo 'pt' internamente — input.language ignorado
        // pelo legado. B9C+ pode ampliar a função se necessário.
        text = await transcribeAudio(input.blob)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'transcribe failed'
        // Mapear classes conhecidas de erro do legado em códigos tipados.
        if (/10 MB|grande demais/i.test(message)) {
          throw new CaptureTranscriptionError('too-large', message)
        }
        if (/sessao expirou|401/i.test(message)) {
          throw new CaptureTranscriptionError('quota-exceeded', message)
        }
        if (/conexao|network|fetch/i.test(message)) {
          throw new CaptureTranscriptionError('network-error', message)
        }
        throw new CaptureTranscriptionError('transcribe-failed', message)
      }

      return {
        text,
        language: input.language ?? DEFAULT_LANGUAGE,
        durationMs: Date.now() - startedAt,
        source: 'transcribe-sync',
      }
    },

    // Async pipeline NÃO implementado em B9B — engine B8 não consome.
    // Tipo da interface CaptureTranscription contém os params; aqui
    // omitimos para evitar lint no-unused (projeto enforce strict).
    async transcribeChunkAsync(): Promise<ChunkTranscriptionTicket> {
      throw new CaptureTranscriptionError(
        'unsupported',
        'transcribeChunkAsync not implemented in B9B (Safe Capture pipeline reserved for later).',
      )
    },

    async transcribeSessionAsync(): Promise<SessionTranscriptionTicket> {
      throw new CaptureTranscriptionError(
        'unsupported',
        'transcribeSessionAsync not implemented in B9B (Safe Capture pipeline reserved for later).',
      )
    },
  }
}
