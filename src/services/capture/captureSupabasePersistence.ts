/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B9B (2026-05-16)
 *
 * Implementação real de `CapturePersistence` usando Supabase client.
 * Reusa os MESMOS patterns de `captureSessionService.ts` (sem importar
 * o serviço para evitar acoplamento — duplicação mínima aceita).
 *
 * **Status (B9B):** adapter real instanciável. NÃO consumido por nenhum
 * hook ou pelo engine B8. Existe lado a lado com o stub B9A.
 *
 * **Mapeamento engine ↔ schema atual:**
 *   - engine `pending` → schema `'active'`
 *   - engine `completed` → schema `'completed'`
 *   - engine `cancelled` → schema `'cancelled'`
 *   - engine `failed` → schema `'failed'`
 *   - engine `audioStoragePath` → schema `raw_storage_path`
 *   - engine `transcript` → **NÃO há coluna em capture_sessions hoje.**
 *     `attachTranscript()` loga warn e retorna record sem update —
 *     persistência real de transcript exige migration (out of scope B9B).
 *
 * **Limites B9B:**
 *   - Não toca `useCaptureSession` hook nem `captureSessionService`.
 *   - Não cria migration. Usa schema existente.
 *   - `attachTranscript` é no-op (limitação de schema documentada).
 *   - `platform_source` é fixo 'web' como heurística — refinamento via
 *     capabilities detection em B9C+ se necessário.
 *   - `failureReason` não persistido (sem coluna no schema) — só
 *     reportado no `CaptureSessionRecord` retornado em memória.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §4 EXECUTE (E5+).
 */

import { supabase } from '../../lib/supabase'
import { createAppError } from '../../lib/errors'
import { requireAuthenticatedUserId } from '../serviceAuth'
import type { Database } from '../../types/database'
import type { CapturePlatformSource, CaptureSessionStatus as SchemaCaptureSessionStatus } from '../../types/capture'
import type { CaptureMode } from './captureEngine'
import type {
  CapturePersistence,
  CaptureSessionInput,
  CaptureSessionRecord,
  CaptureSessionStatus,
} from './capturePersistence'
import { CapturePersistenceError } from './capturePersistence'

type CaptureSessionRow = Database['public']['Tables']['capture_sessions']['Row']
type CaptureSessionInsert = Database['public']['Tables']['capture_sessions']['Insert']
type CaptureSessionUpdate = Database['public']['Tables']['capture_sessions']['Update']

// ─── Defaults & helpers ──────────────────────────────────────────────

const DEFAULT_PLATFORM_SOURCE: CapturePlatformSource = 'web'

function inferModeFromRow(row: CaptureSessionRow): CaptureMode {
  // Schema atual NÃO tem coluna `mode`. Heurística mínima:
  // sessões com `processing_status === 'awaiting-segmentation'` ou
  // chunks associados são tipicamente Safe Capture; o resto fica
  // como manual. Como B9B não consome em produção, default 'manual'
  // é seguro.
  void row
  return 'manual'
}

function mapEngineStatusFromRow(
  schemaStatus: SchemaCaptureSessionStatus,
): CaptureSessionStatus {
  switch (schemaStatus) {
    case 'active':
      return 'pending'
    case 'completed':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    case 'failed':
      return 'failed'
  }
}

