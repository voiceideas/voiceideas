// Supabase Edge Function — Transcricao de audio com OpenAI
// Deploy: supabase functions deploy transcribe --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured')
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
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json() as { text?: string }
    const text = data.text?.trim()

    if (!text) {
      throw new Error('OpenAI returned an empty transcription')
    }

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
