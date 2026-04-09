import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { assertBusinessRateLimit, assertDailyAiQuota, logAiUsage, logSecurityEvent } from '../_shared/quotas.ts'
import { corsHeaders } from '../_shared/http.ts'
import { getClientIp, json, requireUser } from '../_shared/security.ts'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_LANGUAGES = new Set(['pt', 'pt-br', 'en', 'es'])

function withCors(response: Response) {
  const headers = new Headers(response.headers)
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

function normalizeLanguage(value: FormDataEntryValue | null) {
  const normalized = String(value || 'pt').trim().toLowerCase()
  return ALLOWED_LANGUAGES.has(normalized) ? normalized : 'pt'
}

function estimateTranscriptionCost(fileSize: number) {
  return Math.max(0.003, Number((fileSize / (8 * 1024 * 1024) * 0.006).toFixed(4)))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return withCors(json({ error: 'Method not allowed' }, 405))
    }

    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    const { user, adminClient } = await requireUser(req)
    const ip = getClientIp(req)

    await assertBusinessRateLimit(adminClient, user.id, 'legacy_transcribe_call', 20)
    await assertDailyAiQuota(adminClient, user.id, 'legacy_transcribe')

    const formData = await req.formData()
    const file = formData.get('file')
    const language = normalizeLanguage(formData.get('language'))

    if (!(file instanceof File)) {
      return withCors(json({ error: 'Audio file is required' }, 400))
    }

    if (!file.size) {
      return withCors(json({ error: 'Audio file is empty' }, 400))
    }

    if (file.size > MAX_FILE_BYTES) {
      return withCors(json({ error: 'Audio file exceeds the 10 MB limit for this endpoint' }, 400))
    }

    const openAiFormData = new FormData()
    openAiFormData.append('file', file, file.name || 'voice-note.webm')
    openAiFormData.append('model', 'gpt-4o-transcribe')
    openAiFormData.append('language', language.startsWith('pt') ? 'pt' : language)
    openAiFormData.append('response_format', 'json')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: openAiFormData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json() as { text?: string }
    const text = data.text?.trim()

    if (!text) {
      throw new Error('OpenAI returned an empty transcription')
    }

    await logSecurityEvent(adminClient, {
      user_id: user.id,
      event_type: 'legacy_transcribe_call',
      ip,
      metadata: {
        language,
        mimeType: file.type || 'unknown',
        fileSize: file.size,
      },
    })
    await logAiUsage(
      adminClient,
      user.id,
      'legacy_transcribe',
      Math.ceil(file.size / 1024),
      estimateTranscriptionCost(file.size),
    )

    return withCors(json({ text }))
  } catch (error) {
    if (error instanceof Response) {
      return withCors(error)
    }

    console.error(error)
    return withCors(json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500))
  }
})
