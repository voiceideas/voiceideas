import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Search, Trash2, CheckSquare, Square, AlertTriangle, FolderPlus, FolderInput, Sparkles, ArrowUpRight } from 'lucide-react'
import { NotesList } from '../components/NotesList'
import { OrganizePanel } from '../components/OrganizePanel'
import { FolderBar } from '../components/FolderBar'
import { StatusBanner } from '../components/StatusBanner'
import { useI18n } from '../hooks/useI18n'
import { useNotes } from '../hooks/useNotes'
import { useFolders } from '../hooks/useFolders'
import { getErrorMessage } from '../lib/errors'
import { getOrganizationTypeLabel } from '../lib/organize'
import type { OrganizationType, OrganizedIdeaPreview } from '../types/database'
import { createOrganizedIdeaFromNotes, loadDerivedIdeasForNotes } from '../services/organizedIdeaService'
import { useNavigate, useSearchParams } from 'react-router-dom'

export function Notes() {
  const { t, locale } = useI18n()
  const { notes, loading, deleteNote, deleteMultiple, updateNote, refetch: refetchNotes } = useNotes()
  const {
    folders,
    loading: foldersLoading,
    error: foldersError,
    createFolder,
    renameFolder,
    deleteFolder,
    moveNotesToFolder,
    refetch: refetchFolders,
  } = useFolders()
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
  const [derivedIdeasByNoteId, setDerivedIdeasByNoteId] = useState<Record<string, OrganizedIdeaPreview[]>>({})
  const hasRetriedFolderLoad = useRef(false)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const sourceIdeaId = searchParams.get('sourceIdea')?.trim() || null

  const resetDeleteConfirmation = () => {
    setConfirmDeleteSelected(false)
    setConfirmDeleteAll(false)
  }

  const generalNotes = notes.filter((note) => !note.folder_id)
  const hasFolderedNotes = notes.some((note) => Boolean(note.folder_id))
  const activeFolderName = activeFolderId
    ? folders.find((folder) => folder.id === activeFolderId)?.name || t('folders.title').toLocaleLowerCase(locale)
    : null

  useEffect(() => {
    if (!foldersLoading && folders.length > 0) {
      hasRetriedFolderLoad.current = false
      return
    }

    if (!foldersLoading && hasFolderedNotes && folders.length === 0 && !hasRetriedFolderLoad.current) {
      hasRetriedFolderLoad.current = true
      void refetchFolders()
    }
  }, [foldersLoading, folders.length, hasFolderedNotes, refetchFolders])

  useEffect(() => {
    let cancelled = false

    async function fetchDerivedIdeas() {
      if (notes.length === 0) {
        setDerivedIdeasByNoteId({})
        return
      }

      try {
        const nextDerivedIdeas = await loadDerivedIdeasForNotes(notes.map((note) => note.id))
        if (!cancelled) {
          setDerivedIdeasByNoteId(nextDerivedIdeas)
        }
      } catch {
        if (!cancelled) {
          setDerivedIdeasByNoteId({})
        }
      }
    }

    void fetchDerivedIdeas()

    return () => {
      cancelled = true
    }
  }, [notes])

  useEffect(() => {
    if (sourceIdeaId) {
      setActiveFolderId(null)
    }
  }, [sourceIdeaId])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    )
  }, [])

  const sourceIdea = useMemo(() => {
    if (!sourceIdeaId) return null

    const ideaById = new Map<string, OrganizedIdeaPreview>()
    Object.values(derivedIdeasByNoteId)
      .flat()
      .forEach((idea) => {
        if (!ideaById.has(idea.id)) {
          ideaById.set(idea.id, idea)
        }
      })

    return ideaById.get(sourceIdeaId) || null
  }, [derivedIdeasByNoteId, sourceIdeaId])

  const sourceIdeaNotes = useMemo(
    () => (sourceIdeaId
      ? notes.filter((note) => (derivedIdeasByNoteId[note.id] || []).some((idea) => idea.id === sourceIdeaId))
      : []),
    [derivedIdeasByNoteId, notes, sourceIdeaId],
  )

  // Filter notes by folder/search or by organized idea context
  const scopedNotes = sourceIdeaId
    ? sourceIdeaNotes
    : activeFolderId
      ? notes.filter((n) => n.folder_id === activeFolderId)
      : generalNotes

  const filteredNotes = search
    ? scopedNotes.filter(
        (n) =>
          n.raw_text.toLowerCase().includes(search.toLowerCase()) ||
          n.title?.toLowerCase().includes(search.toLowerCase()),
      )
    : scopedNotes

  // When selecting a folder, auto-select all its notes
  const handleSelectFolder = (folderId: string | null) => {
    if (sourceIdeaId) {
      const next = new URLSearchParams(searchParams)
      next.delete('sourceIdea')
      setSearchParams(next)
    }
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
      setError(getErrorMessage(err, t('notes.error.createFolder')))
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
      setError(getErrorMessage(err, t('notes.error.moveNotes')))
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
      setError(getErrorMessage(err, t('notes.error.deleteNotes')))
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

    const visibleIds = filteredNotes.map((note) => note.id)
    if (visibleIds.length === 0) return

    setDeleting(true)
    try {
      await deleteMultiple(visibleIds)
      setSelectedIds([])
      resetDeleteConfirmation()
      refetchFolders()
    } catch (err: unknown) {
      setError(getErrorMessage(err, t('notes.error.deleteNotes')))
    } finally {
      setDeleting(false)
    }
  }

  const handleOrganize = async (type: OrganizationType) => {
    setError(null)
    const noteById = new Map(notes.map((note) => [note.id, note]))
    const selectedNotes = selectedIds
      .map((noteId) => noteById.get(noteId))
      .filter((note): note is (typeof notes)[number] => Boolean(note))

    try {
      await createOrganizedIdeaFromNotes(selectedNotes, type, locale)
      setSelectedIds([])
      navigate('/organized')
    } catch (err: unknown) {
      setError(getErrorMessage(err, t('notes.error.organize')))
    }
  }

  const handleRenameFolder = async (id: string, name: string) => {
    try {
      await renameFolder(id, name)
    } catch (err: unknown) {
      setError(getErrorMessage(err, t('notes.error.renameFolder')))
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
      setError(getErrorMessage(err, t('notes.error.deleteFolder')))
    }
  }

  const handleOpenDerivedIdeas = useCallback((noteId: string, derivedIdeas: OrganizedIdeaPreview[]) => {
    if (derivedIdeas.length === 1) {
      navigate(`/organized?idea=${encodeURIComponent(derivedIdeas[0].id)}`)
      return
    }

    navigate(`/organized?sourceNote=${encodeURIComponent(noteId)}`)
  }, [navigate])

  const clearSourceIdeaFocus = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('sourceIdea')
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  const emptyState = search
    ? {
        title: t('notes.empty.searchTitle'),
        description: sourceIdeaId
          ? t('notes.empty.searchDescription.source')
          : t('notes.empty.searchDescription.default'),
      }
    : sourceIdeaId
      ? {
          title: t('notes.empty.sourceTitle'),
          description: t('notes.empty.sourceDescription'),
        }
    : activeFolderId
      ? {
          title: t('notes.empty.folderTitle'),
          description: t('notes.empty.folderDescription', { folder: activeFolderName }),
        }
      : notes.length > 0
        ? {
            title: t('notes.empty.generalTitle'),
            description: t('notes.empty.generalDescription'),
          }
        : {
            title: t('notes.empty.noneTitle'),
            description: t('notes.empty.noneDescription'),
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

      {foldersError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t('notes.error.loadFolders')}
        </div>
      )}

      {!foldersLoading && folders.length === 0 && hasFolderedNotes && !foldersError && (
        <StatusBanner key="refetch-folders-notice" variant="info" size="compact">
          {t('notes.error.refetchFolders')}
        </StatusBanner>
      )}

      {sourceIdeaId && (
        <div className="rounded-xl border border-slate-300 bg-slate-100 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                {t('notes.navigation.title')}
              </div>
              <p className="text-sm font-medium text-gray-900">
                {sourceIdea
                  ? t('notes.navigation.sourceIdeaDescription', {
                    label: getOrganizationTypeLabel(sourceIdea.type, sourceIdea.note_ids.length, locale).toLocaleLowerCase(locale),
                    title: sourceIdea.title,
                  })
                  : t('notes.navigation.fallbackDescription')}
              </p>
              <p className="mt-1 text-xs text-gray-600">
                {t('notes.navigation.help')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {sourceIdea && (
                <button
                  type="button"
                  onClick={() => navigate(`/organized?idea=${encodeURIComponent(sourceIdea.id)}`)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-slate-50"
                >
                  {t('notes.navigation.openResult')}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={clearSourceIdeaFocus}
                className="rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-white hover:text-primary"
              >
                {t('notes.navigation.viewAll')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={sourceIdeaId ? t('notes.search.placeholder.source') : activeFolderId ? t('notes.search.placeholder.folder') : t('notes.search.placeholder.default')}
          aria-label={sourceIdeaId ? t('notes.search.aria.source') : activeFolderId ? t('notes.search.aria.folder') : t('notes.search.aria.default')}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
      </div>

      {/* Action bar */}
      {!loading && filteredNotes.length > 0 && (
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
            {allSelected ? t('notes.deselectAll') : t('notes.selectAll')}
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
                className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-slate-200"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                {t('notes.buildFolder')}
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
                {t('notes.move')}
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
                  ? t('notes.deleting')
                  : confirmDeleteSelected
                    ? t('notes.deleteSelected.confirm', { count: selectedIds.length })
                    : t('notes.deleteSelected.action', { count: selectedIds.length })}
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
                ? t('notes.deleting')
                : confirmDeleteAll
                  ? t('notes.deleteAll.confirm', { count: filteredNotes.length })
                  : activeFolderId
                    ? t('notes.deleteAll.folder', { count: filteredNotes.length })
                    : t('notes.deleteAll.general', { count: filteredNotes.length })}
            </button>
          </div>
        </div>
      )}

      {/* New folder input */}
      {showNewFolderInput && (
        <div className="rounded-lg border border-slate-300 bg-slate-100 p-3">
          <p className="text-xs font-medium text-primary mb-2">
            {t('notes.createFolderWithCount', { count: selectedIds.length })}
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
              placeholder={t('notes.folderNamePlaceholder')}
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              autoFocus
            />
            <button
              type="button"
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim()}
              className="px-4 py-2 bg-primary hover:bg-primary-dark disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {t('notes.create')}
            </button>
            <button
              type="button"
              onClick={() => setShowNewFolderInput(false)}
              className="px-3 py-2 text-gray-500 hover:text-gray-700 text-sm border border-gray-200 rounded-lg transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Move to folder menu */}
      {showMoveMenu && (
        <div id="move-folder-menu" className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <p className="text-xs font-medium text-emerald-700 mb-2">
            {t('notes.moveToFolder', { count: selectedIds.length })}
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
              {t('common.cancel')}
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
                ? activeFolderId
                  ? t('notes.confirmDelete.allFolder', { count: filteredNotes.length })
                  : t('notes.confirmDelete.allGeneral', { count: filteredNotes.length })
                : t('notes.confirmDelete.selected', { count: selectedIds.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={resetDeleteConfirmation}
            className="text-xs font-medium text-amber-700 hover:text-amber-800"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}

      {/* Selection info */}
      {selectedIds.length > 0 && !confirmDeleteSelected && !confirmDeleteAll && (
        <div className="flex items-center justify-between rounded-lg bg-slate-100 px-4 py-2">
          <span className="text-sm text-primary font-medium">
            {t('notes.selectionInfo', { count: selectedIds.length })}
            {activeFolderId && (
              <span className="ml-1 text-xs text-slate-500">
                ({activeFolderName})
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="text-xs text-primary hover:text-primary-dark"
          >
            {t('notes.clearSelection')}
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
        derivedIdeasByNoteId={derivedIdeasByNoteId}
        focusedIdeaId={sourceIdeaId}
        onOpenDerivedIdeas={handleOpenDerivedIdeas}
        emptyTitle={emptyState.title}
        emptyDescription={emptyState.description}
      />
    </div>
  )
}
