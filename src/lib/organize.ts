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

type OrganizeMode = 'group_notes' | 'action_plan' | 'outline' | 'idea_map'

function getOrganizeMode(type: OrganizationType): OrganizeMode {
  if (type === 'plano') return 'action_plan'
  if (type === 'roteiro') return 'outline'
  if (type === 'mapa') return 'idea_map'
  return 'group_notes'
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
  const typeLabel = getOrganizationTypeLabel(type, noteCount, locale)

  const requestBody = {
    texts: noteTexts,
    mode: getOrganizeMode(type),
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
