import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Sparkles, Loader2, Users, CheckCircle2, Tags, FolderOpen, Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { OrganizedView } from '../components/OrganizedView'
import { ShareIdeaModal } from '../components/ShareIdeaModal'
import { matchesOrganizedIdeaSearch, normalizeOrganizedIdea, normalizeSharedOrganizedIdea } from '../lib/organizedIdeas'
import { getAvailableIdeaTags, getIdeaTags, normalizeTagList } from '../lib/organizedTags'
import { listSharedIdeas } from '../lib/shareIdeas'
import { loadSourceNotesForIdeas } from '../services/organizedIdeaService'
import { supabase } from '../lib/supabase'
import type { SourceNotePreview } from '../types/database'
import type { OrganizedIdea, SharedOrganizedIdea } from '../types/database'

type OrganizedTab = 'mine' | 'shared'
type IdeaFolderMap = Record<string, string[]>
type FilterChip = { label: string; count: number }

export function Organized() {
  const [ownedIdeas, setOwnedIdeas] = useState<OrganizedIdea[]>([])
  const [sharedIdeas, setSharedIdeas] = useState<SharedOrganizedIdea[]>([])
  const [ownedIdeaFolders, setOwnedIdeaFolders] = useState<IdeaFolderMap>({})
  const [ownedIdeaSourceNotes, setOwnedIdeaSourceNotes] = useState<Record<string, SourceNotePreview[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ideaToShare, setIdeaToShare] = useState<OrganizedIdea | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTab: OrganizedTab = searchParams.get('tab') === 'shared' ? 'shared' : 'mine'
  const showAcceptedBanner = searchParams.get('accepted') === '1'
  const searchQuery = searchParams.get('q')?.trim() || ''

  const fetchIdeas = useEffectEvent(async () => {
    setLoading(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setOwnedIdeas([])
        setSharedIdeas([])
        return
      }

      const [ownedResult, sharedResult] = await Promise.allSettled([
        supabase
          .from('organized_ideas')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        listSharedIdeas(),
      ])

      if (ownedResult.status === 'fulfilled') {
        if (ownedResult.value.error) {
          setError(ownedResult.value.error.message)
          setOwnedIdeas([])
          setOwnedIdeaFolders({})
        } else {
          const nextOwnedIdeas = ((ownedResult.value.data as unknown[]) || [])
            .map(normalizeOrganizedIdea)
            .filter((idea): idea is OrganizedIdea => Boolean(idea))
          setOwnedIdeas(nextOwnedIdeas)

          try {
            const [folders, sourceNotes] = await Promise.all([
              loadFoldersForIdeas(nextOwnedIdeas),
              loadSourceNotesForIdeas(nextOwnedIdeas),
            ])
            setOwnedIdeaFolders(folders)
            setOwnedIdeaSourceNotes(sourceNotes)
          } catch {
            setOwnedIdeaFolders({})
            setOwnedIdeaSourceNotes({})
          }
        }
      } else {
        setError(ownedResult.reason instanceof Error ? ownedResult.reason.message : 'Nao foi possivel carregar suas ideias.')
        setOwnedIdeas([])
        setOwnedIdeaFolders({})
        setOwnedIdeaSourceNotes({})
      }

      if (sharedResult.status === 'fulfilled') {
        setSharedIdeas(
          sharedResult.value
            .map(normalizeSharedOrganizedIdea)
            .filter((idea): idea is SharedOrganizedIdea => Boolean(idea)),
        )
      } else {
        setSharedIdeas([])
        setError((current) => current || (sharedResult.reason instanceof Error
          ? sharedResult.reason.message
          : 'Nao foi possivel carregar as ideias compartilhadas.'))
      }
    } finally {
      setLoading(false)
    }
  })

  useEffect(() => {
    void fetchIdeas()
  }, [])

  const visibleIdeas: OrganizedIdea[] = useMemo(
    () => (activeTab === 'mine' ? ownedIdeas : sharedIdeas),
    [activeTab, ownedIdeas, sharedIdeas],
  )

  const ideaTags = useMemo(
    () => Object.fromEntries(visibleIdeas.map((idea) => [idea.id, getIdeaTags(idea)])),
    [visibleIdeas],
  )

  const availableTags = useMemo(
    () => getAvailableIdeaTags(visibleIdeas),
    [visibleIdeas],
  )

  const activeTag = useMemo(() => {
    const rawTag = searchParams.get('tag')
    if (!rawTag) return null
    return availableTags.some((tag) => tag.label === rawTag) ? rawTag : null
  }, [availableTags, searchParams])

  const tagFilteredIdeas = useMemo(
    () => (activeTag
      ? visibleIdeas.filter((idea) => ideaTags[idea.id]?.includes(activeTag))
      : visibleIdeas),
    [activeTag, ideaTags, visibleIdeas],
  )

  const availableFolders = useMemo(
    () => (activeTab === 'mine' ? buildFolderFilters(tagFilteredIdeas, ownedIdeaFolders) : []),
    [activeTab, ownedIdeaFolders, tagFilteredIdeas],
  )

  const activeFolder = useMemo(() => {
    const rawFolder = searchParams.get('folder')
    if (!rawFolder || activeTab !== 'mine') return null
    return availableFolders.some((folder) => folder.label === rawFolder) ? rawFolder : null
  }, [activeTab, availableFolders, searchParams])

  const filteredIdeas = useMemo(
    () => (activeFolder
      ? tagFilteredIdeas.filter((idea) => ownedIdeaFolders[idea.id]?.includes(activeFolder))
      : tagFilteredIdeas),
    [activeFolder, ownedIdeaFolders, tagFilteredIdeas],
  )

  const searchedIdeas = useMemo(
    () => (searchQuery
      ? filteredIdeas.filter((idea) => matchesOrganizedIdeaSearch(idea, searchQuery, {
          tags: ideaTags[idea.id] || [],
          folders: activeTab === 'mine' ? (ownedIdeaFolders[idea.id] || []) : [],
        }))
      : filteredIdeas),
    [activeTab, filteredIdeas, ideaTags, ownedIdeaFolders, searchQuery],
  )

  async function handleDelete(id: string) {
    await supabase.from('organized_ideas').delete().eq('id', id)
    setOwnedIdeas((prev) => prev.filter((idea) => idea.id !== id))
    setOwnedIdeaFolders((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setOwnedIdeaSourceNotes((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  async function handleUpdateTags(id: string, nextTags: string[]) {
    const tags = normalizeTagList(nextTags)

    const { error: updateError } = await supabase
      .from('organized_ideas')
      .update({ tags })
      .eq('id', id)

    if (updateError) {
      throw new Error(updateError.message)
    }

    setOwnedIdeas((prev) => prev.map((idea) => (
      idea.id === id
        ? { ...idea, tags }
        : idea
    )))
  }

  function handleTabChange(tab: OrganizedTab) {
    const next = new URLSearchParams(searchParams)
    if (tab === 'shared') {
      next.set('tab', 'shared')
    } else {
      next.delete('tab')
    }
    next.delete('accepted')
    next.delete('tag')
    next.delete('folder')
    setSearchParams(next)
  }

  function handleTagChange(tag: string | null) {
    const next = new URLSearchParams(searchParams)
    next.delete('folder')
    if (tag) {
      next.set('tag', tag)
    } else {
      next.delete('tag')
    }
    setSearchParams(next)
  }

  function handleFolderChange(folder: string | null) {
    const next = new URLSearchParams(searchParams)
    if (folder) {
      next.set('folder', folder)
    } else {
      next.delete('folder')
    }
    setSearchParams(next)
  }

  function handleSearchChange(query: string) {
    const next = new URLSearchParams(searchParams)
    const normalizedQuery = query.trim()

    if (normalizedQuery) {
      next.set('q', normalizedQuery)
    } else {
      next.delete('q')
    }

    setSearchParams(next)
  }

  function clearAcceptedBanner() {
    const next = new URLSearchParams(searchParams)
    next.delete('accepted')
    setSearchParams(next)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {showAcceptedBanner && (
        <button
          onClick={clearAcceptedBanner}
          className="flex w-full items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-left"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          <div>
            <p className="text-sm font-medium text-green-800">Convite aceito com sucesso</p>
            <p className="text-sm text-green-700">
              Essa ideia agora aparece na aba <strong>Compartilhadas comigo</strong>.
            </p>
          </div>
        </button>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-gray-100">
        <button
          onClick={() => handleTabChange('mine')}
          className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'mine'
              ? 'bg-primary text-white'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          Minhas ({ownedIdeas.length})
        </button>
        <button
          onClick={() => handleTabChange('shared')}
          className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'shared'
              ? 'bg-primary text-white'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          Compartilhadas comigo ({sharedIdeas.length})
        </button>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          {activeTab === 'mine' ? 'Ideias organizadas' : 'Ideias compartilhadas'}
        </h2>
        {activeTab === 'shared' && (
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-primary">
            <Users className="h-3.5 w-3.5" />
            leitura compartilhada
          </div>
        )}
      </div>

      {visibleIdeas.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={activeTab === 'mine'
              ? 'Buscar em ideias, tags e pastas...'
              : 'Buscar em ideias e tags...'}
            aria-label={activeTab === 'mine'
              ? 'Buscar nas ideias organizadas, tags e pastas'
              : 'Buscar nas ideias compartilhadas e tags'}
            className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm text-gray-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}

      {visibleIdeas.length > 0 && (
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <Tags className="h-3.5 w-3.5" />
              Tags
            </div>
            <div className="flex flex-wrap gap-2">
              <FilterButton
                label="Todas"
                count={visibleIdeas.length}
                active={!activeTag}
                onClick={() => handleTagChange(null)}
              />
              {availableTags.map((tag) => (
                <FilterButton
                  key={tag.label}
                  label={tag.label}
                  count={tag.count}
                  active={activeTag === tag.label}
                  onClick={() => handleTagChange(tag.label)}
                />
              ))}
            </div>
          </div>

          {activeTab === 'mine' && availableFolders.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <FolderOpen className="h-3.5 w-3.5" />
                Pastas dentro da tag
              </div>
              <div className="flex flex-wrap gap-2">
                <FilterButton
                  label="Todas as pastas"
                  count={tagFilteredIdeas.length}
                  active={!activeFolder}
                  onClick={() => handleFolderChange(null)}
                />
                {availableFolders.map((folder) => (
                  <FilterButton
                    key={folder.label}
                    label={folder.label}
                    count={folder.count}
                    active={activeFolder === folder.label}
                    onClick={() => handleFolderChange(folder.label)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {searchedIdeas.length === 0 ? (
        <div className="py-12 text-center">
          <Sparkles className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="font-medium text-gray-500">
            {searchQuery
              ? 'Nenhuma ideia encontrada para essa busca'
              : activeTag || activeFolder
              ? 'Nenhuma ideia encontrada nesse recorte'
              : activeTab === 'mine'
              ? 'Nenhuma ideia organizada ainda'
              : 'Nenhuma ideia compartilhada com voce ainda'}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {searchQuery
              ? 'Tente buscar por outro termo ou limpar os filtros atuais.'
              : activeTag || activeFolder
              ? 'Tente trocar a tag ou a pasta para ver outras ideias.'
              : activeTab === 'mine'
              ? 'Selecione notas e use a IA para organizar.'
              : 'Quando alguem compartilhar uma ideia, ela aparece aqui.'}
          </p>
        </div>
      ) : (
        searchedIdeas.map((idea) => (
          <OrganizedView
            key={idea.id}
            idea={idea}
            onDelete={handleDelete}
            onShare={setIdeaToShare}
            onUpdateTags={activeTab === 'mine' ? handleUpdateTags : undefined}
            canDelete={activeTab === 'mine'}
            canShare={activeTab === 'mine'}
            canEditTags={activeTab === 'mine'}
            tags={ideaTags[idea.id] || []}
            folders={activeTab === 'mine' ? (ownedIdeaFolders[idea.id] || []) : []}
            activeTag={activeTag}
            activeFolder={activeFolder}
            onTagClick={handleTagChange}
            onFolderClick={activeTab === 'mine' ? handleFolderChange : undefined}
            sourceNotes={activeTab === 'mine' ? (ownedIdeaSourceNotes[idea.id] || []) : []}
          />
        ))
      )}

      <ShareIdeaModal
        idea={ideaToShare}
        isOpen={!!ideaToShare}
        onClose={() => setIdeaToShare(null)}
      />
    </div>
  )
}

function FilterButton({ label, count, active, onClick }: FilterChip & { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-primary text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      <span>{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-white/20' : 'bg-white text-gray-500'}`}>
        {count}
      </span>
    </button>
  )
}

async function loadFoldersForIdeas(ideas: OrganizedIdea[]): Promise<IdeaFolderMap> {
  const noteIds = Array.from(new Set(ideas.flatMap((idea) => idea.note_ids)))
  if (noteIds.length === 0) return {}

  const { data: noteRows, error: notesError } = await supabase
    .from('notes')
    .select('id, folder_id')
    .in('id', noteIds)

  if (notesError) {
    throw new Error(notesError.message)
  }

  const folderIds = Array.from(new Set((noteRows || []).map((note) => note.folder_id).filter(Boolean)))
  const folderNameById = new Map<string, string>()

  if (folderIds.length > 0) {
    const { data: folderRows, error: foldersError } = await supabase
      .from('folders')
      .select('id, name')
      .in('id', folderIds)

    if (foldersError) {
      throw new Error(foldersError.message)
    }

    folderRows?.forEach((folder) => {
      folderNameById.set(folder.id, folder.name)
    })
  }

  const noteFolderById = new Map<string, string>()
  noteRows?.forEach((note) => {
    if (!note.folder_id) return
    const folderName = folderNameById.get(note.folder_id)
    if (folderName) {
      noteFolderById.set(note.id, folderName)
    }
  })

  return Object.fromEntries(
    ideas.map((idea) => [
      idea.id,
      Array.from(new Set(
        idea.note_ids
          .map((noteId) => noteFolderById.get(noteId))
          .filter((folderName): folderName is string => Boolean(folderName)),
      )),
    ]),
  )
}

function buildFolderFilters(ideas: OrganizedIdea[], folderMap: IdeaFolderMap): FilterChip[] {
  const counts = new Map<string, number>()

  ideas.forEach((idea) => {
    const folders = folderMap[idea.id] || []
    folders.forEach((folder) => {
      counts.set(folder, (counts.get(folder) || 0) + 1)
    })
  })

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.label.localeCompare(b.label, 'pt-BR')
    })
}
