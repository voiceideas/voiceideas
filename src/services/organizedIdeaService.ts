import { organizeWithAI } from '../lib/organize'
import { DEFAULT_LOCALE, type AppLocale } from '../lib/i18n'
import { normalizeOrganizedIdea } from '../lib/organizedIdeas'
import { buildInitialIdeaTags } from '../lib/organizedTags'
import { supabase } from '../lib/supabase'
import { requireAuthenticatedUser } from './serviceAuth'
import type {
  Note,
  OrganizedIdea,
  OrganizedIdeaPreview,
  OrganizationType,
  SourceNotePreview,
} from '../types/database'

export type SelectedNoteInput = Pick<Note, 'id' | 'raw_text' | 'title' | 'created_at'>
type RawOrganizedIdeaPreview = {
  id?: unknown
  title?: unknown
  type?: unknown
  note_ids?: unknown
  created_at?: unknown
}

export async function createOrganizedIdeaFromNotes(
  notes: SelectedNoteInput[],
  type: OrganizationType,
  locale: AppLocale = DEFAULT_LOCALE,
): Promise<OrganizedIdea> {
  if (notes.length < 1) {
    throw new Error(
      locale === 'en'
        ? 'Select at least one note to organize with AI.'
        : locale === 'es'
          ? 'Selecciona por lo menos una nota para organizar con IA.'
          : 'Selecione pelo menos uma nota para organizar com IA.',
    )
  }

  const user = await requireAuthenticatedUser()

  const result = await organizeWithAI(
    notes.map((note) => note.raw_text),
    type,
    notes.map((note) => note.id),
    locale,
  )

  const { data, error } = await supabase
    .from('organized_ideas')
    .insert({
      user_id: user.id,
      note_ids: notes.map((note) => note.id),
      type,
      title: result.title,
      tags: buildInitialIdeaTags(type, result.title, result.content, notes.length, locale),
      content: result.content,
    })
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  const idea = normalizeOrganizedIdea(data)
  if (!idea) {
    throw new Error(
      locale === 'en'
        ? 'Could not assemble the created organized idea.'
        : locale === 'es'
          ? 'No se pudo montar la idea organizada creada.'
          : 'Não foi possível montar a ideia organizada criada.',
    )
  }

  return idea
}

export async function loadSourceNotesForIdeas(
  ideas: OrganizedIdea[],
): Promise<Record<string, SourceNotePreview[]>> {
  const noteIds = Array.from(new Set(ideas.flatMap((idea) => idea.note_ids)))
  if (noteIds.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from('notes')
    .select('id, title, raw_text, created_at')
    .in('id', noteIds)

  if (error) {
    throw new Error(error.message)
  }

  const noteById = new Map(
    ((data as SourceNotePreview[] | null) || []).map((note) => [note.id, note]),
  )

  return Object.fromEntries(
    ideas.map((idea) => [
      idea.id,
      idea.note_ids
        .map((noteId) => noteById.get(noteId))
        .filter((note): note is SourceNotePreview => Boolean(note)),
    ]),
  )
}

function normalizeOrganizedIdeaPreview(input: RawOrganizedIdeaPreview): OrganizedIdeaPreview | null {
  if (typeof input.id !== 'string' || typeof input.title !== 'string' || typeof input.created_at !== 'string') {
    return null
  }

  const type = input.type
  if (type !== 'topicos' && type !== 'plano' && type !== 'roteiro' && type !== 'mapa') {
    return null
  }

  return {
    id: input.id,
    title: input.title.trim() || 'Resultado organizado',
    type,
    created_at: input.created_at,
    note_ids: Array.isArray(input.note_ids)
      ? input.note_ids.filter((noteId): noteId is string => typeof noteId === 'string')
      : [],
  }
}

export async function loadDerivedIdeasForNotes(
  noteIds: string[],
): Promise<Record<string, OrganizedIdeaPreview[]>> {
  const uniqueNoteIds = Array.from(new Set(noteIds))
  if (uniqueNoteIds.length === 0) {
    return {}
  }

  const user = await requireAuthenticatedUser().catch(() => null)
  if (!user) {
    return {}
  }

  const { data, error } = await supabase
    .from('organized_ideas')
    .select('id, title, type, note_ids, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  const noteIdSet = new Set(uniqueNoteIds)
  const ideaPreviews = ((data as RawOrganizedIdeaPreview[] | null) || [])
    .map(normalizeOrganizedIdeaPreview)
    .filter((idea): idea is OrganizedIdeaPreview => Boolean(idea))
    .filter((idea) => idea.note_ids.some((noteId) => noteIdSet.has(noteId)))

  return Object.fromEntries(
    uniqueNoteIds.map((noteId) => [
      noteId,
      ideaPreviews.filter((idea) => idea.note_ids.includes(noteId)),
    ]),
  )
}

export async function findExactOrganizedIdeaForNoteSet(
  noteIds: string[],
  type: OrganizationType,
): Promise<OrganizedIdea | null> {
  const uniqueNoteIds = Array.from(new Set(noteIds))
  if (uniqueNoteIds.length === 0) {
    return null
  }

  const user = await requireAuthenticatedUser()

  const { data, error } = await supabase
    .from('organized_ideas')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', type)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  const expectedNoteSet = new Set(uniqueNoteIds)

  return ((data as unknown[]) || [])
    .map(normalizeOrganizedIdea)
    .filter((idea): idea is OrganizedIdea => Boolean(idea))
    .find((idea) =>
      idea.note_ids.length === uniqueNoteIds.length
      && idea.note_ids.every((noteId) => expectedNoteSet.has(noteId)),
    ) ?? null
}
