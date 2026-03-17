// Supabase Edge Function — Organizacao com IA (GPT-4o-mini)
// Deploy: supabase functions deploy organize

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

interface OrganizedSection {
  title: string
  items: string[]
}

interface OrganizedPayload {
  title: string
  content: {
    summary?: string
    sections: OrganizedSection[]
  }
}

function extractJsonString(content: string): string {
  const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1)
  }

  return cleaned
}

function normalizeOrganizedPayload(payload: unknown): OrganizedPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('A IA devolveu um payload invalido para organizacao')
  }

  const rawPayload = payload as {
    title?: unknown
    content?: {
      summary?: unknown
      sections?: unknown
    }
  }
  const rawSections = Array.isArray(rawPayload.content?.sections)
    ? rawPayload.content.sections
    : []

  const sections = rawSections
    .map((section) => {
      if (typeof section !== 'object' || section === null) {
        return null
      }

      const rawSection = section as { title?: unknown; heading?: unknown; items?: unknown }
      const title = typeof rawSection.title === 'string'
        ? rawSection.title
        : typeof rawSection.heading === 'string'
          ? rawSection.heading
          : 'Secao'
      const items = Array.isArray(rawSection.items)
        ? rawSection.items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []

      if (!items.length) {
        return null
      }

      return { title, items }
    })
    .filter((section): section is OrganizedSection => section !== null)

  if (!sections.length) {
    throw new Error('A IA nao devolveu secoes validas para organizacao')
  }

  return {
    title: typeof rawPayload.title === 'string' && rawPayload.title.trim().length > 0
      ? rawPayload.title
      : 'Organizacao de ideias',
    content: {
      summary: typeof rawPayload.content?.summary === 'string'
        ? rawPayload.content.summary
        : undefined,
      sections,
    },
  }
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

    if (!texts?.trim()) {
      throw new Error('Nenhuma nota foi enviada para organizacao')
    }

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
            content: `Organize as seguintes notas como "${typeLabel}" (tipo interno: "${type}"):\n\n${texts}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${errorData}`)
    }

    const data = await response.json()
    const content = data.choices[0].message.content

    let parsed
    try {
      const jsonStr = extractJsonString(content)
      parsed = JSON.parse(jsonStr)
    } catch {
      throw new Error('Failed to parse AI response as JSON')
    }

    const normalizedPayload = normalizeOrganizedPayload(parsed)

    return new Response(JSON.stringify(normalizedPayload), {
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
