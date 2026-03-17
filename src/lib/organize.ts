import type { OrganizationType, OrganizedContent } from '../types/database'
import { isSupabaseConfigured, supabase, supabaseAnonKey, supabaseUrl } from './supabase'

const TYPE_LABELS: Record<OrganizationType, string> = {
  topicos: 'Tópicos',
  plano: 'Plano de Ação',
  roteiro: 'Roteiro',
  mapa: 'Mapa de Ideias',
}

const TYPE_PROMPTS: Record<OrganizationType, string> = {
  topicos: `Agrupe as seguintes ideias por tema. Para cada grupo, crie um título claro e liste os itens relacionados. Identifique padrões e conexões entre as ideias.`,
  plano: `Crie um plano de ação organizado com etapas claras, ordenadas por prioridade. Para cada etapa, inclua uma descrição objetiva do que precisa ser feito.`,
  roteiro: `Organize as ideias em uma sequência lógica e temporal, como um roteiro. Crie seções que fluam naturalmente de uma para outra, formando uma narrativa coerente.`,
  mapa: `Identifique os conceitos principais e mapeie as conexões, dependências e relações entre eles. Agrupe por áreas temáticas e mostre como se interconectam.`,
}

export async function organizeWithAI(
  noteTexts: string[],
  type: OrganizationType,
): Promise<{ title: string; content: OrganizedContent }> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase nao configurado. Adicione VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env')
  }

  const combinedText = noteTexts
    .map((text, i) => `[Nota ${i + 1}]: ${text}`)
    .join('\n\n')

  const systemPrompt = `Você é um assistente que organiza ideias e notas em português brasileiro.
${TYPE_PROMPTS[type]}

IMPORTANTE: Responda APENAS com JSON válido no formato abaixo, sem markdown, sem code blocks:
{
  "title": "Título descritivo do resultado",
  "content": {
    "sections": [
      {
        "title": "Nome da seção",
        "items": ["Item 1", "Item 2", "Item 3"]
      }
    ],
    "summary": "Resumo geral opcional"
  }
}`

  const response = await fetch(getOrganizeEndpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getOrganizationAuthToken()}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      texts: combinedText,
      type,
      typeLabel: TYPE_LABELS[type],
      systemPrompt,
    }),
  })

  const data = await parseOrganizeResponse(response)

  if (!response.ok) {
    throw new Error(mapOrganizationErrorMessage(data.error || `Falha HTTP ${response.status}.`))
  }

  const normalizedContent = normalizeOrganizedContent(data.content)

  if (!data?.title || !normalizedContent.sections.length) {
    throw new Error('Resposta vazia da IA')
  }

  return {
    title: data.title || `${TYPE_LABELS[type]} - ${new Date().toLocaleDateString('pt-BR')}`,
    content: normalizedContent,
  }
}

export { TYPE_LABELS }

interface OrganizeResponse {
  title?: string
  content?: unknown
  error?: string
}

interface RawSection {
  title?: unknown
  heading?: unknown
  items?: unknown
}

function getOrganizeEndpoint(): string {
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/organize`
}

async function getOrganizationAuthToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || supabaseAnonKey
}

async function parseOrganizeResponse(response: Response): Promise<OrganizeResponse> {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    try {
      return await response.json() as OrganizeResponse
    } catch {
      return {}
    }
  }

  try {
    const text = await response.text()
    return text ? { error: text } : {}
  } catch {
    return {}
  }
}

function mapOrganizationErrorMessage(message: string): string {
  if (message.includes('404')) {
    return 'A funcao de organizacao ainda nao foi publicada no Supabase.'
  }

  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'Nao foi possivel enviar as notas para organizacao. Verifique sua conexao.'
  }

  if (message.includes('Failed to parse AI response as JSON')) {
    return 'A IA devolveu uma resposta invalida para organizacao. Tente novamente.'
  }

  return message || 'Falha ao organizar as ideias.'
}

function isRawSection(value: unknown): value is RawSection {
  return typeof value === 'object' && value !== null
}

function normalizeOrganizedContent(content: unknown): OrganizedContent {
  const rawContent = typeof content === 'object' && content !== null
    ? content as { summary?: unknown; sections?: unknown }
    : {}
  const rawSections = Array.isArray(rawContent.sections) ? rawContent.sections : []

  const sections = rawSections
    .filter(isRawSection)
    .map((section) => {
      const title = typeof section.title === 'string'
        ? section.title
        : typeof section.heading === 'string'
          ? section.heading
          : 'Secao'
      const items = Array.isArray(section.items)
        ? section.items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []

      return {
        title,
        items,
      }
    })
    .filter((section) => section.items.length > 0)

  return {
    sections,
    summary: typeof rawContent.summary === 'string' ? rawContent.summary : undefined,
  }
}
