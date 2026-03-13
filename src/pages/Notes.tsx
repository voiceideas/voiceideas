import { useState, useCallback } from 'react'
import { Search } from 'lucide-react'
import { NotesList } from '../components/NotesList'
import { OrganizePanel } from '../components/OrganizePanel'
import { useNotes } from '../hooks/useNotes'
import { organizeWithAI } from '../lib/organize'
import { supabase } from '../lib/supabase'
import type { OrganizationType } from '../types/database'
import { useNavigate } from 'react-router-dom'

export function Notes() {
  const { notes, loading, deleteNote, updateNote } = useNotes()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    )
  }, [])

  const filteredNotes = search
    ? notes.filter(
        (n) =>
          n.raw_text.toLowerCase().includes(search.toLowerCase()) ||
          n.title?.toLowerCase().includes(search.toLowerCase()),
      )
    : notes

  const handleOrganize = async (type: OrganizationType) => {
    setError(null)
    const selectedNotes = notes.filter((n) => selectedIds.includes(n.id))
    const texts = selectedNotes.map((n) => n.raw_text)

    try {
      const result = await organizeWithAI(texts, type)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Nao autenticado')

      await supabase.from('organized_ideas').insert({
        user_id: user.id,
        note_ids: selectedIds,
        type,
        title: result.title,
        content: result.content,
      })

      setSelectedIds([])
      navigate('/organized')
    } catch (err: any) {
      setError(err.message || 'Erro ao organizar')
    }
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar notas..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
      </div>

      {/* Selection info */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between bg-indigo-50 rounded-lg px-4 py-2">
          <span className="text-sm text-primary font-medium">
            {selectedIds.length} nota{selectedIds.length > 1 ? 's' : ''} selecionada{selectedIds.length > 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setSelectedIds([])}
            className="text-xs text-primary hover:text-primary-dark"
          >
            Limpar selecao
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Organize panel */}
      <OrganizePanel selectedCount={selectedIds.length} onOrganize={handleOrganize} />

      {/* Notes list */}
      <NotesList
        notes={filteredNotes}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onDelete={deleteNote}
        onEdit={async (id, updates) => { await updateNote(id, updates) }}
        loading={loading}
      />
    </div>
  )
}
