/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B9A (2026-05-16)
 *
 * Contrato neutro para upload de áudio no Storage. Define como o
 * CaptureEngine sobe o blob produzido pelo source para o bucket
 * compartilhado `voice-captures`, com metadata/tag obrigatória C1
 * quando é áudio Manual retido.
 *
 * **Status (B9A):** APENAS interface + stub. Nenhuma chamada real a
 * Supabase Storage. Nenhum hook consome.
 *
 * **Regras refletidas (D2, D3, D7, C1):**
 *   - D2: formato nativo — engine passa o `format` que o source
 *     produziu (m4a/webm/opus/wav). Adapter real (B9B+) NÃO faz
 *     re-encoding.
 *   - D3+C1 obrigatório: quando Manual+retainAudio=true, engine DEVE
 *     passar `metadataTag = { key: 'capture-mode', value: 'manual' }`.
 *     Implementação real (B9B+) DEVE escrever essa tag no Storage
 *     (via `x-amz-meta-*` ou metadata Supabase) para o lifecycle/
 *     cleanup futuro filtrar.
 *   - D7: bucket `voice-captures` compartilhado. O `bucket` é input
 *     (não hardcoded) — vem do `profile.storage.bucket`.
 *   - C1 (cleanup): adapter NÃO aplica TTL nem lifecycle aqui.
 *     Política de retenção é responsabilidade externa (cron + edge
 *     function ou Storage lifecycle rule filtrada por tag).
 *
 * **Limites B9A:**
 *   - Não toca em Supabase Storage.
 *   - Stub throws em todos os métodos.
 *   - Não toca `audioChunkService.ts` (serviço legado existente)
 *     — implementação real (B9B+) pode reusar ou refazer.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §4 EXECUTE (E5) + §7 C1.
 */

import type { CaptureResult } from './captureEngine'

/**
 * Metadata/tag a ser anexada ao objeto no Storage. Per C1 obrigatória
 * em Manual com retainAudio=true.
 *
 * O formato exato (S3 metadata header `x-amz-meta-<key>` vs Supabase
 * Storage metadata field) é decisão do adapter real. O contrato aqui
 * é simples: par chave/valor que o adapter sabe gravar.
 */
export interface CaptureStorageMetadataTag {
  key: string
  value: string
}

export interface CaptureStorageUploadInput {
  /** Sessão a que o áudio pertence (vem de capturePersistence.createSession). */
  sessionId: string
  /**
   * Chunk id opcional. Se omitido, adapter gera (`uuid` ou
   * timestamp+counter). Permitir override é útil para retry
   * determinístico.
   */
  chunkId?: string
  /** Blob produzido pelo MediaSource adapter. */
  blob: Blob
  /** Format detectado pelo source. */
  format: CaptureResult['format']
  /**
   * Bucket alvo — vem do `profile.storage.bucket`. Não hardcoded
   * para preservar D7 (mesmo bucket Manual/Safe).
   */
  bucket: string
  /**
   * Path template — vem do `profile.storage.pathTemplate`.
   * Placeholders esperados: `{userId}`, `{sessionId}`, `{chunkId}`,
   * `{ext}`. Adapter substitui no momento do upload.
   */
  pathTemplate: string
  /**
   * Metadata/tag obrigatória C1 quando Manual+retainAudio=true.
   * Safe Capture deixa undefined (sem tag = lifecycle filtrado
   * de Manual NÃO atinge).
   */
  metadataTag?: CaptureStorageMetadataTag
  /**
   * UserId do usuário autenticado — necessário para substituir
   * `{userId}` no path. Engine resolve via supabase.auth no
   * momento do start; passa aqui.
   */
  userId: string
}

export interface CaptureStorageUploadResult {
  bucket: string
  /** Path final substituído (sem placeholders). */
  storagePath: string
  chunkId: string
  bytes: number
  /** ISO timestamp do upload concluído. */
  uploadedAt: string
}

export interface CaptureStorageDeleteInput {
  bucket: string
  storagePath: string
}

export type CaptureStorageErrorCode =
  | 'upload-failed'
  | 'delete-failed'
  | 'invalid-input'
  | 'permission-denied'
  | 'quota-exceeded'
  | 'unsupported'

export class CaptureStorageError extends Error {
  readonly code: CaptureStorageErrorCode
  constructor(code: CaptureStorageErrorCode, message: string) {
    super(`CaptureStorage[${code}]: ${message}`)
    this.name = 'CaptureStorageError'
    this.code = code
  }
}

export class CaptureStorageUnimplementedError extends Error {
  constructor(method: string) {
    super(`CaptureStorage.${method} is not implemented yet (BREAK B9A stub).`)
    this.name = 'CaptureStorageUnimplementedError'
  }
}

/**
 * Contrato consumido pelo engine quando `profile.retainAudio === true`
 * e/ou `profile.storage.uploadTrigger !== 'never'`.
 */
export interface CaptureStorage {
  uploadAudio(input: CaptureStorageUploadInput): Promise<CaptureStorageUploadResult>
  /**
   * Remove áudio do bucket. Útil em cancel mid-recording (se já tinha
   * subido chunk) e em cleanup explícito futuro (cron job per C1
   * fallback).
   */
  deleteAudio(input: CaptureStorageDeleteInput): Promise<void>
}

/**
 * Stub factory. Todos os métodos throw. NÃO consumir em produção
 * em B9A. Útil para tests do engine sem mockar Supabase Storage.
 */
export function createCaptureStorageStub(): CaptureStorage {
  return {
    uploadAudio: async () => {
      throw new CaptureStorageUnimplementedError('uploadAudio')
    },
    deleteAudio: async () => {
      throw new CaptureStorageUnimplementedError('deleteAudio')
    },
  }
}

/**
 * Helper interno: extrai extensão de arquivo do format reportado pelo
 * source. Útil para substituir `{ext}` no path template.
 */
export function captureFormatToExtension(
  format: CaptureResult['format'],
): string {
  switch (format) {
    case 'wav':
      return 'wav'
    case 'webm':
      return 'webm'
    case 'opus':
      return 'ogg'
    case 'm4a':
      return 'm4a'
    case 'mp4':
      return 'mp4'
  }
}

/**
 * Helper interno: substitui placeholders no path template. Pure function.
 * Adapter real chama isto antes do upload.
 */
export function resolveCaptureStoragePath(
  pathTemplate: string,
  vars: { userId: string; sessionId: string; chunkId: string; ext: string },
): string {
  return pathTemplate
    .replace('{userId}', vars.userId)
    .replace('{sessionId}', vars.sessionId)
    .replace('{chunkId}', vars.chunkId)
    .replace('{ext}', vars.ext)
}
