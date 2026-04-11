import { useState, useEffect, useCallback, useEffectEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Note } from '../types/database'
import { isRejectedAccessTokenError, requireAuthenticatedUser } from '../services/serviceAuth'

type CreateNoteRpcResult = Note | Note[] | null
type NoteSourceMetadata = {
  sourceCaptureSessionId?: string | null
  sourceAudioChunkId?: string | null
}

export interface CreateCapturedNoteInput extends NoteSourceMetadata {
  rawText: string
  title?: string | null
}

export interface UpsertCapturedNoteResult {
  note: Note
  existed: boolean
}

function normalizeCreatedNote(payload: CreateNoteRpcResult): Note | null {
  if (!payload) return null
  return Array.isArray(payload) ? payload[0] || null : payload
}

function shouldFallbackToLegacyCreateNote(message: string) {
  return (
    message.includes('create_note_with_limit') ||
    message.includes('create_note_from_capture_source') ||
    message.includes('PGRST202') ||
    message.includes('Could not find the function')
  )
}

async function invokeCreateNoteRpc(
  functionName: string,
  rpcArgs: Record<string, unknown>,
) {
  await requireAuthenticatedUser()

  let result = await supabase.rpc(functionName, rpcArgs)

  if (result.error && isRejectedAccessTokenError(result.error)) {
    await requireAuthenticatedUser({ forceRefresh: true })
    result = await supabase.rpc(functionName, rpcArgs)
  }

  return result
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchNotes = useCallback(async () => {
    setLoading(true)
    setError(null)

    const user = await requireAuthenticatedUser().catch(() => null)
    if (!user) {
      setNotes([])
      setLoading(false)
      return
    }

    const { data, error: fetchError } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setNotes((data as Note[]) || [])
    }
    setLoading(false)
  }, [])

  const fetchNotesEvent = useEffectEvent(fetchNotes)

  useEffect(() => {
    void fetchNotesEvent()
  }, [])

  const upsertLocalNote = (note: Note) => {
    setNotes((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === note.id)
      if (existingIndex === -1) {
        return [note, ...prev]
      }

      const next = [...prev]
      next[existingIndex] = note
      return next
    })
  }

  const findExistingSourceNote = (source?: NoteSourceMetadata) => {
    if (source?.sourceAudioChunkId) {
      return notes.find((note) => note.source_audio_chunk_id === source.sourceAudioChunkId) ?? null
    }

    if (source?.sourceCaptureSessionId) {
      return notes.find((note) =>
        note.source_capture_session_id === source.sourceCaptureSessionId
        && !note.source_audio_chunk_id,
      ) ?? null
    }

    return null
  }

  const createNoteLegacy = async (rawText: string, title?: string | null, source?: NoteSourceMetadata) => {
    const user = await requireAuthenticatedUser()

    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('id, daily_limit, notes_used_today, usage_date')
      .eq('user_id', user.id)
      .single()

    if (profileData) {
      const today = new Date().toISOString().slice(0, 10)
      let usedToday = profileData.notes_used_today || 0

      if (profileData.usage_date !== today) {
        usedToday = 0
      }

      if (usedToday >= profileData.daily_limit) {
        throw new Error(`Limite diario atingido (${profileData.daily_limit} notas). Tente novamente amanha.`)
      }

      await supabase
        .from('user_profiles')
        .update({
          notes_used_today: usedToday + 1,
          usage_date: today,
        })
        .eq('id', profileData.id)
    }

    const autoTitle = title || rawText.slice(0, 60) + (rawText.length > 60 ? '...' : '')

    const { data, error: insertError } = await supabase
      .from('notes')
      .insert({
        user_id: user.id,
        raw_text: rawText,
        title: autoTitle,
        source_capture_session_id: source?.sourceCaptureSessionId ?? null,
        source_audio_chunk_id: source?.sourceAudioChunkId ?? null,
      })
      .select()
      .single()

    if (insertError) throw new Error(insertError.message)
    return data as Note
  }

  const createNoteResult = async (
    rawText: string,
    title?: string | null,
    source?: NoteSourceMetadata,
  ): Promise<UpsertCapturedNoteResult> => {
    const existingNote = findExistingSourceNote(source)
    if (existingNote) {
      return {
        note: existingNote,
        existed: true,
      }
    }

    const functionName = source?.sourceAudioChunkId || source?.sourceCaptureSessionId
      ? 'create_note_from_capture_source'
      : 'create_note_with_limit'

    const rpcArgs = functionName === 'create_note_from_capture_source'
      ? {
          p_raw_text: rawText,
          p_title: title ?? null,
          p_source_capture_session_id: source?.sourceCaptureSessionId ?? null,
          p_source_audio_chunk_id: source?.sourceAudioChunkId ?? null,
        }
      : {
          p_raw_text: rawText,
          p_title: title ?? null,
        }

    const { data, error: rpcError } = await invokeCreateNoteRpc(functionName, rpcArgs)

    let createdNote: Note | null = null

    if (rpcError) {
      if (!shouldFallbackToLegacyCreateNote(rpcError.message)) {
        throw new Error(rpcError.message)
      }

      createdNote = await createNoteLegacy(rawText, title, source)
    } else {
      createdNote = normalizeCreatedNote(data as CreateNoteRpcResult)
      if (!createdNote) {
        throw new Error('A criacao da nota nao retornou os dados esperados.')
      }
    }

    upsertLocalNote(createdNote)
    return {
      note: createdNote,
      existed: false,
    }
  }

  const createNote = async (
    rawText: string,
    title?: string | null,
    source?: NoteSourceMetadata,
  ) => {
    const result = await createNoteResult(rawText, title, source)
    return result.note
  }

  const addNote = async (rawText: string, title?: string) => createNote(rawText, title)

  const addCapturedNote = async (input: CreateCapturedNoteInput) =>
    createNote(input.rawText, input.title ?? null, {
      sourceCaptureSessionId: input.sourceCaptureSessionId ?? null,
      sourceAudioChunkId: input.sourceAudioChunkId ?? null,
    })

  const upsertCapturedNote = async (input: CreateCapturedNoteInput) =>
    createNoteResult(input.rawText, input.title ?? null, {
      sourceCaptureSessionId: input.sourceCaptureSessionId ?? null,
      sourceAudioChunkId: input.sourceAudioChunkId ?? null,
    })

  const deleteNote = async (id: string) => {
    const { error: deleteError } = await supabase
      .from('notes')
      .delete()
      .eq('id', id)

    if (deleteError) throw new Error(deleteError.message)
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  const deleteMultiple = async (ids: string[]) => {
    if (ids.length === 0) return
    const { error: deleteError } = await supabase
      .from('notes')
      .delete()
      .in('id', ids)

    if (deleteError) throw new Error(deleteError.message)
    setNotes((prev) => prev.filter((n) => !ids.includes(n.id)))
  }

  const deleteAll = async () => {
    const user = await requireAuthenticatedUser()

    const { error: deleteError } = await supabase
      .from('notes')
      .delete()
      .eq('user_id', user.id)

    if (deleteError) throw new Error(deleteError.message)
    setNotes([])
  }

  const updateNote = async (id: string, updates: { raw_text?: string; title?: string }) => {
    const { data, error: updateError } = await supabase
      .from('notes')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw new Error(updateError.message)
    setNotes((prev) => prev.map((n) => (n.id === id ? (data as Note) : n)))
    return data as Note
  }

  return {
    notes,
    loading,
    error,
    addNote,
    addCapturedNote,
    upsertCapturedNote,
    deleteNote,
    deleteMultiple,
    deleteAll,
    updateNote,
    refetch: fetchNotes,
  }
}
