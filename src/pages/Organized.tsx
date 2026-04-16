import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Sparkles, Loader2, Users, CheckCircle2, Search, ArrowUpRight } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { OrganizedView } from '../components/OrganizedView'
import { TagCloudPanel } from '../components/TagCloudPanel'
import { ShareIdeaModal } from '../components/ShareIdeaModal'
import { SendToBardoModal } from '../components/SendToBardoModal'
import { useI18n } from '../hooks/useI18n'
import { matchesOrganizedIdeaSearch, normalizeOrganizedIdea, normalizeSharedOrganizedIdea } from '../lib/organizedIdeas'
import { getAvailableIdeaTags, getIdeaTags, normalizeTagList } from '../lib/organizedTags'
import { getOrganizationTypeLabel } from '../lib/organize'
import { listSharedIdeas } from '../lib/shareIdeas'
import { loadSourceNotesForIdeas } from '../services/organizedIdeaService'
import { applyOrganizedTagMutations, planDeleteOrganizedTags, planMergeOrganizedTags, planRenameOrganizedTag } from '../services/organizedTagService'
import { supabase } from '../lib/supabase'
import { useUserSettings } from '../hooks/useUserSettings'
import type { Note, SourceNotePreview } from '../types/database'
import type { OrganizedIdea, SharedOrganizedIdea } from '../types/database'

type OrganizedTab = 'mine' | 'shared'
type IdeaFolderMap = Record<string, string[]>
type FilterChip = { label: string; count: number }

