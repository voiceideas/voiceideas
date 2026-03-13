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

    // Buscar perfil com controle de uso
    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('id, daily_limit, notes_used_today, usage_date')
      .eq('user_id', user.id)
      .single()

    if (profileData) {
      const today = new Date().toISOString().slice(0, 10)
      let usedToday = profileData.notes_used_today || 0

      // Se o dia mudou, reseta o contador
      if (profileData.usage_date !== today) {
        usedToday = 0
      }

      if (usedToday >= profileData.daily_limit) {
        throw new Error(`Limite diario atingido (${profileData.daily_limit} notas). Tente novamente amanha.`)
      }

      // Incrementar contador (reseta se dia mudou)
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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Nao autenticado')

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

  return { notes, loading, error, addNote, deleteNote, deleteMultiple, deleteAll, updateNote, refetch: fetchNotes }
}
