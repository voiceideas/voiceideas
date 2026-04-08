import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import type { OrganizationType, OrganizedContent, OrganizedTransparency } from '../types/database'
import { DEFAULT_LOCALE, formatWithLocale, type AppLocale } from './i18n'
import { getAuthenticatedFunctionHeaders } from './functionAuth'
import { isSupabaseConfigured, supabase } from './supabase'

const TYPE_LABELS: Record<AppLocale, Record<Exclude<OrganizationType, 'topicos'>, string>> = {
  'pt-BR': {
    plano: 'Plano de Ação',
    roteiro: 'Roteiro',
    mapa: 'Mapa de Ideias',
  },
  en: {
    plano: 'Action Plan',
    roteiro: 'Outline',
    mapa: 'Idea Map',
  },
  es: {
    plano: 'Plan de Acción',
    roteiro: 'Guion',
    mapa: 'Mapa de Ideas',
  },
}

const TOPICOS_LABELS: Record<AppLocale, { single: string; multiple: string }> = {
  'pt-BR': {
    single: 'Ideia Organizada',
    multiple: 'Ideia Consolidada',
  },
  en: {
    single: 'Organized Idea',
    multiple: 'Consolidated Idea',
  },
  es: {
    single: 'Idea Organizada',
    multiple: 'Idea Consolidada',
  },
}

const TYPE_PROMPTS: Record<AppLocale, Record<Exclude<OrganizationType, 'topicos'>, string>> = {
  'pt-BR': {
    plano: 'Converta as notas em um plano de ação fiel ao que foi dito. Destaque prioridades, próximos passos, dependências, dúvidas e decisões explícitas, sem inventar etapas que não estejam sugeridas no material.',
    roteiro: 'Organize as ideias em uma sequência coerente, preservando a progressão natural do raciocínio original. Se houver fases, versões, experimentos ou entregas, mantenha isso explícito na estrutura.',
    mapa: 'Mapeie conceitos, conexões, dependências e agrupamentos reais das notas. Use nomes específicos das ideias e mostre relações concretas, sem preencher com categorias vagas.',
  },
  en: {
    plano: 'Turn the notes into an action plan that stays faithful to what was said. Highlight priorities, next steps, dependencies, open questions, and explicit decisions without inventing steps that are not suggested by the material.',
    roteiro: 'Organize the ideas into a coherent sequence while preserving the natural progression of the original reasoning. If there are phases, versions, experiments, or deliverables, keep that explicit in the structure.',
    mapa: 'Map concepts, connections, dependencies, and real groupings from the notes. Use specific names for ideas and show concrete relationships instead of filling the output with vague categories.',
  },
  es: {
    plano: 'Convierte las notas en un plan de acción fiel a lo dicho. Destaca prioridades, próximos pasos, dependencias, dudas y decisiones explícitas, sin inventar etapas que no estén sugeridas por el material.',
    roteiro: 'Organiza las ideas en una secuencia coherente, preservando la progresión natural del razonamiento original. Si hay fases, versiones, experimentos o entregables, mantenlo explícito en la estructura.',
    mapa: 'Mapea conceptos, conexiones, dependencias y agrupaciones reales de las notas. Usa nombres específicos para las ideas y muestra relaciones concretas, sin rellenar con categorías vagas.',
  },
}

