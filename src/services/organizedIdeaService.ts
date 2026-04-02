import { organizeWithAI } from '../lib/organize'
import { normalizeOrganizedIdea } from '../lib/organizedIdeas'
import { buildInitialIdeaTags } from '../lib/organizedTags'
import { supabase } from '../lib/supabase'
import type { Note, OrganizedIdea, OrganizationType, SourceNotePreview } from '../types/database'

type SelectedNoteInput = Pick<Note, 'id' | 'raw_text' | 'title' | 'created_at'>

export async function createOrganizedIdeaFromNotes(
  notes: SelectedNoteInput[],
  type: OrganizationType,
): Promise<OrganizedIdea> {
  if (notes.length < 2) {
    throw new Error('Selecione pelo menos duas notas para organizar com IA.')
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('Nao autenticado')
  }

  const result = await organizeWithAI(
    notes.map((note) => note.raw_text),
    type,
    notes.map((note) => note.id),
  )

  const { data, error } = await supabase
    .from('organized_ideas')
    .insert({
      user_id: user.id,
      note_ids: notes.map((note) => note.id),
      type,
      title: result.title,
      tags: buildInitialIdeaTags(type, result.title, result.content),
      content: result.content,
    })
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  const idea = normalizeOrganizedIdea(data)
  if (!idea) {
    throw new Error('Nao foi possivel montar a ideia organizada criada.')
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
