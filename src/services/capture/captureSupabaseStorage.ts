/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B9B (2026-05-16)
 *
 * Implementação real de `CaptureStorage` usando Supabase Storage.
 * Reusa MESMO bucket `voice-captures` e MESMO schema de path do
 * `audioChunkService`/`captureSessionService` (D7).
 *
 * **Status (B9B):** adapter real instanciável. NÃO consumido pelo
 * engine B8 nem por hooks. Existe lado a lado com o stub B9A.
 *
 * **C1 — REGRA OBRIGATÓRIA:** quando `metadataTag` está presente no
 * input (Manual+retainAudio=true), o adapter passa `metadata` no
 * upload. Lifecycle/cleanup futuro (B9C+ ou ciclo dedicado) DEVE
 * filtrar por essa tag antes de deletar — política externa.
 *
 * **Limites B9B:**
 *   - Não toca `audioChunkService` (serviço legado existente).
 *     Implementação aqui usa diretamente `supabase.storage` para
 *     evitar acoplamento.
 *   - Não aplica TTL/lifecycle (per guardrail).
 *   - `metadata` é passado via FileOptions do supabase-js. Se a versão
 *     instalada não suportar (TypeScript reclamar), fallback documentado
 *     como issue para B9C.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §4 EXECUTE (E5) + §7 C1.
 */

import { supabase } from '../../lib/supabase'
import { createAppError } from '../../lib/errors'
import type {
  CaptureStorage,
  CaptureStorageDeleteInput,
  CaptureStorageUploadInput,
  CaptureStorageUploadResult,
} from './captureStorage'
import {
  CaptureStorageError,
  captureFormatToExtension,
  resolveCaptureStoragePath,
} from './captureStorage'

// ─── Helpers ─────────────────────────────────────────────────────────

function generateChunkId(): string {
  // Usa crypto.randomUUID quando disponível; fallback para timestamp+rand.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `chunk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function blobMimeType(blob: Blob): string | undefined {
  return blob.type ? blob.type : undefined
}

// Subset de FileOptions que usamos. Tipado localmente para que mudanças
// na lib supabase-js sejam contidas (contrato mínimo necessário).
interface SupabaseUploadOptions {
  upsert?: boolean
  contentType?: string
  cacheControl?: string
  metadata?: Record<string, string>
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Cria implementação real de `CaptureStorage` usando Supabase Storage.
 * Em B9B NÃO é consumida por nenhum hook ou pelo engine B8.
 */
export function createSupabaseCaptureStorage(): CaptureStorage {
  return {
    async uploadAudio(
      input: CaptureStorageUploadInput,
    ): Promise<CaptureStorageUploadResult> {
      if (!input.bucket) {
        throw new CaptureStorageError(
          'invalid-input',
          'bucket é obrigatório no upload.',
        )
      }
      if (!input.userId) {
        throw new CaptureStorageError(
          'invalid-input',
          'userId é obrigatório no upload (resolver via supabase.auth antes).',
        )
      }
      if (!input.sessionId) {
        throw new CaptureStorageError(
          'invalid-input',
          'sessionId é obrigatório.',
        )
      }
      if (!input.blob || input.blob.size === 0) {
        throw new CaptureStorageError(
          'invalid-input',
          'blob vazio ou ausente.',
        )
      }

      const chunkId = input.chunkId ?? generateChunkId()
      const ext = captureFormatToExtension(input.format)
      const storagePath = resolveCaptureStoragePath(input.pathTemplate, {
        userId: input.userId,
        sessionId: input.sessionId,
        chunkId,
        ext,
      })

      const uploadOptions: SupabaseUploadOptions = {
        upsert: true,
        contentType: blobMimeType(input.blob),
      }

      // C1: metadata tag obrigatória quando Manual+retainAudio=true.
      // Engine real (B9C+) deve garantir que metadataTag seja passado
      // nesse cenário. Aqui, se vier, propagamos.
      if (input.metadataTag) {
        uploadOptions.metadata = {
          [input.metadataTag.key]: input.metadataTag.value,
        }
      }

      const { error } = await supabase.storage
        .from(input.bucket)
        .upload(storagePath, input.blob, uploadOptions)

      if (error) {
        throw new CaptureStorageError(
          'upload-failed',
          await formatErrorMessage(error, 'Falha ao subir áudio para Storage.'),
        )
      }

      return {
        bucket: input.bucket,
        storagePath,
        chunkId,
        bytes: input.blob.size,
        uploadedAt: new Date().toISOString(),
      }
    },

    async deleteAudio(input: CaptureStorageDeleteInput): Promise<void> {
      if (!input.bucket || !input.storagePath) {
        throw new CaptureStorageError(
          'invalid-input',
          'bucket e storagePath são obrigatórios para delete.',
        )
      }

      const { error } = await supabase.storage
        .from(input.bucket)
        .remove([input.storagePath])

      if (error) {
        throw new CaptureStorageError(
          'delete-failed',
          await formatErrorMessage(error, 'Falha ao deletar áudio do Storage.'),
        )
      }
    },
  }
}

async function formatErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  try {
    const appError = await createAppError(error, fallback)
    return appError.message ?? fallback
  } catch {
    return fallback
  }
}