function getTopicosPrompt(noteCount: number, locale: AppLocale) {
  if (locale === 'en') {
    if (noteCount >= 2) {
      return 'Merge related notes into a coherent consolidated idea. Concatenate fragments that discuss the same topic, remove obvious redundancy, preserve relevant differences between notes, and keep product names, features, versions, and key terms exactly as they appear. When the material supports it, prefer a structure with a main synthesis, combined points, preserved differences or tensions, and next paths.'
    }

    return 'Organize a single note into a clearer, more useful structure while staying faithful to what was said. Preserve nuance, open decisions, key terms, and any internal tension within the note itself. When the material supports it, prefer a structure with a main synthesis, key points, differences or cautions, and next paths.'
  }

  if (locale === 'es') {
    if (noteCount >= 2) {
      return 'Une notas relacionadas en una idea consolidada y coherente. Concatena fragmentos que tratan del mismo asunto, elimina redundancias obvias, preserva diferencias relevantes entre las notas y mantén nombres de producto, funcionalidades, versiones y términos clave exactamente como aparecen. Cuando el material lo permita, prefiere una estructura con síntesis principal, puntos combinados, diferencias o tensiones preservadas y próximos caminos.'
    }

    return 'Organiza una sola nota en una estructura más clara, útil y fiel a lo dicho. Preserva matices, decisiones abiertas, términos clave y cualquier tensión interna de la propia nota. Cuando el material lo permita, prefiere una estructura con síntesis principal, puntos centrales, diferencias o cuidados y próximos caminos.'
  }

  if (noteCount >= 2) {
    return 'Una notas relacionadas em uma ideia consolidada e coerente. Concatene fragmentos que tratam do mesmo assunto, remova redundâncias óbvias, preserve diferenças relevantes entre as notas e mantenha nomes de produto, funcionalidades, versões e termos-chave exatamente como aparecem. Quando houver material suficiente, prefira uma estrutura com síntese principal, pontos combinados, diferenças ou tensões preservadas e próximos caminhos.'
  }

  return 'Organize uma única nota em uma estrutura mais clara, útil e fiel ao que foi dito. Preserve nuances, decisões em aberto, termos-chave e qualquer tensão interna da própria nota. Quando houver material suficiente, prefira uma estrutura com síntese principal, pontos centrais, diferenças ou cuidados e próximos caminhos.'
}

function buildSystemPrompt(locale: AppLocale, typePrompt: string) {
  if (locale === 'en') {
    return `You are an assistant that organizes ideas and notes in English.
${typePrompt}

QUALITY RULES:
- Work only with information present in the notes.
- Do not invent generic sections like marketing, monetization, or technology if that is not in the material.
- Preserve proper names, features, versions, and important expressions exactly as they appear.
- If versions or releases are mentioned, such as v0.2, keep that explicit in the result.
- If the input is short, produce a short structure. A good answer may have 1 to 4 sections.
- Every item must be specific, useful, and faithful to the original text.

IMPORTANT: Reply ONLY with valid JSON in the format below, with no markdown and no code blocks:
{
  "title": "Descriptive title for the result",
  "content": {
    "summary": "Optional overall summary",
    "sections": [
      {
        "title": "Section name",
        "items": ["Item 1", "Item 2", "Item 3"]
      }
    ],
    "transparency": {
      "combined": ["What was combined from the notes"],
      "preservedDifferences": ["Differences, tensions, or contradictions that stayed explicit"],
      "inferredStructure": ["Only light structural choices made by the AI"]
    }
  }
}`
  }

  if (locale === 'es') {
    return `Eres un asistente que organiza ideas y notas en español.
${typePrompt}

REGLAS DE CALIDAD:
- Trabaja solo con información presente en las notas.
- No inventes secciones genéricas como marketing, monetización o tecnología si eso no está en el material.
- Preserva nombres propios, funcionalidades, versiones y expresiones importantes exactamente como aparecen.
- Si hay mención de versiones o releases, como v0.2, mantenlo explícito en el resultado.
- Si la entrada es corta, produce una estructura corta. Una buena respuesta puede tener de 1 a 4 secciones.
- Cada ítem debe ser específico, útil y fiel al texto original.

IMPORTANTE: Responde SOLO con JSON válido en el formato siguiente, sin markdown y sin bloques de código:
{
  "title": "Título descriptivo del resultado",
  "content": {
    "summary": "Resumen general opcional",
    "sections": [
      {
        "title": "Nombre de la sección",
        "items": ["Ítem 1", "Ítem 2", "Ítem 3"]
      }
    ],
    "transparency": {
      "combined": ["Qué se combinó entre las notas"],
      "preservedDifferences": ["Diferencias, tensiones o contradicciones mantenidas explícitamente"],
      "inferredStructure": ["Solo elecciones leves de organización hechas por la IA"]
    }
  }
}`
  }

  return `Você é um assistente que organiza ideias e notas em português brasileiro.
${typePrompt}

REGRAS DE QUALIDADE:
- Trabalhe apenas com informações presentes nas notas.
- Não invente seções genéricas como marketing, monetização ou tecnologia se isso não estiver no material.
- Preserve nomes próprios, funcionalidades, versões e expressões importantes exatamente como aparecem.
- Se houver menção a versões ou releases, como v0.2, mantenha isso explicitamente no resultado.
- Se a entrada for curta, produza uma estrutura curta. Uma boa resposta pode ter de 1 a 4 seções.
- Cada item deve ser específico, útil e fiel ao texto original.

IMPORTANTE: Responda APENAS com JSON válido no formato abaixo, sem markdown, sem code blocks:
{
  "title": "Título descritivo do resultado",
  "content": {
    "summary": "Resumo geral opcional",
    "sections": [
      {
        "title": "Nome da seção",
        "items": ["Item 1", "Item 2", "Item 3"]
      }
    ],
    "transparency": {
      "combined": ["O que foi combinado entre as notas"],
      "preservedDifferences": ["Diferenças, tensões ou contradições mantidas explicitamente"],
      "inferredStructure": ["Apenas escolhas leves de organização feitas pela IA"]
    }
  }
}`
}

