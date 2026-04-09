import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { assertBusinessRateLimit, assertDailyAiQuota, logAiUsage, logSecurityEvent } from '../_shared/quotas.ts'
import { corsHeaders } from '../_shared/http.ts'
import { getClientIp, json, requireUser } from '../_shared/security.ts'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const MAX_ITEMS = 100
const MAX_TOTAL_CHARS = 50_000

type OrganizeMode =
  | 'group_notes'
  | 'summarize_notes'
  | 'action_plan'
  | 'outline'
  | 'idea_map'

interface RequestBody {
  texts?: unknown
  mode?: unknown
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
    transparency?: {
      combined: string[]
      preservedDifferences: string[]
      inferredStructure: string[]
    }
  }
}

function withCors(response: Response) {
  const headers = new Headers(response.headers)
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

function resolveMode(value: unknown): OrganizeMode {
  if (value === 'summarize_notes') return value
  if (value === 'action_plan') return value
  if (value === 'outline') return value
  if (value === 'idea_map') return value
  return 'group_notes'
}

function getSystemPrompt(mode: OrganizeMode) {
  const baseRules = `You organize notes without inventing facts.
- Work only with information present in the notes.
- Preserve proper names, versions, features, and key expressions exactly as they appear.
- Keep relevant tensions, open questions, and contradictions visible instead of flattening them.
- If the input is short, produce a short structure.
- Reply only with valid JSON matching the required schema.

JSON schema:
{
  "title": "Descriptive title",
  "content": {
    "summary": "Optional concise summary",
    "sections": [
      {
        "title": "Section title",
        "items": ["Specific item"]
      }
    ],
    "transparency": {
      "combined": ["What was combined from the notes"],
      "preservedDifferences": ["Differences or tensions kept explicit"],
      "inferredStructure": ["Only light structural choices made by the AI"]
    }
  }
}`

  switch (mode) {
    case 'summarize_notes':
      return `${baseRules}

Summarize the notes into a clear structure that stays faithful to the source material.`
    case 'action_plan':
      return `${baseRules}

Turn the notes into a concrete action plan with priorities, dependencies, next steps, and open questions only when supported by the source material.`
    case 'outline':
      return `${baseRules}

Organize the notes into a coherent outline that preserves the original progression of the ideas.`
    case 'idea_map':
      return `${baseRules}

Map concepts, relationships, clusters, and dependencies that are explicitly present in the notes.`
    case 'group_notes':
    default:
      return `${baseRules}

Group related notes into a coherent synthesis, removing obvious redundancy while preserving relevant differences.`
  }
}

function buildUserPayload(texts: string[]) {
  return texts
    .map((text, index) => `[Note ${index + 1}] ${text}`)
    .join('\n\n')
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

function normalizeItems(value: unknown) {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
    : []
}

function normalizeOrganizedPayload(payload: unknown): OrganizedPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('The AI returned an invalid organization payload')
  }

  const rawPayload = payload as {
    title?: unknown
    content?: {
      summary?: unknown
      sections?: unknown
      transparency?: {
        combined?: unknown
        preservedDifferences?: unknown
        inferredStructure?: unknown
      }
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
        ? rawSection.title.trim()
        : typeof rawSection.heading === 'string'
          ? rawSection.heading.trim()
          : ''
      const items = normalizeItems(rawSection.items)

      if (!title || !items.length) {
        return null
      }

      return { title, items }
    })
    .filter((section): section is OrganizedSection => Boolean(section))

  if (!sections.length) {
    throw new Error('The AI did not return valid sections')
  }

  const transparency = rawPayload.content?.transparency
    ? {
      combined: normalizeItems(rawPayload.content.transparency.combined),
      preservedDifferences: normalizeItems(rawPayload.content.transparency.preservedDifferences),
      inferredStructure: normalizeItems(rawPayload.content.transparency.inferredStructure),
    }
    : undefined

  const hasTransparency = Boolean(
    transparency
    && (transparency.combined.length || transparency.preservedDifferences.length || transparency.inferredStructure.length),
  )

  return {
    title: typeof rawPayload.title === 'string' && rawPayload.title.trim()
      ? rawPayload.title.trim()
      : 'Organized notes',
    content: {
      summary: typeof rawPayload.content?.summary === 'string' && rawPayload.content.summary.trim()
        ? rawPayload.content.summary.trim()
        : undefined,
      sections,
      transparency: hasTransparency ? transparency : undefined,
    },
  }
}

function estimateOrganizeCost(totalChars: number) {
  return Math.max(0.0025, Number((totalChars / 200_000).toFixed(4)))
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

    await assertBusinessRateLimit(adminClient, user.id, 'organize_call', 5)
    await assertDailyAiQuota(adminClient, user.id, 'organize')

    const body = await req.json() as RequestBody
    const texts = Array.isArray(body?.texts)
      ? body.texts.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : []
    const mode = resolveMode(body?.mode)

    if (!texts.length) {
      return withCors(json({ error: 'texts is required' }, 400))
    }

    if (texts.length > MAX_ITEMS) {
      return withCors(json({ error: 'Too many text items' }, 400))
    }

    const totalChars = texts.reduce((sum, text) => sum + text.length, 0)
    if (totalChars > MAX_TOTAL_CHARS) {
      return withCors(json({ error: 'Payload too large' }, 400))
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: getSystemPrompt(mode) },
          {
            role: 'user',
            content: `Organize these notes. Keep the response in the same language used by the source material whenever that language is clear.\n\n${buildUserPayload(texts)}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 1800,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content || ''
    const parsed = JSON.parse(extractJsonString(content))
    const normalizedPayload = normalizeOrganizedPayload(parsed)

    await logSecurityEvent(adminClient, {
      user_id: user.id,
      event_type: 'organize_call',
      ip,
      metadata: { mode, itemCount: texts.length, totalChars },
    })
    await logAiUsage(adminClient, user.id, 'organize', totalChars, estimateOrganizeCost(totalChars))

    return withCors(json(normalizedPayload))
  } catch (error) {
    if (error instanceof Response) {
      return withCors(error)
    }

    console.error(error)
    return withCors(json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500))
  }
})