export function Organized() {
  const { t, locale } = useI18n()
  const [ownedIdeas, setOwnedIdeas] = useState<OrganizedIdea[]>([])
  const [sharedIdeas, setSharedIdeas] = useState<SharedOrganizedIdea[]>([])
  const [ownedIdeaFolders, setOwnedIdeaFolders] = useState<IdeaFolderMap>({})
  const [ownedIdeaSourceNotes, setOwnedIdeaSourceNotes] = useState<Record<string, SourceNotePreview[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ideaToShare, setIdeaToShare] = useState<OrganizedIdea | null>(null)
  const [bardoNote, setBardoNote] = useState<Note | null>(null)
  const { bardoBridgeEnabled } = useUserSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const activeTab: OrganizedTab = searchParams.get('tab') === 'shared' ? 'shared' : 'mine'
  const showAcceptedBanner = searchParams.get('accepted') === '1'
  const searchQuery = searchParams.get('q')?.trim() || ''
  const focusedIdeaId = activeTab === 'mine' ? searchParams.get('idea')?.trim() || null : null
  const activeSourceNoteId = activeTab === 'mine' ? searchParams.get('sourceNote')?.trim() || null : null

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
        setError(
          ownedResult.reason instanceof Error
            ? ownedResult.reason.message
            : t('organized.fetch.mineError'),
        )
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
        setError((current) => current || (
          sharedResult.reason instanceof Error
            ? sharedResult.reason.message
            : t('organized.fetch.sharedError')
        ))
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

  const contextIdeas = useMemo(
    () => (focusedIdeaId
      ? visibleIdeas.filter((idea) => idea.id === focusedIdeaId)
      : activeSourceNoteId
        ? visibleIdeas.filter((idea) => idea.note_ids.includes(activeSourceNoteId))
        : visibleIdeas),
    [activeSourceNoteId, focusedIdeaId, visibleIdeas],
  )

  const ideaTags = useMemo(
    () => Object.fromEntries(contextIdeas.map((idea) => [idea.id, getIdeaTags(idea)])),
    [contextIdeas],
  )

  const availableTags = useMemo(
    () => getAvailableIdeaTags(contextIdeas),
    [contextIdeas],
  )

  const activeTag = useMemo(() => {
    const rawTag = searchParams.get('tag')
    if (!rawTag) return null
    return availableTags.some((tag) => tag.label === rawTag) ? rawTag : null
  }, [availableTags, searchParams])

  const tagFilteredIdeas = useMemo(
    () => (activeTag
      ? contextIdeas.filter((idea) => ideaTags[idea.id]?.includes(activeTag))
      : contextIdeas),
    [activeTag, contextIdeas, ideaTags],
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
    () => (focusedIdeaId
      ? filteredIdeas
      : searchQuery
      ? filteredIdeas.filter((idea) => matchesOrganizedIdeaSearch(idea, searchQuery, {
          tags: ideaTags[idea.id] || [],
          folders: activeTab === 'mine' ? (ownedIdeaFolders[idea.id] || []) : [],
        }))
      : filteredIdeas),
    [activeTab, filteredIdeas, focusedIdeaId, ideaTags, ownedIdeaFolders, searchQuery],
  )

  const focusedIdea = useMemo(
    () => (focusedIdeaId ? visibleIdeas.find((idea) => idea.id === focusedIdeaId) || null : null),
    [focusedIdeaId, visibleIdeas],
  )

  const focusedSourceNote = useMemo(() => {
    if (!activeSourceNoteId) return null

    return Object.values(ownedIdeaSourceNotes)
      .flat()
      .find((note) => note.id === activeSourceNoteId) || null
  }, [activeSourceNoteId, ownedIdeaSourceNotes])

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

  async function handleRenameTag(currentTag: string, nextTag: string) {
    const mutations = planRenameOrganizedTag(ownedIdeas, currentTag, nextTag)
    await applyTagMutations(mutations)

    if (activeTag === currentTag) {
      handleTagChange(normalizeTagList([nextTag])[0] ?? null)
    }
  }

  async function handleMergeTags(tagsToMerge: string[], mergedTag: string) {
    const mutations = planMergeOrganizedTags(ownedIdeas, tagsToMerge, mergedTag)
    await applyTagMutations(mutations)

    if (activeTag && tagsToMerge.includes(activeTag)) {
      handleTagChange(normalizeTagList([mergedTag])[0] ?? null)
    }
  }

  async function handleDeleteTags(tagsToDelete: string[]) {
    const mutations = planDeleteOrganizedTags(ownedIdeas, tagsToDelete)
    await applyTagMutations(mutations)

    if (activeTag && tagsToDelete.includes(activeTag)) {
      handleTagChange(null)
    }
  }

  async function applyTagMutations(
    mutations: { ideaId: string; tags: string[] }[],
  ) {
    if (mutations.length === 0) {
      return
    }

    await applyOrganizedTagMutations(mutations)

    const mutationMap = new Map(mutations.map((mutation) => [mutation.ideaId, mutation.tags]))
    setOwnedIdeas((prev) => prev.map((idea) => (
      mutationMap.has(idea.id)
        ? { ...idea, tags: mutationMap.get(idea.id) ?? [] }
        : idea
    )))
  }

  // Converte OrganizedIdea em Note sintetica para o SendToBardoModal
  function handleSendToBardo(idea: OrganizedIdea) {
    const sections = idea.content.sections
      .map((s) => `## ${s.title}\n${s.items.map((i) => `- ${i}`).join('\n')}`)
      .join('\n\n')
    const fullText = idea.content.summary
      ? `${idea.content.summary}\n\n${sections}`
      : sections

    const syntheticNote: Note = {
      id: idea.id,
      user_id: idea.user_id,
      raw_text: fullText,
      title: idea.title,
      folder_id: null,
      created_at: idea.created_at,
    }
    setBardoNote(syntheticNote)
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
    next.delete('idea')
    next.delete('sourceNote')
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
    next.delete('idea')
    setSearchParams(next)
  }

  function handleFolderChange(folder: string | null) {
    const next = new URLSearchParams(searchParams)
    if (folder) {
      next.set('folder', folder)
    } else {
      next.delete('folder')
    }
    next.delete('idea')
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

  function clearIdeaContext() {
    const next = new URLSearchParams(searchParams)
    next.delete('idea')
    next.delete('sourceNote')
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
            <p className="text-sm font-medium text-green-800">{t('organized.acceptedTitle')}</p>
            <p className="text-sm text-green-700">
              {t('organized.acceptedDescription')}
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
          {t('organized.tab.mine', { count: ownedIdeas.length })}
        </button>
        <button
          onClick={() => handleTabChange('shared')}
          className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'shared'
              ? 'bg-primary text-white'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          {t('organized.tab.shared', { count: sharedIdeas.length })}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          {activeTab === 'mine' ? t('organized.header.mine') : t('organized.header.shared')}
        </h2>
        {activeTab === 'shared' && (
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-primary">
            <Users className="h-3.5 w-3.5" />
            {t('organized.sharedRead')}
          </div>
        )}
      </div>

      {(focusedIdea || activeSourceNoteId) && activeTab === 'mine' && (
        <div className="rounded-2xl border border-slate-300 bg-slate-100 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                {t('organized.context.title')}
              </div>
              {focusedIdea ? (
                <>
                  <p className="text-sm font-medium text-gray-900">
                    {t('organized.context.focusedIdea', {
                      label: getOrganizationTypeLabel(focusedIdea.type, focusedIdea.note_ids.length, locale).toLocaleLowerCase(locale),
                      title: focusedIdea.title,
                    })}
                  </p>
                  <p className="mt-1 text-xs text-gray-600">
                    {t('organized.context.focusedIdeaHelp')}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-900">
                    {focusedSourceNote
                      ? t('organized.context.sourceNote', { title: focusedSourceNote.title?.trim() || t('note.noTitle') })
                      : t('organized.context.sourceFallback')}
                  </p>
                  <p className="mt-1 text-xs text-gray-600">
                    {t('organized.context.sourceHelp')}
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {focusedIdea && (
                <button
                  type="button"
                  onClick={() => navigate(`/notes?sourceIdea=${encodeURIComponent(focusedIdea.id)}`)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-slate-50"
                >
                  {t('organized.context.openSourceNotes')}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={clearIdeaContext}
                className="rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-white hover:text-primary"
              >
                {t('organized.context.viewAll')}
              </button>
            </div>
          </div>
        </div>
      )}

      {contextIdeas.length > 0 && !focusedIdeaId && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={activeTab === 'mine' ? t('organized.search.placeholder.mine') : t('organized.search.placeholder.shared')}
            aria-label={activeTab === 'mine' ? t('organized.search.aria.mine') : t('organized.search.aria.shared')}
            className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm text-gray-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}

      {contextIdeas.length > 0 && !focusedIdeaId && (
        <TagCloudPanel
          tags={availableTags}
          totalIdeas={contextIdeas.length}
          activeTag={activeTag}
          activeFolder={activeFolder}
          tagFilteredCount={tagFilteredIdeas.length}
          folders={activeTab === 'mine' ? availableFolders : []}
          canManage={activeTab === 'mine'}
          onTagFilter={handleTagChange}
          onFolderFilter={activeTab === 'mine' ? handleFolderChange : undefined}
          onRenameTag={activeTab === 'mine' ? handleRenameTag : undefined}
          onMergeTags={activeTab === 'mine' ? handleMergeTags : undefined}
          onDeleteTags={activeTab === 'mine' ? handleDeleteTags : undefined}
        />
      )}

      {searchedIdeas.length === 0 ? (
        <div className="py-12 text-center">
          <Sparkles className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="font-medium text-gray-500">
            {focusedIdeaId
              ? t('organized.empty.missingFocusedTitle')
              : searchQuery
              ? t('organized.empty.searchTitle')
              : activeTag || activeFolder || activeSourceNoteId
              ? t('organized.empty.scopeTitle')
              : activeTab === 'mine'
              ? t('organized.empty.mineTitle')
              : t('organized.empty.sharedTitle')}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {focusedIdeaId
              ? t('organized.empty.missingFocusedDescription')
              : searchQuery
              ? t('organized.empty.searchDescription')
              : activeTag || activeFolder || activeSourceNoteId
              ? t('organized.empty.scopeDescription')
              : activeTab === 'mine'
              ? t('organized.empty.mineDescription')
              : t('organized.empty.sharedDescription')}
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
            onSendToBardo={handleSendToBardo}
            canDelete={activeTab === 'mine'}
            canShare={activeTab === 'mine'}
            canEditTags={activeTab === 'mine'}
            canSendToBardo={activeTab === 'mine' && bardoBridgeEnabled}
            tags={ideaTags[idea.id] || []}
            folders={activeTab === 'mine' ? (ownedIdeaFolders[idea.id] || []) : []}
            activeTag={activeTag}
            activeFolder={activeFolder}
            onTagClick={handleTagChange}
            onFolderClick={activeTab === 'mine' ? handleFolderChange : undefined}
            sourceNotes={activeTab === 'mine' ? (ownedIdeaSourceNotes[idea.id] || []) : []}
            onOpenSourceNotes={activeTab === 'mine' ? (selectedIdea) => navigate(`/notes?sourceIdea=${encodeURIComponent(selectedIdea.id)}`) : undefined}
            canExport={activeTab === 'mine'}
          />
        ))
      )}

      <ShareIdeaModal
        idea={ideaToShare}
        isOpen={!!ideaToShare}
        onClose={() => setIdeaToShare(null)}
      />

      <SendToBardoModal
        note={bardoNote}
        isOpen={!!bardoNote}
        onClose={() => setBardoNote(null)}
      />
    </div>
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
