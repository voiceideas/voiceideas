import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAuthenticatedRequest } from '../_shared/auth.ts'
import { corsHeaders, getErrorMessage, jsonResponse } from '../_shared/http.ts'

interface RequestBody {
  platformSource: 'web' | 'macos' | 'android' | 'ios'
  provisionalFolderName?: string
  startedAt?: string
  endedAt?: string | null
  rawStoragePath?: string | null
  renameRequired?: boolean
  status?: 'active' | 'completed' | 'cancelled' | 'failed'
}

function defaultProvisionalFolderName(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')

  return `captura-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await requireAuthenticatedRequest(req)
    if (!auth) {
      return jsonResponse({ error: 'Autenticacao obrigatoria para iniciar captura.' }, 401)
    }

    const body = await req.json() as RequestBody
    if (!body.platformSource) {
      return jsonResponse({ error: 'platformSource e obrigatorio.' }, 400)
    }

    const { data, error } = await auth.client
      .from('capture_sessions')
      .insert({
        user_id: auth.user.id,
        started_at: body.startedAt ?? new Date().toISOString(),
        ended_at: body.endedAt ?? null,
        status: body.status ?? (body.endedAt ? 'completed' : 'active'),
        provisional_folder_name: body.provisionalFolderName?.trim() || defaultProvisionalFolderName(),
        final_folder_name: null,
        rename_required: body.renameRequired ?? true,
        processing_status: 'captured',
        platform_source: body.platformSource,
        raw_storage_path: body.rawStoragePath ?? null,
      })
      .select('id, provisional_folder_name, status, processing_status, platform_source')
      .single()

    if (error) {
      throw new Error(`Nao foi possivel registrar a sessao de captura: ${error.message}`)
    }

    return jsonResponse({
      sessionId: data.id,
      provisionalFolderName: data.provisional_folder_name,
      status: data.status,
      processingStatus: data.processing_status,
      platformSource: data.platform_source,
    }, 201)
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500)
  }
})
