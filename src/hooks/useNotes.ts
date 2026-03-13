import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Note } from '../types/database'

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchNotes = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
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

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  const addNote = async (rawText: string, title?: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Nao autenticado')

    const autoTitle = title || rawText.slice(0, 60) + (rawText.length > 60 ? '...' : '')

    const { data, error: insertError } = await supabase
      .from('notes')
      .insert({
        user_id: user.id,
        raw_text: rawText,
        title: autoTitle,
      })
      .select()
      .single()

    if (insertError) throw new Error(insertError.message)
    setNotes((prev) => [(data as Note), ...prev])
    return data as Note
  }

  const deleteNote = async (id: string) => {
    const { error: deleteError } = await supabase
      .from('notes')
      .delete()
      .eq('id', id)

    if (deleteError) throw new Error(deleteError.message)
    setNotes((prev) => prev.filter((n) => n.id !== id))
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

  return { notes, loading, error, addNote, deleteNote, updateNote, refetch: fetchNotes }
}
