// Supabase Edge Function — Organização com IA (GPT-4o-mini)
// Deploy: supabase functions deploy organize --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  texts: string
  type: string
  typeLabel: string
  systemPrompt: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    const { texts, type, typeLabel, systemPrompt } = await req.json() as RequestBody

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Voce e um assistente especializado em organizar ideias e textos em portugues brasileiro.

${systemPrompt}

IMPORTANTE: Responda APENAS em JSON valido com esta estrutura exata:
{
  "title": "Titulo descritivo para esta organizacao",
  "content": {
    "summary": "Breve resumo geral (1-2 frases)",
    "sections": [
      {
        "title": "Titulo da secao",
        "items": ["item 1", "item 2", "item 3"]
      }
    ]
  }
}

Crie entre 2 e 8 secoes, cada uma com 1 a 10 itens.
Use linguagem clara e objetiva em portugues brasileiro.
Nao inclua markdown, apenas JSON puro.`,
          },
          {
            role: 'user',
            content: `Organize as seguintes notas como "${typeLabel}":\n\n${texts}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${errorData}`)
    }

    const data = await response.json()
    const content = data.choices[0].message.content

    // Parse JSON from response (handle potential markdown wrapping)
    let parsed
    try {
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(jsonStr)
    } catch {
      throw new Error('Failed to parse AI response as JSON')
    }

    return new Response(JSON.stringify(parsed), {
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
