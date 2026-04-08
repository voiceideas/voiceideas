import { DEFAULT_LOCALE, type AppLocale } from './i18n'
import type { Note, OrganizedIdea, SourceNotePreview } from '../types/database'
import type {
  BardoBridgeArtifactType,
  BardoBridgeManifest,
  BardoBridgePayload,
  BardoBridgeSection,
  BardoBridgeSourceReference,
} from '../types/bardo'

export const BARDO_BRIDGE_SCHEMA_VERSION: BardoBridgePayload['schemaVersion'] = 'voiceideas.bardo-bridge.v1'

export const BARDO_SUPPORTED_ARTIFACT_TYPES = [
  'raw-note',
  'organized-idea',
  'consolidated-idea',
] as const satisfies readonly BardoBridgeArtifactType[]

export const BARDO_BRIDGE_MANIFEST: BardoBridgeManifest = {
  integrationId: 'bardo',
  schemaVersion: BARDO_BRIDGE_SCHEMA_VERSION,
  supportedArtifactTypes: BARDO_SUPPORTED_ARTIFACT_TYPES,
}

interface BuildBardoPayloadFromNoteOptions {
  locale?: AppLocale
  folderName?: string | null
  tags?: string[]
  preparedAt?: string
}

interface BuildBardoPayloadFromOrganizedIdeaOptions {
  locale?: AppLocale
  folders?: string[]
  tags?: string[]
  sourceNotes?: SourceNotePreview[]
  preparedAt?: string
}

function getUntitledNoteLabel(locale: AppLocale) {
  if (locale === 'en') return 'Untitled note'
  if (locale === 'es') return 'Nota sin titulo'
  return 'Nota sem titulo'
}

function getFallbackOrganizedTitle(type: BardoBridgeArtifactType, locale: AppLocale) {
  if (locale === 'en') {
    return type === 'consolidated-idea' ? 'Consolidated idea' : 'Organized idea'
  }

  if (locale === 'es') {
    return type === 'consolidated-idea' ? 'Idea consolidada' : 'Idea organizada'
  }

  return type === 'consolidated-idea' ? 'Ideia consolidada' : 'Ideia organizada'
}

function getRawTextSectionTitle(locale: AppLocale) {
  if (locale === 'en') return 'Raw text'
  if (locale === 'es') return 'Texto bruto'
  return 'Texto bruto'
}

function summarizeText(text: string, maxLength = 180) {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) return null
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trimEnd()}...`
}

function normalizeStringList(values: string[]) {
  const normalizedValues: string[] = []
  const seen = new Set<string>()

  values.forEach((value) => {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized) return

    const key = normalized.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) return

    seen.add(key)
    normalizedValues.push(normalized)
  })

  return normalizedValues
}

function buildPlainText(title: string, summary: string | null, sections: BardoBridgeSection[]) {
  const blocks = [
    title.trim(),
    summary?.trim() || null,
    ...sections.map((section) => [section.title.trim(), ...section.items.map((item) => item.trim())]
      .filter(Boolean)
      .join('\n')),
  ].filter((value): value is string => Boolean(value))

  return blocks.join('\n\n').trim()
}

function getBardoArtifactTypeForIdea(idea: OrganizedIdea): BardoBridgeArtifactType {
  return idea.note_ids.length > 1 ? 'consolidated-idea' : 'organized-idea'
}

function buildNoteSourceReferences(note: Note): BardoBridgeSourceReference[] {
  const references: BardoBridgeSourceReference[] = [
    {
      kind: 'note',
      id: note.id,
      title: note.title,
    },
  ]

  if (note.source_capture_session_id) {
    references.push({
      kind: 'capture-session',
      id: note.source_capture_session_id,
      title: null,
    })
  }

  if (note.source_audio_chunk_id) {
    references.push({
      kind: 'audio-chunk',
      id: note.source_audio_chunk_id,
      title: null,
    })
  }

  return references
}

function buildIdeaSourceReferences(sourceNotes: SourceNotePreview[], noteIds: string[]): BardoBridgeSourceReference[] {
  if (sourceNotes.length > 0) {
    return sourceNotes.map((note) => ({
      kind: 'note',
      id: note.id,
      title: note.title,
    }))
  }

  return noteIds.map((noteId) => ({
    kind: 'note',
    id: noteId,
    title: null,
  }))
}

export function buildBardoBridgePayloadFromNote(
  note: Note,
  options: BuildBardoPayloadFromNoteOptions = {},
): BardoBridgePayload {
  const locale = options.locale ?? DEFAULT_LOCALE
  const title = note.title?.trim() || summarizeText(note.raw_text, 60) || getUntitledNoteLabel(locale)
  const sections: BardoBridgeSection[] = [
    {
      title: getRawTextSectionTitle(locale),
      items: [note.raw_text],
    },
  ]

  return {
    schemaVersion: BARDO_BRIDGE_SCHEMA_VERSION,
    sourceApp: 'voiceideas',
    targetApp: 'bardo',
    locale,
    preparedAt: options.preparedAt ?? new Date().toISOString(),
    artifact: {
      id: note.id,
      type: 'raw-note',
      title,
      summary: summarizeText(note.raw_text),
      plainText: note.raw_text.trim(),
      tags: normalizeStringList(options.tags ?? []),
      folders: normalizeStringList(options.folderName ? [options.folderName] : []),
      createdAt: note.created_at,
      sourceNoteIds: [note.id],
      sections,
      sourceReferences: buildNoteSourceReferences(note),
      metadata: {
        origin: 'note',
        noteCount: 1,
        organizationType: null,
      },
    },
  }
}

export function buildBardoBridgePayloadFromOrganizedIdea(
  idea: OrganizedIdea,
  options: BuildBardoPayloadFromOrganizedIdeaOptions = {},
): BardoBridgePayload {
  const locale = options.locale ?? DEFAULT_LOCALE
  const artifactType = getBardoArtifactTypeForIdea(idea)
  const sections = idea.content.sections.map((section) => ({
    title: section.title,
    items: section.items,
  }))
  const title = idea.title.trim() || getFallbackOrganizedTitle(artifactType, locale)
  const tags = normalizeStringList(options.tags ?? idea.tags ?? [])
  const folders = normalizeStringList(options.folders ?? [])

  return {
    schemaVersion: BARDO_BRIDGE_SCHEMA_VERSION,
    sourceApp: 'voiceideas',
    targetApp: 'bardo',
    locale,
    preparedAt: options.preparedAt ?? new Date().toISOString(),
    artifact: {
      id: idea.id,
      type: artifactType,
      title,
      summary: idea.content.summary?.trim() || null,
      plainText: buildPlainText(title, idea.content.summary?.trim() || null, sections),
      tags,
      folders,
      createdAt: idea.created_at,
      sourceNoteIds: idea.note_ids,
      sections,
      sourceReferences: buildIdeaSourceReferences(options.sourceNotes ?? [], idea.note_ids),
      metadata: {
        origin: 'organized-idea',
        noteCount: idea.note_ids.length,
        organizationType: idea.type,
      },
    },
  }
}
