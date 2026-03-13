import { useState, useCallback } from 'react'
import { Search, Trash2, CheckSquare, Square, AlertTriangle } from 'lucide-react'
import { NotesList } from '../components/NotesList'
import { OrganizePanel } from '../components/OrganizePanel'
import { useNotes } from '../hooks/useNotes'
import { organizeWithAI } from '../lib/organize'
import { supabase } from '../lib/supabase'
import type { OrganizationType } from '../types/database'
import { useNavigate } from 'react-router-dom'

export function Notes() {
  const { notes, loading, deleteNote, deleteMultiple, deleteAll, updateNote } = useNotes()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [deleting, setDeleting] = useState(false)
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

  const allSelected = filteredNotes.length > 0 && filteredNotes.every((n) => selectedIds.includes(n.id))

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([])
    } else {
      setSelectedIds(filteredNotes.map((n) => n.id))
    }
  }

  const handleDeleteSelected = async () => {
    if (!confirmDeleteSelected) {
      setConfirmDeleteSelected(true)
      setConfirmDeleteAll(false)
      setTimeout(() => setConfirmDeleteSelected(false), 5000)
      return
    }
    setDeleting(true)
    try {
      await deleteMultiple(selectedIds)
      setSelectedIds([])
      setConfirmDeleteSelected(false)
    } catch (err: any) {
      setError(err.message || 'Erro ao excluir notas')
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteAll = async () => {
    if (!confirmDeleteAll) {
      setConfirmDeleteAll(true)
      setConfirmDeleteSelected(false)
      setTimeout(() => setConfirmDeleteAll(false), 5000)
      return
    }
    setDeleting(true)
    try {
      await deleteAll()
      setSelectedIds([])
      setConfirmDeleteAll(false)
    } catch (err: any) {
      setError(err.message || 'Erro ao excluir notas')
    } finally {
      setDeleting(false)
    }
  }

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

      {/* Action bar */}
      {!loading && notes.length > 0 && (
        <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary transition-colors"
          >
            {allSelected ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            {allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
          </button>

          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                  confirmDeleteSelected
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-red-50 text-red-600 hover:bg-red-100'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleting
                  ? 'Excluindo...'
                  : confirmDeleteSelected
                    ? `Confirmar (${selectedIds.length})`
                    : `Excluir (${selectedIds.length})`}
              </button>
            )}
            <button
              onClick={handleDeleteAll}
              disabled={deleting}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                confirmDeleteAll
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleting && confirmDeleteAll
                ? 'Excluindo...'
                : confirmDeleteAll
                  ? 'Confirmar excluir TODAS'
                  : 'Excluir todas'}
            </button>
          </div>
        </div>
      )}

      {/* Confirm warning */}
      {(confirmDeleteSelected || confirmDeleteAll) && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <p className="text-xs text-amber-700">
            {confirmDeleteAll
              ? 'Tem certeza? TODAS as notas serao excluidas permanentemente. A cota diaria NAO sera resetada.'
              : `Tem certeza? ${selectedIds.length} nota${selectedIds.length > 1 ? 's' : ''} ${selectedIds.length > 1 ? 'serao excluidas' : 'sera excluida'} permanentemente. A cota diaria NAO sera resetada.`}
          </p>
        </div>
      )}

      {/* Selection info */}
      {selectedIds.length > 0 && !confirmDeleteSelected && !confirmDeleteAll && (
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