export function getOrganizationTypeLabel(
  type: OrganizationType,
  noteCount = 1,
  locale: AppLocale = DEFAULT_LOCALE,
) {
  if (type === 'topicos') {
    return noteCount >= 2 ? TOPICOS_LABELS[locale].multiple : TOPICOS_LABELS[locale].single
  }

  return TYPE_LABELS[locale][type]
}

export function getOrganizationPrompt(
  type: OrganizationType,
  noteCount = 1,
  locale: AppLocale = DEFAULT_LOCALE,
) {
  if (type === 'topicos') {
    return getTopicosPrompt(noteCount, locale)
  }

  return TYPE_PROMPTS[locale][type]
}

export async function organizeWithAI(
  noteTexts: string[],
  type: OrganizationType,
  noteIds: string[] = [],
  locale: AppLocale = DEFAULT_LOCALE,
): Promise<{ title: string; content: OrganizedContent }> {
  if (!isSupabaseConfigured) {
    throw new Error(
      locale === 'en'
        ? 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the .env file.'
        : locale === 'es'
          ? 'Supabase no está configurado. Agrega VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY al archivo .env.'
          : 'Supabase não configurado. Adicione VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env.',
    )
  }

  const noteCount = noteIds.length || noteTexts.length
  const combinedText = noteTexts
    .map((text, index) => `[Note ${index + 1}]: ${text}`)
    .join('\n\n')

  const typePrompt = getOrganizationPrompt(type, noteCount, locale)
  const typeLabel = getOrganizationTypeLabel(type, noteCount, locale)
  const systemPrompt = buildSystemPrompt(locale, typePrompt)

  const requestBody = {
    texts: noteIds.length ? '' : combinedText,
    noteIds,
    type,
    typeLabel,
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
    throw new Error(await resolveOrganizationError(error, locale))
  }

  if (!data) {
    throw new Error(
      locale === 'en'
        ? 'The organization function returned no data.'
        : locale === 'es'
          ? 'La función de organización no devolvió datos.'
          : 'A função de organização não retornou dados.',
    )
  }

  const normalizedContent = normalizeOrganizedContent(data.content)

  if (!data.title || !normalizedContent.sections.length) {
    throw new Error(
      locale === 'en'
        ? 'The AI returned an empty response.'
        : locale === 'es'
          ? 'La IA devolvió una respuesta vacía.'
          : 'Resposta vazia da IA',
    )
  }

  return {
    title: data.title || `${typeLabel} - ${formatWithLocale(locale, new Date())}`,
    content: normalizedContent,
  }
}

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

