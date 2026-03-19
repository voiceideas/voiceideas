// Supabase Edge Function — Transcricao de audio com OpenAI
// Deploy: supabase functions deploy transcribe

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function requireAuthenticatedUser(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase auth environment is not configured')
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return null
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error } = await userClient.auth.getUser()

  if (error || !user) {
    return null
  }

  return user
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    const user = await requireAuthenticatedUser(req)
    if (!user) {
      return jsonResponse({ error: 'Autenticacao obrigatoria para transcrever audio.' }, 401)
    }

    const formData = await req.formData()
    const file = formData.get('file')
    const language = String(formData.get('language') || 'pt')
    const prompt = String(
      formData.get('prompt') ||
      'Transcreva em portugues brasileiro, com pontuacao natural, sem repetir trechos.',
    )

    if (!(file instanceof File)) {
      throw new Error('Audio file is required')
    }

    if (!file.size) {
      throw new Error('Audio file is empty')
    }

    const openAiFormData = new FormData()
    openAiFormData.append('file', file, file.name || 'voice-note.webm')
    openAiFormData.append('model', 'gpt-4o-transcribe')
    openAiFormData.append('language', language)
    openAiFormData.append('prompt', prompt)
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
      throw new Error(
        `OpenAI API error: ${response.status} - ${errorText} | file=${file.name || 'voice-note'} type=${file.type || 'unknown'} size=${file.size}`,
      )
    }

    const data = await response.json() as { text?: string }
    const text = data.text?.trim()

    if (!text) {
      throw new Error('OpenAI returned an empty transcription')
    }

    return jsonResponse({ text })
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500)
  }
})
