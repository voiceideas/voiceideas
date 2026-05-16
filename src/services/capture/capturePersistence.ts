/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B9A (2026-05-16)
 *
 * Contrato neutro para persistência de `capture_sessions`. Define como
 * o CaptureEngine cria/atualiza rows de sessão sem acoplar a uma
 * implementação Supabase específica.
 *
 * **Status (B9A):** APENAS interface + stub. Nenhuma chamada real ao
 * banco. Nenhum hook consome.
 *
 * **Regras refletidas (D1, D5, D7):**
 *   - D1: Manual sempre cria `capture_session` (mesmo gravação curta).
 *     `CaptureSessionInput.mode` indica qual profile criou.
 *   - D5: Manual sem recovery; status `failed` é registrado mas o
 *     engine não tenta retry automático (consumer/usuário decide).
 *   - D7: schema/path do áudio referenciado é responsabilidade do
 *     `captureStorage.ts` — esta camada só guarda a referência via
 *     `attachAudio(sessionId, storagePath)`.
 *
 * **Limites B9A:**
 *   - Não chama Supabase. Stub throws em todos os métodos.
 *   - Não toca em `useCaptureSession` (hook legado existente)
 *     — implementação real (B9B+) pode reutilizar `captureSessionService`
 *     ou ir direto ao client Supabase.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §4 EXECUTE (E5+).
 */

import type { CaptureMode, CaptureProfile } from './captureEngine'

/**
 * Status persistido em `capture_sessions.status`. Mapeamento com
 * schema existente é responsabilidade do adapter real (B9B+).
 */
export type CaptureSessionStatus =
  | 'pending'
  | 'completed'
  | 'cancelled'
  | 'failed'

/**
 * Subset do profile que importa para persistência. Resto vive em
 * memória (não persistimos profile inteiro).
 */
export interface CaptureSessionProfileSnapshot {
  autoSegmentation: boolean
  backgroundContinuation: boolean
  retainAudio: boolean
}

export interface CaptureSessionInput {
  mode: CaptureMode
  /** ISO timestamp. Engine gera no momento do start. */
  startedAt: string
  /** Snapshot do profile efetivo para audit/diagnose. */
  profileSnapshot: CaptureSessionProfileSnapshot
}

export interface CaptureSessionRecord {
  id: string
  mode: CaptureMode
  status: CaptureSessionStatus
  startedAt: string
  completedAt: string | null
  cancelledAt: string | null
  failedAt: string | null
  failureReason: string | null
  durationMs: number | null
  /**
   * Path no bucket de áudio, se `retainAudio=true` e upload concluiu.
   * Camada de persistência não interpreta — só guarda a referência.
   */
  audioStoragePath: string | null
  transcript: string | null
}

export type CapturePersistenceErrorCode =
  | 'create-failed'
  | 'update-failed'
  | 'not-found'
  | 'invalid-state'
  | 'unsupported'

export class CapturePersistenceError extends Error {
  readonly code: CapturePersistenceErrorCode
  constructor(code: CapturePersistenceErrorCode, message: string) {
    super(`CapturePersistence[${code}]: ${message}`)
    this.name = 'CapturePersistenceError'
    this.code = code
  }
}

export class CapturePersistenceUnimplementedError extends Error {
  constructor(method: string) {
    super(`CapturePersistence.${method} is not implemented yet (BREAK B9A stub).`)
    this.name = 'CapturePersistenceUnimplementedError'
  }
}

/**
 * Contrato consumido pelo engine. Métodos retornam o record atualizado
 * para consumer poder atualizar state localmente sem refetch.
 */
export interface CapturePersistence {
  createSession(input: CaptureSessionInput): Promise<CaptureSessionRecord>
  markCompleted(
    sessionId: string,
    durationMs: number,
  ): Promise<CaptureSessionRecord>
  markCancelled(sessionId: string): Promise<CaptureSessionRecord>
  markFailed(
    sessionId: string,
    reason: string,
  ): Promise<CaptureSessionRecord>
  attachAudio(
    sessionId: string,
    audioStoragePath: string,
  ): Promise<CaptureSessionRecord>
  attachTranscript(
    sessionId: string,
    transcript: string,
  ): Promise<CaptureSessionRecord>
}

/**
 * Stub factory. Todos os métodos throw. Útil para tests do engine
 * que não querem mockar Supabase. NÃO consumir em produção em B9A.
 */
export function createCapturePersistenceStub(): CapturePersistence {
  return {
    createSession: async () => {
      throw new CapturePersistenceUnimplementedError('createSession')
    },
    markCompleted: async () => {
      throw new CapturePersistenceUnimplementedError('markCompleted')
    },
    markCancelled: async () => {
      throw new CapturePersistenceUnimplementedError('markCancelled')
    },
    markFailed: async () => {
      throw new CapturePersistenceUnimplementedError('markFailed')
    },
    attachAudio: async () => {
      throw new CapturePersistenceUnimplementedError('attachAudio')
    },
    attachTranscript: async () => {
      throw new CapturePersistenceUnimplementedError('attachTranscript')
    },
  }
}

/**
 * Helper interno: extrai o snapshot persistível de um `CaptureProfile`
 * completo. Usado quando o engine cria uma sessão para garantir que
 * só os campos relevantes vão pro banco.
 */
export function toSessionProfileSnapshot(
  profile: CaptureProfile,
): CaptureSessionProfileSnapshot {
  return {
    autoSegmentation: profile.autoSegmentation,
    backgroundContinuation: profile.backgroundContinuation,
    retainAudio: profile.retainAudio,
  }
}