function normalizeTransparencyItems(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

function normalizeOrganizedTransparency(value: unknown): OrganizedTransparency | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const rawValue = value as {
    combined?: unknown
    combinedPoints?: unknown
    preservedDifferences?: unknown
    differences?: unknown
    tensions?: unknown
    inferredStructure?: unknown
    inferences?: unknown
    organizedByAI?: unknown
  }

  const transparency: OrganizedTransparency = {
    combined: normalizeTransparencyItems(rawValue.combined ?? rawValue.combinedPoints),
    preservedDifferences: normalizeTransparencyItems(
      rawValue.preservedDifferences ?? rawValue.differences ?? rawValue.tensions,
    ),
    inferredStructure: normalizeTransparencyItems(
      rawValue.inferredStructure ?? rawValue.inferences ?? rawValue.organizedByAI,
    ),
  }

  return transparency.combined.length || transparency.preservedDifferences.length || transparency.inferredStructure.length
    ? transparency
    : undefined
}

function mapOrganizationErrorMessage(message: string, locale: AppLocale): string {
  if (message.includes('401')) {
    return locale === 'en'
      ? 'Your session expired. Sign in again to keep organizing ideas.'
      : locale === 'es'
        ? 'Tu sesión expiró. Vuelve a entrar para seguir organizando ideas.'
        : 'Sua sessão expirou. Entre novamente para continuar organizando ideias.'
  }

  if (message.includes('404')) {
    return locale === 'en'
      ? 'The organization function has not been published to Supabase yet.'
      : locale === 'es'
        ? 'La función de organización todavía no fue publicada en Supabase.'
        : 'A função de organização ainda não foi publicada no Supabase.'
  }

  if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('Load failed')) {
    return locale === 'en'
      ? 'Could not send the notes for organization. Check your connection.'
      : locale === 'es'
        ? 'No se pudieron enviar las notas para organizar. Revisa tu conexión.'
        : 'Não foi possível enviar as notas para organização. Verifique sua conexão.'
  }

  if (message.includes('Failed to parse AI response as JSON')) {
    return locale === 'en'
      ? 'The AI returned an invalid organization response. Try again.'
      : locale === 'es'
        ? 'La IA devolvió una respuesta inválida para organizar. Inténtalo de nuevo.'
        : 'A IA devolveu uma resposta inválida para organização. Tente novamente.'
  }

  return message || (
    locale === 'en'
      ? 'Failed to organize ideas.'
      : locale === 'es'
        ? 'No se pudieron organizar las ideas.'
        : 'Falha ao organizar as ideias.'
  )
}

async function resolveOrganizationError(error: unknown, locale: AppLocale) {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response | undefined

    if (response) {
      try {
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const data = await response.clone().json() as { error?: string; message?: string }
          return mapOrganizationErrorMessage(data.error || data.message || `HTTP ${response.status}.`, locale)
        }

        const text = (await response.clone().text()).trim()
        if (text) {
          return mapOrganizationErrorMessage(text, locale)
        }
      } catch {
        return mapOrganizationErrorMessage(`HTTP ${response.status}.`, locale)
      }

      return mapOrganizationErrorMessage(`HTTP ${response.status}.`, locale)
    }
  }

  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return mapOrganizationErrorMessage('Failed to fetch', locale)
  }

  return error instanceof Error
    ? mapOrganizationErrorMessage(error.message, locale)
    : mapOrganizationErrorMessage('', locale)
}

function isRawSection(value: unknown): value is RawSection {
  return typeof value === 'object' && value !== null
}

function normalizeOrganizedContent(content: unknown): OrganizedContent {
  const rawContent = typeof content === 'object' && content !== null
    ? content as { summary?: unknown; sections?: unknown; transparency?: unknown }
    : {}
  const rawSections = Array.isArray(rawContent.sections) ? rawContent.sections : []

  const sections = rawSections
    .filter(isRawSection)
    .map((section) => {
      const title = typeof section.title === 'string'
        ? section.title
        : typeof section.heading === 'string'
          ? section.heading
          : 'Section'
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
    transparency: normalizeOrganizedTransparency(rawContent.transparency),
  }
}
