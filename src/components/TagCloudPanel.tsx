import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, FolderOpen, Pencil, Tags, Trash2 } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import type { IdeaTag } from '../lib/organizedTags'

export interface TagCloudFilter {
  label: string
  count: number
}

interface TagCloudPanelProps {
  tags: IdeaTag[]
  totalIdeas: number
  activeTag: string | null
  activeFolder?: string | null
  tagFilteredCount?: number
  folders?: TagCloudFilter[]
  canManage?: boolean
  onTagFilter: (tag: string | null) => void
  onFolderFilter?: (folder: string | null) => void
  onRenameTag?: (currentTag: string, nextTag: string) => Promise<void>
  onMergeTags?: (tags: string[], mergedTag: string) => Promise<void>
  onDeleteTags?: (tags: string[]) => Promise<void>
}

type TagAction = 'rename' | 'merge' | 'delete' | null

const COLLAPSED_BY_DEFAULT_THRESHOLD = 8
const LONG_PRESS_MS = 450

export function TagCloudPanel({
  tags,
  totalIdeas,
  activeTag,
  activeFolder = null,
  tagFilteredCount = totalIdeas,
  folders = [],
  canManage = false,
  onTagFilter,
  onFolderFilter,
  onRenameTag,
  onMergeTags,
  onDeleteTags,
}: TagCloudPanelProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(() => tags.length <= COLLAPSED_BY_DEFAULT_THRESHOLD)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [action, setAction] = useState<TagAction>(null)
  const [draftValue, setDraftValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectionMode = selectedTags.length > 0

  useEffect(() => {
    if ((activeTag || activeFolder || selectionMode) && !expanded) {
      setExpanded(true)
    }
  }, [activeFolder, activeTag, expanded, selectionMode])

  useEffect(() => {
    if (!selectionMode) {
      setAction(null)
      setDraftValue('')
      return
    }

    if (action === 'rename' && selectedTags.length !== 1) {
      setAction(null)
      setDraftValue('')
    }

    if (action === 'merge' && selectedTags.length < 2) {
      setAction(null)
      setDraftValue('')
    }
  }, [action, selectedTags, selectionMode])

  useEffect(() => {
    if (!feedback) return

    const timeout = window.setTimeout(() => setFeedback(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  const clearSelection = () => {
    setSelectedTags([])
    setAction(null)
    setDraftValue('')
    setError(null)
  }

  const toggleSelectedTag = (tag: string) => {
    setSelectedTags((current) => (
      current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag]
    ))
    setError(null)
    setFeedback(null)
  }

  const beginSelection = (tag: string) => {
    if (!canManage) return

    setExpanded(true)
    setSelectedTags((current) => (current.includes(tag) ? current : [...current, tag]))
    setError(null)
    setFeedback(null)
  }

  const startRename = () => {
    if (selectedTags.length !== 1) return
    setAction('rename')
    setDraftValue(selectedTags[0])
    setError(null)
    setFeedback(null)
  }

  const startMerge = () => {
    if (selectedTags.length < 2) return
    setAction('merge')
    setDraftValue(selectedTags[0])
    setError(null)
    setFeedback(null)
  }

  const startDelete = () => {
    if (selectedTags.length === 0) return
    setAction('delete')
    setError(null)
    setFeedback(null)
  }

  const handleConfirmAction = async () => {
    if (!canManage) return

    setSubmitting(true)
    setError(null)
    setFeedback(null)

    try {
      if (action === 'rename' && onRenameTag && selectedTags.length === 1) {
        await onRenameTag(selectedTags[0], draftValue)
        setFeedback(t('tags.feedback.updated'))
      } else if (action === 'merge' && onMergeTags && selectedTags.length >= 2) {
        await onMergeTags(selectedTags, draftValue)
        setFeedback(t('tags.feedback.merged'))
      } else if (action === 'delete' && onDeleteTags && selectedTags.length >= 1) {
        await onDeleteTags(selectedTags)
        setFeedback(selectedTags.length === 1 ? t('tags.feedback.deleted.one') : t('tags.feedback.deleted.other'))
      }

      clearSelection()
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : t('tags.error.update'))
    } finally {
      setSubmitting(false)
    }
  }

  const summaryText = activeTag
    ? t('tags.summary.active', { count: tagFilteredCount, tag: activeTag })
    : t('tags.summary.default', { tagCount: tags.length, totalIdeas })

  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            <Tags className="h-3.5 w-3.5" />
            {t('tags.title')}
          </div>
          <p className="text-sm text-gray-800">{summaryText}</p>
          {canManage && (
            <p className="mt-1 text-xs text-gray-500">
              {t('tags.manageHint')}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectionMode && (
            <button
              type="button"
              onClick={clearSelection}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
              {t('tags.cancelSelection')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-slate-50"
          >
            {expanded ? (
              <>
                {t('tags.hide')}
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                {t('tags.show')}
                <ChevronRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {feedback}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {!expanded && (
        <div className="flex flex-wrap gap-2">
          <SummaryPill label={t('tags.summaryCount', { count: tags.length })} />
          {activeTag && <SummaryPill label={t('tags.filter', { tag: activeTag })} tone="primary" />}
          {activeFolder && <SummaryPill label={t('tags.folder', { folder: activeFolder })} tone="amber" />}
        </div>
      )}

      {expanded && selectionMode && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900">
                {t('tags.selectionCount', { count: selectedTags.length })}
              </p>
              <p className="text-xs text-gray-500">
                {t('tags.selectionDescription')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startRename}
                disabled={selectedTags.length !== 1}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t('tags.action.edit')}
              </button>
              <button
                type="button"
                onClick={startMerge}
                disabled={selectedTags.length < 2}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {t('tags.action.merge')}
              </button>
              <button
                type="button"
                onClick={startDelete}
                disabled={selectedTags.length < 1}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('tags.action.delete')}
              </button>
            </div>
          </div>

          {action && (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              {(action === 'rename' || action === 'merge') ? (
                <>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {action === 'rename' ? t('tags.renameLabel') : t('tags.mergeLabel')}
                  </label>
                  <input
                    type="text"
                    value={draftValue}
                    onChange={(event) => setDraftValue(event.target.value)}
                    placeholder={action === 'rename' ? t('tags.renamePlaceholder') : t('tags.mergePlaceholder')}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </>
              ) : (
                <p className="text-sm text-gray-700">
                  {selectedTags.length === 1
                    ? t('tags.deleteConfirm.one', { tag: selectedTags[0] })
                    : t('tags.deleteConfirm.other', { count: selectedTags.length })}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAction(null)
                    setDraftValue('')
                    setError(null)
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmAction()}
                  disabled={submitting || ((action === 'rename' || action === 'merge') && !draftValue.trim())}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting
                    ? t('common.saving')
                    : action === 'rename'
                      ? t('tags.saveName')
                      : action === 'merge'
                        ? t('tags.mergeTags')
                        : t('tags.deleteTags')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {expanded && (
        <>
          <div className="flex flex-wrap gap-2">
            {!selectionMode && (
                <FilterPill
                  label={t('tags.all')}
                  count={totalIdeas}
                active={!activeTag}
                onClick={() => onTagFilter(null)}
              />
            )}

            {tags.map((tag) => (
              <ManagedTagPill
                key={tag.label}
                label={tag.label}
                count={tag.count}
                active={!selectionMode && activeTag === tag.label}
                selected={selectedTags.includes(tag.label)}
                selectionMode={selectionMode}
                canManage={canManage}
                onFilter={() => onTagFilter(activeTag === tag.label ? null : tag.label)}
                onLongPress={() => beginSelection(tag.label)}
                onToggleSelection={() => toggleSelectedTag(tag.label)}
              />
            ))}
          </div>

          {onFolderFilter && folders.length > 0 && !selectionMode && (
            <div className="border-t border-slate-200 pt-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <FolderOpen className="h-3.5 w-3.5" />
                {t('tags.foldersInTag')}
              </div>
              <div className="flex flex-wrap gap-2">
                <FilterPill
                  label={t('tags.allFolders')}
                  count={tagFilteredCount}
                  active={!activeFolder}
                  onClick={() => onFolderFilter(null)}
                />
                {folders.map((folder) => (
                  <FilterPill
                    key={folder.label}
                    label={folder.label}
                    count={folder.count}
                    active={activeFolder === folder.label}
                    onClick={() => onFolderFilter(folder.label)}
                    tone="amber"
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function ManagedTagPill({
  label,
  count,
  active,
  selected,
  selectionMode,
  canManage,
  onFilter,
  onLongPress,
  onToggleSelection,
}: {
  label: string
  count: number
  active: boolean
  selected: boolean
  selectionMode: boolean
  canManage: boolean
  onFilter: () => void
  onLongPress: () => void
  onToggleSelection: () => void
}) {
  const timeoutRef = useRef<number | null>(null)
  const longPressTriggeredRef = useRef(false)

  const clearLongPress = () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const handlePointerDown = () => {
    if (!canManage || selectionMode) return

    longPressTriggeredRef.current = false
    timeoutRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true
      onLongPress()
    }, LONG_PRESS_MS)
  }

  const handlePointerUp = () => {
    clearLongPress()
  }

  const handleClick = () => {
    if (selectionMode) {
      onToggleSelection()
      return
    }

    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      return
    }

    onFilter()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onContextMenu={(event) => {
        if (!canManage) return
        event.preventDefault()
        onLongPress()
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={clearLongPress}
      onPointerCancel={clearLongPress}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
        selectionMode
          ? selected
            ? 'bg-primary text-white ring-2 ring-primary/20'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          : active
            ? 'bg-primary text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      <span>{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${
        selectionMode
          ? selected
            ? 'bg-white/20'
            : 'bg-white text-gray-500'
          : active
            ? 'bg-white/20'
            : 'bg-white text-gray-500'
      }`}>
        {count}
      </span>
    </button>
  )
}

function FilterPill({
  label,
  count,
  active,
  onClick,
  tone = 'primary',
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  tone?: 'primary' | 'amber'
}) {
  const activeClass = tone === 'amber'
    ? 'bg-amber-500 text-white'
    : 'bg-primary text-white'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? activeClass
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

function SummaryPill({
  label,
  tone = 'neutral',
}: {
  label: string
  tone?: 'neutral' | 'primary' | 'amber'
}) {
  const className = tone === 'primary'
    ? 'bg-slate-100 text-primary'
    : tone === 'amber'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-gray-100 text-gray-600'

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}
