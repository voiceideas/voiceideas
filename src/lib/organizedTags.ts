import type { OrganizedContent, OrganizedIdea, OrganizationType } from '../types/database'
import { TYPE_LABELS } from './organize'

const VERSION_REGEX = /\bv\d+(?:\.\d+)*\b/gi

export interface IdeaTag {
  label: string
  count: number
}

interface IdeaTagSource {
  type: OrganizationType
  title: string
  content: OrganizedContent
  tags?: string[] | null
}

export function getIdeaTags(idea: IdeaTagSource): string[] {
  if (idea.tags?.length) {
    return normalizeTagList(idea.tags)
  }

  return deriveIdeaTags(idea)
}

export function buildInitialIdeaTags(type: OrganizationType, title: string, content: OrganizedContent): string[] {
  return deriveIdeaTags({ type, title, content })
}

export function parseTagInput(value: string): string[] {
  return normalizeTagList(value.split(','))
}

export function formatTagInput(tags: string[]): string {
  return normalizeTagList(tags).join(', ')
}

export function normalizeTagList(tags: string[]): string[] {
  return dedupeTags(tags)
}

function deriveIdeaTags(idea: Pick<IdeaTagSource, 'type' | 'title' | 'content'>): string[] {
  const rawTags = [
    TYPE_LABELS[idea.type],
    ...idea.content.sections.map((section) => section.title),
    ...extractVersionTags(idea),
  ]

  return dedupeTags(rawTags)
}

export function getAvailableIdeaTags(ideas: OrganizedIdea[]): IdeaTag[] {
  const counts = new Map<string, number>()

  ideas.forEach((idea) => {
    getIdeaTags(idea).forEach((tag) => {
      counts.set(tag, (counts.get(tag) || 0) + 1)
    })
  })

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.label.localeCompare(b.label, 'pt-BR')
    })
}

function extractVersionTags(idea: Pick<IdeaTagSource, 'title' | 'content'>): string[] {
  const searchArea = [
    idea.title,
    idea.content.summary || '',
    ...idea.content.sections.map((section) => section.title),
    ...idea.content.sections.flatMap((section) => section.items),
    ...(idea.content.transparency?.combined || []),
    ...(idea.content.transparency?.preservedDifferences || []),
    ...(idea.content.transparency?.inferredStructure || []),
  ].join(' ')

  return Array.from(searchArea.matchAll(VERSION_REGEX), (match) => match[0].toLowerCase())
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const normalizedTags: string[] = []

  tags.forEach((tag) => {
    const normalized = normalizeTag(tag)
    if (!normalized) return

    const key = normalized.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) return

    seen.add(key)
    normalizedTags.push(normalized)
  })

  return normalizedTags
}

function normalizeTag(tag: string): string {
  return tag
    .replace(/\s+/g, ' ')
    .trim()
}
