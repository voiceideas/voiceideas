// Supabase Edge Function — Organizacao com IA (GPT-4o-mini)
// Deploy: supabase functions deploy organize

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-auth',
}

interface RequestBody {
  texts: string
  noteIds?: string[]
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function readAuthHeader(req: Request) {
  const customToken = req.headers.get('x-supabase-auth')?.trim()
  if (customToken) {
    return customToken.toLowerCase().startsWith('bearer ')
      ? customToken
      : `Bearer ${customToken}`
  }

  return req.headers.get('Authorization') || ''
}

async function requireAuthenticatedUser(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase auth environment is not configured')
  }

  const authHeader = readAuthHeader(req)
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

function createAuthenticatedClient(req: Request) {
  const authHeader = readAuthHeader(req)

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
}

function buildContextualHints(texts: string) {
  const hints: string[] = []

  if (/\bvoice ideas\b/i.test(texts)) {
    hints.push('Mantenha o nome do produto "Voice Ideas" explicitamente no resultado.')
  }

  if (/\bv\d+(?:\.\d+)?\b|vers[aã]o\s*\d|release|roadmap/i.test(texts)) {
    hints.push('Quando houver mencao a versoes, releases ou roadmap, preserve isso literalmente em um titulo ou item, como "v0.2".')
  }

  if (/compartilh|colabora|fus[aã]o|mescl/i.test(texts)) {
    hints.push('Se houver ideias de compartilhamento, colaboracao, fusao ou mescla, trate isso como conceito central e nao como detalhe secundario.')
  }

  if (/duvida|pergunta|avaliar|testar|experiment/i.test(texts)) {
    hints.push('Se houver um experimento, teste, duvida ou hipotese, destaque isso explicitamente em vez de transformar em recomendacao generica.')
  }

  return hints
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

    const user = await requireAuthenticatedUser(req)
    if (!user) {
      return jsonResponse({ error: 'Autenticacao obrigatoria para organizar ideias.' }, 401)
    }

    const { texts, noteIds, type, typeLabel, systemPrompt } = await req.json() as RequestBody
    let sourceTexts = texts?.trim() || ''

    if (!sourceTexts && Array.isArray(noteIds) && noteIds.length > 0) {
      const userClient = createAuthenticatedClient(req)
      const { data: notes, error } = await userClient
        .from('notes')
        .select('raw_text')
        .in('id', noteIds)

      if (error) {
        throw new Error(`Nao foi possivel carregar as notas para organizacao: ${error.message}`)
      }

      sourceTexts = (notes || [])
        .map((note) => typeof note.raw_text === 'string' ? note.raw_text.trim() : '')
        .filter((text) => text.length > 0)
        .map((text, index) => `[Nota ${index + 1}]: ${text}`)
        .join('\n\n')
    }

    if (!sourceTexts) {
      throw new Error('Nenhuma nota foi enviada para organizacao')
    }

    const contextualHints = buildContextualHints(sourceTexts)

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

REGRAS DE QUALIDADE:
- Trabalhe apenas com o que aparece nas notas.
- Preserve nomes de produto, funcionalidades, versoes e termos-chave exatamente como surgirem no material.
- Nao invente categorias de negocio ou secoes genericas so para preencher a estrutura.
- Se a entrada for curta, devolva uma estrutura curta e especifica.
- Prefira headings concretos e literais, como "Compartilhamento de ideias", "Fusao entre usuarios" ou "v0.2", quando esses conceitos existirem nas notas.
- Cada item deve ser uma afirmacao concreta, aproveitavel e fiel ao texto de origem.
- Se houver proximos passos, experimento, versao futura, dependencia, duvida ou decisao, destaque isso explicitamente.
${contextualHints.map((hint) => `- ${hint}`).join('\n')}

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

Crie de 1 a 6 secoes apenas quando elas forem sustentadas pelas notas. Nao crie secoes de enchimento.
Use linguagem clara e objetiva em portugues brasileiro.
Nao inclua markdown, apenas JSON puro.`,
          },
          {
            role: 'user',
            content: `Organize as seguintes notas como "${typeLabel}" (tipo interno: "${type}"):\n\n${sourceTexts}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
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

    return jsonResponse(normalizedPayload)
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500)
  }
})
