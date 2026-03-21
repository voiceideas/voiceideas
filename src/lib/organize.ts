import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import type { OrganizationType, OrganizedContent } from '../types/database'
import { getAuthenticatedFunctionHeaders } from './functionAuth'
import { isSupabaseConfigured, supabase } from './supabase'

const TYPE_LABELS: Record<OrganizationType, string> = {
  topicos: 'Tópicos',
  plano: 'Plano de Ação',
  roteiro: 'Roteiro',
  mapa: 'Mapa de Ideias',
}

const TYPE_PROMPTS: Record<OrganizationType, string> = {
  topicos: `Agrupe as ideias apenas pelos temas que realmente aparecem nas notas. Preserve nomes de produto, funcionalidades, versoes e termos-chave do texto original. Evite categorias genericas e transforme cada item em uma ideia concreta e reaproveitavel.`,
  plano: `Converta as notas em um plano de acao fiel ao que foi dito. Destaque prioridades, proximos passos, dependencias, duvidas e decisoes explicitas, sem inventar etapas que nao estejam sugeridas no material.`,
  roteiro: `Organize as ideias em uma sequencia coerente, preservando a progressao natural do raciocinio original. Se houver fases, versoes, experimentos ou entregas, mantenha isso explicito na estrutura.`,
  mapa: `Mapeie conceitos, conexoes, dependencias e agrupamentos reais das notas. Use nomes especificos das ideias e mostre relacoes concretas, sem preencher com categorias vagas.`,
}

export async function organizeWithAI(
  noteTexts: string[],
  type: OrganizationType,
  noteIds: string[] = [],
): Promise<{ title: string; content: OrganizedContent }> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase nao configurado. Adicione VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env')
  }

  const combinedText = noteTexts
    .map((text, i) => `[Nota ${i + 1}]: ${text}`)
    .join('\n\n')

  const systemPrompt = `Você é um assistente que organiza ideias e notas em português brasileiro.
${TYPE_PROMPTS[type]}

REGRAS DE QUALIDADE:
- Trabalhe apenas com informacoes presentes nas notas.
- Nao invente secoes genericas como marketing, monetizacao ou tecnologia se isso nao estiver no material.
- Preserve nomes proprios, funcionalidades, versoes e expressoes importantes exatamente como aparecem.
- Se houver mencao a versoes ou releases, como v0.2, mantenha isso explicitamente no resultado.
- Se a entrada for curta, produza uma estrutura curta. Uma boa resposta pode ter de 1 a 4 secoes.
- Cada item deve ser especifico, util e fiel ao texto original.

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

  const requestBody = {
    texts: noteIds.length ? '' : combinedText,
    noteIds,
    type,
    typeLabel: TYPE_LABELS[type],
    systemPrompt,
  }

  let { data, error } = await supabase.functions.invoke<OrganizeResponse>('organize', {
    headers: await getAuthenticatedFunctionHeaders({
      'Content-Type': 'application/json',
    }),
    body: requestBody,
  })

  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response | undefined
    if (response?.status === 401) {
      const retry = await supabase.functions.invoke<OrganizeResponse>('organize', {
        headers: await getAuthenticatedFunctionHeaders({
          'Content-Type': 'application/json',
        }, { forceRefresh: true }),
        body: requestBody,
      })
      data = retry.data
      error = retry.error
    }
  }

  if (error) {
    throw new Error(await resolveOrganizationError(error))
  }

  if (!data) {
    throw new Error('A funcao de organizacao nao retornou dados.')
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

function mapOrganizationErrorMessage(message: string): string {
  if (message.includes('401')) {
    return 'Sua sessao expirou. Entre novamente para continuar organizando ideias.'
  }

  if (message.includes('404')) {
    return 'A funcao de organizacao ainda nao foi publicada no Supabase.'
  }

  if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('Load failed')) {
    return 'Nao foi possivel enviar as notas para organizacao. Verifique sua conexao.'
  }

  if (message.includes('Failed to parse AI response as JSON')) {
    return 'A IA devolveu uma resposta invalida para organizacao. Tente novamente.'
  }

  return message || 'Falha ao organizar as ideias.'
}

async function resolveOrganizationError(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response | undefined

    if (response) {
      try {
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const data = await response.clone().json() as { error?: string; message?: string }
          return mapOrganizationErrorMessage(data.error || data.message || `Falha HTTP ${response.status}.`)
        }

        const text = (await response.clone().text()).trim()
        if (text) {
          return mapOrganizationErrorMessage(text)
        }
      } catch {
        return mapOrganizationErrorMessage(`Falha HTTP ${response.status}.`)
      }

      return mapOrganizationErrorMessage(`Falha HTTP ${response.status}.`)
    }
  }

  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return 'Nao foi possivel enviar as notas para organizacao. Verifique sua conexao.'
  }

  return error instanceof Error ? mapOrganizationErrorMessage(error.message) : 'Falha ao organizar as ideias.'
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
