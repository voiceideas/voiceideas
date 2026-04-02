const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')

export interface TranscriptionResult {
  text: string
  rawResponse: Record<string, unknown>
}

export interface MaterializedIdeaResult {
  cleanedText: string
  suggestedTitle: string
  suggestedTags: string[]
  suggestedFolder: string | null
}

function requireOpenAiKey() {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  return OPENAI_API_KEY
}

function dedupeTags(tags: string[]) {
  const normalized = tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 8)

  return Array.from(new Set(normalized))
}

export async function transcribeAudioFile(
  file: File,
  options: {
    language?: string
    prompt?: string
  } = {},
): Promise<TranscriptionResult> {
  const apiKey = requireOpenAiKey()
  const formData = new FormData()
  formData.append('file', file, file.name || 'voice-capture.webm')
  formData.append('model', 'gpt-4o-transcribe')
  formData.append('language', options.language || 'pt')
  formData.append(
    'prompt',
    options.prompt || 'Transcreva em portugues brasileiro, com pontuacao natural, sem repetir trechos.',
  )
  formData.append('response_format', 'json')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json() as Record<string, unknown> & { text?: string }
  const text = typeof data.text === 'string' ? data.text.trim() : ''

  if (!text) {
    throw new Error('OpenAI returned an empty transcription')
  }

  return {
    text,
    rawResponse: data,
  }
}

function normalizeIdeaPayload(payload: unknown): MaterializedIdeaResult {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('A IA devolveu um payload invalido para materializacao')
  }

  const value = payload as {
    cleanedText?: unknown
    suggestedTitle?: unknown
    suggestedTags?: unknown
    suggestedFolder?: unknown
  }

  const cleanedText = typeof value.cleanedText === 'string' ? value.cleanedText.trim() : ''
  const suggestedTitle = typeof value.suggestedTitle === 'string' ? value.suggestedTitle.trim() : ''
  const suggestedTags = Array.isArray(value.suggestedTags)
    ? value.suggestedTags.filter((item): item is string => typeof item === 'string')
    : []

  if (!cleanedText) {
    throw new Error('A IA nao devolveu texto limpo para o draft')
  }

  if (!suggestedTitle) {
    throw new Error('A IA nao devolveu titulo para o draft')
  }

  return {
    cleanedText,
    suggestedTitle,
    suggestedTags: dedupeTags(suggestedTags),
    suggestedFolder: typeof value.suggestedFolder === 'string' && value.suggestedFolder.trim().length > 0
      ? value.suggestedFolder.trim()
      : null,
  }
}

export async function materializeIdeaDraftFromTranscript(args: {
  transcriptText: string
  platformSource: 'web' | 'macos' | 'android' | 'ios'
}) {
  const apiKey = requireOpenAiKey()

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Voce recebe uma transcricao de voz em portugues brasileiro e deve materializar um rascunho de ideia util.

Regras:
- preserve a ideia central sem inventar funcionalidades
- limpe repeticoes e hesitacoes sem apagar o sentido
- proponha um titulo curto e claro
- proponha de 0 a 6 tags concretas
- se fizer sentido, proponha uma pasta sintetica
- responda apenas com JSON valido

Formato obrigatorio:
{
  "cleanedText": "texto limpo",
  "suggestedTitle": "titulo curto",
  "suggestedTags": ["tag1", "tag2"],
  "suggestedFolder": "pasta ou null"
}`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            platformSource: args.platformSource,
            transcriptText: args.transcriptText,
          }),
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }
  const content = data.choices?.[0]?.message?.content?.trim()

  if (!content) {
    throw new Error('OpenAI returned an empty materialization payload')
  }

  const parsed = JSON.parse(content) as unknown
  return normalizeIdeaPayload(parsed)
}
