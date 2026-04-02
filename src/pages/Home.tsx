import { useState } from 'react'
import { VoiceRecorder } from '../components/VoiceRecorder'
import { NotesList } from '../components/NotesList'
import { OrganizePanel } from '../components/OrganizePanel'
import { useNotes } from '../hooks/useNotes'
import { useUserProfile } from '../hooks/useUserProfile'
import { organizeWithAI } from '../lib/organize'
import { buildInitialIdeaTags } from '../lib/organizedTags'
import { supabase } from '../lib/supabase'
import type { OrganizationType } from '../types/database'
import { useNavigate } from 'react-router-dom'

export function Home() {
  const { notes, loading, addNote, deleteNote, updateNote } = useNotes()
  const { todayCount, dailyLimit, remainingToday, canCreateNote, refetch: refetchProfile } = useUserProfile()
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const looseNotes = notes.filter((note) => !note.folder_id)

  const handleSave = async (text: string) => {
    const note = await addNote(text)
    setSaveMessage('Nota salva com sucesso!')
    refetchProfile()
    if (note) {
      setSelectedIds([note.id])
    }
    setTimeout(() => setSaveMessage(null), 3000)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    )
  }

  const handleOrganize = async (type: OrganizationType) => {
    setError(null)
    const selectedNotes = notes.filter((n) => selectedIds.includes(n.id))
    const texts = selectedNotes.map((n) => n.raw_text)

    try {
      const result = await organizeWithAI(texts, type, selectedIds)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Nao autenticado')

      await supabase.from('organized_ideas').insert({
        user_id: user.id,
        note_ids: selectedIds,
        type,
        title: result.title,
        tags: buildInitialIdeaTags(type, result.title, result.content),
        content: result.content,
      })

      setSelectedIds([])
      navigate('/organized')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao organizar')
    }
  }

  const recentNotes = looseNotes.slice(0, 5)

  return (
    <div className="space-y-6">
      <VoiceRecorder onSave={handleSave} canSave={canCreateNote} remainingNotes={remainingToday} todayCount={todayCount} dailyLimit={dailyLimit} />

      {saveMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 text-center">
          {saveMessage}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Painel de organizar aparece quando ha notas selecionadas */}
      <OrganizePanel selectedCount={selectedIds.length} onOrganize={handleOrganize} />

      {recentNotes.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Notas Recentes
          </h2>
          <NotesList
            notes={recentNotes}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onDelete={deleteNote}
            onEdit={async (id, updates) => { await updateNote(id, updates) }}
            loading={loading}
            emptyTitle="Nenhuma nota solta no fluxo geral"
            emptyDescription="Notas que entram em pastas deixam de aparecer aqui."
          />
        </div>
      )}

      {!loading && recentNotes.length === 0 && notes.length > 0 && (
        <div className="rounded-lg border border-slate-300 bg-slate-100 p-4 text-sm text-slate-700">
          Todas as suas notas recentes ja estao organizadas em pastas. O fluxo geral mostra apenas notas sem pasta.
        </div>
      )}
    </div>
  )
}
