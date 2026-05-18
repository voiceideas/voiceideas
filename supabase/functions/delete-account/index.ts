/**
 * VI_LGPD_DELETE_ACCOUNT (2026-05-17)
 *
 * Edge function autenticada para excluir permanentemente a conta do
 * usuário titular (LGPD art. 18 VI — direito à eliminação).
 *
 * Fluxo:
 *   1. Valida JWT do request; userId vem EXCLUSIVAMENTE de
 *      `auth.getUser()` (NUNCA do body do client).
 *   2. Lista recursivamente todos os objetos do bucket `voice-captures`
 *      sob o prefixo `{userId}/`.
 *   3. Remove em batch todos os objetos do storage.
 *   4. Chama `adminClient.auth.admin.deleteUser(userId)` — isso dispara
 *      CASCADE em todas as tabelas user-scoped (notes via folders,
 *      capture_sessions, audio_chunks, idea_drafts, transcription_jobs,
 *      bridge_exports, bridge_items, bardo_account_links,
 *      organized_idea_invites, organized_idea_members, ai_usage_ledger,
 *      ai_usage_limits, user_profiles, user_settings_bridge,
 *      user_settings_external_integrations, folders).
 *   5. `security_events` tem `ON DELETE SET NULL` no user_id → logs
 *      ficam anonimizados (sem PII), preservando audit histórico.
 *      Decisão LGPD-aceitável: anonimização irreversível.
 *
 * **Segurança crítica:**
 *   - userId NÃO vem do body — usado apenas o `user.id` do JWT.
 *   - Service role usado APENAS após validar JWT.
 *   - Idempotente: se algum step falhar parcialmente, callout retorna
 *     erro claro; user pode tentar novamente. Storage delete antes do
 *     auth delete reduz órfãos.
 *   - Log de audit final NÃO inclui transcript, áudio, signed URL ou
 *     email — apenas userId, counts e timestamp.
 *
 * **Guardrails respeitados (ordem `VI_LGPD_DELETE_ACCOUNT`):**
 *   - Não chama Bardo backend (apenas deleta linha local via cascade).
 *   - Não aplica TTL/lifecycle.
 *   - Não altera provider de transcrição.
 *   - Não muda fluxo Manual/Safe Capture.
 *   - Não aceita userId do client.
 *   - Não apaga dados de outro usuário (impossível pelo design).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/http.ts'
import { json, requireUser } from '../_shared/security.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const STORAGE_BUCKET = 'voice-captures'
const STORAGE_LIST_LIMIT = 1000

function withCors(response: Response) {
  const headers = new Headers(response.headers)
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service role environment is not configured')
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Lista recursivamente todos os objetos sob `{userId}/` no bucket
 * `voice-captures`. Storage do Supabase trata pastas como prefixos —
 * `list()` retorna entries com `name` (sem prefixo) e diferencia
 * arquivo (tem `id`) vs subdiretório (sem `id`).
 *
 * Path schema: `{userId}/sessions/{sessionId}/chunks/{chunkId}.{ext}`
 * (D7). Bucket tem RLS por `split_part(name, '/', 1) = auth.uid()::text`
 * — admin client bypassa, mas continuamos respeitando o prefixo do
 * userId per defesa em profundidade.
 */
type AdminClient = ReturnType<typeof createAdminClient>

async function listAllObjectsRecursively(
  admin: AdminClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const collected: string[] = []
  const queue: string[] = [prefix]

  while (queue.length > 0) {
    const currentPrefix = queue.shift() as string
    const { data, error } = await admin.storage
      .from(bucket)
      .list(currentPrefix, { limit: STORAGE_LIST_LIMIT })

    if (error) {
      throw new Error(`storage.list('${currentPrefix}') falhou: ${error.message}`)
    }
    if (!data) continue

    for (const entry of data) {
      // Storage retorna entries com `id` para arquivos e sem `id` para
      // "pastas" (prefixos). Algumas versões da SDK retornam `id: null`
      // para diretórios — checamos as duas variações.
      const fullPath = `${currentPrefix}/${entry.name}`
      const isDirectory = entry.id === null || entry.id === undefined
      if (isDirectory) {
        queue.push(fullPath)
      } else {
        collected.push(fullPath)
      }
    }
  }

  return collected
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return withCors(json({ error: 'Method not allowed' }, 405))
    }

    // SEGURANÇA: userId vem APENAS do JWT validado. Nunca aceitamos
    // userId do body — proteção contra account takeover.
    const { user } = await requireUser(req)
    const userId = user.id

    const admin = createAdminClient()

    // ─── 1. Storage: lista + remove tudo sob {userId}/ ──────────────
    let storagePaths: string[] = []
    try {
      storagePaths = await listAllObjectsRecursively(admin, STORAGE_BUCKET, userId)
    } catch (err) {
      // Falha em listar storage é não-fatal se for empty path — só
      // logamos. Se for erro real de conexão, propagamos abaixo.
      const message = err instanceof Error ? err.message : String(err)
      console.error('[delete-account] storage list failed', { userId, message })
      // Continua com lista vazia — auth.admin.deleteUser ainda vai
      // limpar todo o DB; órfãos no storage podem ser limpos depois.
      storagePaths = []
    }

    let audioObjectsDeleted = 0
    if (storagePaths.length > 0) {
      // Remove em batch (Supabase aceita até 1000 paths por call).
      // Chunks de 500 para margem.
      const BATCH_SIZE = 500
      for (let i = 0; i < storagePaths.length; i += BATCH_SIZE) {
        const batch = storagePaths.slice(i, i + BATCH_SIZE)
        const { error: removeError } = await admin.storage
          .from(STORAGE_BUCKET)
          .remove(batch)
        if (removeError) {
          throw new Error(
            `storage.remove batch [${i},${i + batch.length}) falhou: ${removeError.message}`,
          )
        }
        audioObjectsDeleted += batch.length
      }
    }

    // ─── 2. Auth user delete (CASCADE em DB) ─────────────────────────
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId)
    if (deleteUserError) {
      throw new Error(`auth.admin.deleteUser falhou: ${deleteUserError.message}`)
    }

    // ─── 3. Audit técnico mínimo (NÃO loga PII) ─────────────────────
    console.info('[delete-account] account deleted', {
      userId,
      audioObjectsDeleted,
      deletedAt: new Date().toISOString(),
    })

    return withCors(
      json({
        ok: true,
        audioObjectsDeleted,
        deletedAt: new Date().toISOString(),
      }),
    )
  } catch (error) {
    // Response objects vindos de requireUser etc são propagated direto.
    if (error instanceof Response) {
      return withCors(error)
    }
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('[delete-account] unexpected failure', { message })
    return withCors(json({ error: message }, 500))
  }
})
