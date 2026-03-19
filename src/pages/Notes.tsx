import { useState, useCallback } from 'react'
import { Search, Trash2, CheckSquare, Square, AlertTriangle, FolderPlus, FolderInput } from 'lucide-react'
import { NotesList } from '../components/NotesList'
import { OrganizePanel } from '../components/OrganizePanel'
import { FolderBar } from '../components/FolderBar'
import { useNotes } from '../hooks/useNotes'
import { useFolders } from '../hooks/useFolders'
import { organizeWithAI } from '../lib/organize'
import { supabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/errors'
import type { OrganizationType } from '../types/database'
import { useNavigate } from 'react-router-dom'

export function Notes() {
  const { notes, loading, deleteNote, deleteMultiple, deleteAll, updateNote, refetch: refetchNotes } = useNotes()
  const { folders, createFolder, renameFolder, deleteFolder, moveNotesToFolder, refetch: refetchFolders } = useFolders()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const navigate = useNavigate()

  const resetDeleteConfirmation = () => {
    setConfirmDeleteSelected(false)
    setConfirmDeleteAll(false)
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    )
  }, [])

  // Filter notes by folder and search
  const folderFilteredNotes = activeFolderId
    ? notes.filter((n) => n.folder_id === activeFolderId)
    : notes

  const filteredNotes = search
    ? folderFilteredNotes.filter(
        (n) =>
          n.raw_text.toLowerCase().includes(search.toLowerCase()) ||
          n.title?.toLowerCase().includes(search.toLowerCase()),
      )
    : folderFilteredNotes

  // When selecting a folder, auto-select all its notes
  const handleSelectFolder = (folderId: string | null) => {
    setActiveFolderId(folderId)
    setSearch('')
    if (folderId) {
      const folderNoteIds = notes.filter((n) => n.folder_id === folderId).map((n) => n.id)
      setSelectedIds(folderNoteIds)
    } else {
      setSelectedIds([])
    }
  }

  const allSelected = filteredNotes.length > 0 && filteredNotes.every((n) => selectedIds.includes(n.id))

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([])
    } else {
      setSelectedIds(filteredNotes.map((n) => n.id))
    }
  }

  // Create folder from selected notes
  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || selectedIds.length === 0) return
    setError(null)
    try {
      const folder = await createFolder(newFolderName.trim(), selectedIds)
      setShowNewFolderInput(false)
      setNewFolderName('')
      await refetchNotes()
      handleSelectFolder(folder.id)
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Erro ao criar pasta'))
    }
  }

  // Move notes to existing folder
  const handleMoveToFolder = async (folderId: string) => {
    setError(null)
    try {
      await moveNotesToFolder(selectedIds, folderId)
      await refetchNotes()
      setShowMoveMenu(false)
      handleSelectFolder(folderId)
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Erro ao mover notas'))
    }
  }

  const handleDeleteSelected = async () => {
    if (!confirmDeleteSelected) {
      setConfirmDeleteSelected(true)
      setConfirmDeleteAll(false)
      return
    }
    setDeleting(true)
    try {
      await deleteMultiple(selectedIds)
      setSelectedIds([])
      resetDeleteConfirmation()
      refetchFolders()
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Erro ao excluir notas'))
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteAll = async () => {
    if (!confirmDeleteAll) {
      setConfirmDeleteAll(true)
      setConfirmDeleteSelected(false)
      return
    }
    setDeleting(true)
    try {
      await deleteAll()
      setSelectedIds([])
      resetDeleteConfirmation()
      refetchFolders()
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Erro ao excluir notas'))
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
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Erro ao organizar'))
    }
  }

  const handleRenameFolder = async (id: string, name: string) => {
    try {
      await renameFolder(id, name)
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Erro ao renomear pasta'))
    }
  }

  const handleDeleteFolder = async (id: string) => {
    try {
      await deleteFolder(id)
      if (activeFolderId === id) {
        setActiveFolderId(null)
        setSelectedIds([])
      }
      await refetchNotes()
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Erro ao excluir pasta'))
    }
  }

  return (
    <div className="space-y-4">
      {/* Folder bar */}
      <FolderBar
        folders={folders}
        activeFolderId={activeFolderId}
        onSelectFolder={handleSelectFolder}
        onRename={handleRenameFolder}
        onDelete={handleDeleteFolder}
      />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={activeFolderId ? 'Buscar na pasta...' : 'Buscar notas...'}
          aria-label={activeFolderId ? 'Buscar notas na pasta atual' : 'Buscar notas'}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
      </div>

      {/* Action bar */}
      {!loading && notes.length > 0 && (
        <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2">
          <button
            type="button"
            onClick={toggleSelectAll}
            aria-pressed={allSelected}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary transition-colors"
          >
            {allSelected ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            {allSelected ? 'Desmarcar' : 'Selecionar todas'}
          </button>

          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {/* Montar Pasta button */}
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowNewFolderInput(true)
                  setShowMoveMenu(false)
                }}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-50 text-primary hover:bg-indigo-100 transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                Montar Pasta
              </button>
            )}

            {/* Move to existing folder */}
            {selectedIds.length > 0 && folders.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowMoveMenu(!showMoveMenu)
                  setShowNewFolderInput(false)
                }}
                aria-expanded={showMoveMenu}
                aria-controls="move-folder-menu"
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
              >
                <FolderInput className="w-3.5 h-3.5" />
                Mover
              </button>
            )}

            {selectedIds.length > 0 && (
              <button
                type="button"
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
              type="button"
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
                  ? 'Confirmar TODAS'
                  : 'Excluir todas'}
            </button>
          </div>
        </div>
      )}

      {/* New folder input */}
      {showNewFolderInput && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <p className="text-xs font-medium text-primary mb-2">
            Criar pasta com {selectedIds.length} nota{selectedIds.length > 1 ? 's' : ''}:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder()
                if (e.key === 'Escape') setShowNewFolderInput(false)
              }}
              placeholder="Nome da pasta..."
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              autoFocus
            />
            <button
              type="button"
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim()}
              className="px-4 py-2 bg-primary hover:bg-primary-dark disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Criar
            </button>
            <button
              type="button"
              onClick={() => setShowNewFolderInput(false)}
              className="px-3 py-2 text-gray-500 hover:text-gray-700 text-sm border border-gray-200 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Move to folder menu */}
      {showMoveMenu && (
        <div id="move-folder-menu" className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <p className="text-xs font-medium text-emerald-700 mb-2">
            Mover {selectedIds.length} nota{selectedIds.length > 1 ? 's' : ''} para:
          </p>
          <div className="flex flex-wrap gap-2">
            {folders.map((folder) => (
              <button
                type="button"
                key={folder.id}
                onClick={() => handleMoveToFolder(folder.id)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                {folder.name} ({folder.note_count || 0})
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowMoveMenu(false)}
              className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Confirm warning */}
      {(confirmDeleteSelected || confirmDeleteAll) && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5" role="status" aria-live="polite">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <p className="text-xs text-amber-700">
              {confirmDeleteAll
                ? 'Confirme para excluir todas as notas permanentemente.'
                : `Confirme para excluir ${selectedIds.length} nota${selectedIds.length > 1 ? 's' : ''} permanentemente.`}
            </p>
          </div>
          <button
            type="button"
            onClick={resetDeleteConfirmation}
            className="text-xs font-medium text-amber-700 hover:text-amber-800"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Selection info */}
      {selectedIds.length > 0 && !confirmDeleteSelected && !confirmDeleteAll && (
        <div className="flex items-center justify-between bg-indigo-50 rounded-lg px-4 py-2">
          <span className="text-sm text-primary font-medium">
            {selectedIds.length} nota{selectedIds.length > 1 ? 's' : ''} selecionada{selectedIds.length > 1 ? 's' : ''}
            {activeFolderId && (
              <span className="text-xs text-indigo-400 ml-1">
                ({folders.find((f) => f.id === activeFolderId)?.name})
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="text-xs text-primary hover:text-primary-dark"
          >
            Limpar
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
        onDelete={async (id) => {
          await deleteNote(id)
          refetchFolders()
        }}
        onEdit={async (id, updates) => { await updateNote(id, updates) }}
        loading={loading}
        folders={folders}
      />
    </div>
  )
}