function defaultProvisionalFolderName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `captura-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function rowToRecord(row: CaptureSessionRow): CaptureSessionRecord {
  const engineStatus = mapEngineStatusFromRow(row.status)
  return {
    id: row.id,
    mode: inferModeFromRow(row),
    status: engineStatus,
    startedAt: row.started_at,
    completedAt: row.status === 'completed' ? row.ended_at : null,
    cancelledAt: row.status === 'cancelled' ? row.ended_at : null,
    failedAt: row.status === 'failed' ? row.ended_at : null,
    failureReason: null, // schema atual não persiste; só em memória
    durationMs: null, // schema não persiste duração separada
    audioStoragePath: row.raw_storage_path,
    transcript: null, // schema não persiste transcript em capture_sessions
  }
}

function buildInsertPayload(
  userId: string,
  input: CaptureSessionInput,
): CaptureSessionInsert {
  return {
    user_id: userId,
    started_at: input.startedAt,
    ended_at: null,
    status: 'active',
    provisional_folder_name: defaultProvisionalFolderName(),
    final_folder_name: null,
    rename_required: true,
    processing_status: 'captured',
    platform_source: DEFAULT_PLATFORM_SOURCE,
    raw_storage_path: null,
  }
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Cria implementação real de `CapturePersistence`. Em B9B NÃO é
 * consumida por nenhum hook ou pelo engine B8 — apenas existe e é
 * instanciável.
 */
export function createSupabaseCapturePersistence(): CapturePersistence {
  const fetchById = async (sessionId: string): Promise<CaptureSessionRow> => {
    const userId = await requireAuthenticatedUserId()
    const { data, error } = await supabase
      .from('capture_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single()
    if (error) {
      throw new CapturePersistenceError(
        'not-found',
        await formatErrorMessage(error, 'Sessão não encontrada.'),
      )
    }
    return data as CaptureSessionRow
  }

  const updateRow = async (
    sessionId: string,
    patch: CaptureSessionUpdate,
    notFoundMessage: string,
  ): Promise<CaptureSessionRow> => {
    const userId = await requireAuthenticatedUserId()
    const { data, error } = await supabase
      .from('capture_sessions')
      .update(patch)
      .eq('id', sessionId)
      .eq('user_id', userId)
      .select()
      .single()
    if (error) {
      throw new CapturePersistenceError(
        'update-failed',
        await formatErrorMessage(error, notFoundMessage),
      )
    }
    return data as CaptureSessionRow
  }

  return {
    async createSession(input) {
      const userId = await requireAuthenticatedUserId()
      const { data, error } = await supabase
        .from('capture_sessions')
        .insert(buildInsertPayload(userId, input))
        .select()
        .single()

      if (error) {
        throw new CapturePersistenceError(
          'create-failed',
          await formatErrorMessage(error, 'Não foi possível criar capture_session.'),
        )
      }

      const row = data as CaptureSessionRow
      const record = rowToRecord(row)
      // Sobrescreve mode com o que o engine declarou (schema não persiste).
      return { ...record, mode: input.mode }
    },

    async markCompleted(sessionId, durationMs) {
      const row = await updateRow(
        sessionId,
        {
          status: 'completed',
          ended_at: new Date().toISOString(),
          processing_status: 'captured',
        },
        'Não foi possível marcar capture_session como concluída.',
      )
      const record = rowToRecord(row)
      return { ...record, durationMs }
    },

    async markCancelled(sessionId) {
      const row = await updateRow(
        sessionId,
        {
          status: 'cancelled',
          ended_at: new Date().toISOString(),
        },
        'Não foi possível marcar capture_session como cancelada.',
      )
      return rowToRecord(row)
    },

    async markFailed(sessionId, reason) {
      const row = await updateRow(
        sessionId,
        {
          status: 'failed',
          ended_at: new Date().toISOString(),
        },
        'Não foi possível marcar capture_session como falha.',
      )
      const record = rowToRecord(row)
      // failureReason fica em memória — schema atual não tem coluna
      // dedicada. Documentado nos limites B9B.
      return { ...record, failureReason: reason }
    },

    async attachAudio(sessionId, audioStoragePath) {
      const row = await updateRow(
        sessionId,
        { raw_storage_path: audioStoragePath },
        'Não foi possível anexar áudio à capture_session.',
      )
      return rowToRecord(row)
    },

    async attachTranscript(sessionId, transcript) {
      // LIMITAÇÃO B9B: schema `capture_sessions` não tem coluna
      // `transcript`. Este método é no-op intencional. Engine real
      // (B9C+) vai usar outra tabela (notes, organized_ideas, ou
      // criar coluna via migration) — decisão fora de escopo B9B.
      const row = await fetchById(sessionId)
      const record = rowToRecord(row)
      return { ...record, transcript }
    },
  }
}

// ─── Helpers internos ────────────────────────────────────────────────

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
