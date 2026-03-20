import type { OrganizedContent, OrganizedIdea, OrganizationType, SharedOrganizedIdea } from '../types/database'

const VALID_TYPES: OrganizationType[] = ['topicos', 'plano', 'roteiro', 'mapa']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeOrganizedContent(content: unknown): OrganizedContent {
  const rawContent = isRecord(content) ? content : {}
  const rawSections = Array.isArray(rawContent.sections) ? rawContent.sections : []

  const sections = rawSections
    .filter(isRecord)
    .map((section) => {
      const title = typeof section.title === 'string'
        ? section.title.trim()
        : typeof section.heading === 'string'
          ? section.heading.trim()
          : 'Secao'

      const items = Array.isArray(section.items)
        ? section.items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []

      return {
        title: title || 'Secao',
        items,
      }
    })
    .filter((section) => section.items.length > 0)

  return {
    sections,
    summary: typeof rawContent.summary === 'string' && rawContent.summary.trim()
      ? rawContent.summary.trim()
      : undefined,
  }
}

function normalizeTags(tags: unknown): string[] | null {
  if (!Array.isArray(tags)) return null

  const nextTags = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean)

  return nextTags.length > 0 ? nextTags : null
}

export function normalizeOrganizedIdea(input: unknown): OrganizedIdea | null {
  if (!isRecord(input)) return null

  const id = typeof input.id === 'string' ? input.id : null
  const userId = typeof input.user_id === 'string' ? input.user_id : null
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : null
  const createdAt = typeof input.created_at === 'string' ? input.created_at : new Date().toISOString()
  const type = typeof input.type === 'string' && VALID_TYPES.includes(input.type as OrganizationType)
    ? input.type as OrganizationType
    : 'topicos'

  if (!id || !userId || !title) return null

  return {
    id,
    user_id: userId,
    note_ids: Array.isArray(input.note_ids)
      ? input.note_ids.filter((noteId): noteId is string => typeof noteId === 'string')
      : [],
    type,
    title,
    tags: normalizeTags(input.tags),
    content: normalizeOrganizedContent(input.content),
    created_at: createdAt,
  }
}

export function normalizeSharedOrganizedIdea(input: unknown): SharedOrganizedIdea | null {
  const baseIdea = normalizeOrganizedIdea(input)
  if (!baseIdea || !isRecord(input)) return null

  const shareId = typeof input.share_id === 'string' ? input.share_id : null
  const sharedAt = typeof input.shared_at === 'string' ? input.shared_at : baseIdea.created_at
  const sharedByUserId = typeof input.shared_by_user_id === 'string' ? input.shared_by_user_id : ''

  if (!shareId) return null

  return {
    ...baseIdea,
    share_id: shareId,
    shared_at: sharedAt,
    shared_by_user_id: sharedByUserId,
  }
}

export function matchesOrganizedIdeaSearch(
  idea: OrganizedIdea,
  query: string,
  options?: {
    tags?: string[]
    folders?: string[]
  },
) {
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  if (!normalizedQuery) return true

  const searchText = [
    idea.title,
    idea.content.summary || '',
    ...idea.content.sections.map((section) => section.title),
    ...idea.content.sections.flatMap((section) => section.items),
    ...(options?.tags || []),
    ...(options?.folders || []),
  ]
    .join(' ')
    .toLocaleLowerCase('pt-BR')

  return searchText.includes(normalizedQuery)
}
