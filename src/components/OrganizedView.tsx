import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Check, Trash2, Clock, Share2, X, FolderOpen, Tags, Pencil, Link2, FileText, ArrowUpRight } from 'lucide-react'
import type { OrganizedIdea, SourceNotePreview } from '../types/database'
import { getOrganizationTypeLabel } from '../lib/organize'
import { buildInitialIdeaTags, normalizeTagList } from '../lib/organizedTags'

interface OrganizedViewProps {
  idea: OrganizedIdea
  onDelete?: (id: string) => void
  onShare?: (idea: OrganizedIdea) => void
  onUpdateTags?: (id: string, tags: string[]) => Promise<void>
  canDelete?: boolean
  canShare?: boolean
  canEditTags?: boolean
  tags?: string[]
  folders?: string[]
  activeTag?: string | null
  activeFolder?: string | null
  onTagClick?: (tag: string | null) => void
  onFolderClick?: (folder: string | null) => void
  sourceNotes?: SourceNotePreview[]
  onOpenSourceNotes?: (idea: OrganizedIdea) => void
}

export function OrganizedView({
  idea,
  onDelete,
  onShare,
  onUpdateTags,
  canDelete = false,
  canShare = false,
  canEditTags = false,
  tags = [],
  folders = [],
  activeTag = null,
  activeFolder = null,
  onTagClick,
  onFolderClick,
  sourceNotes = [],
  onOpenSourceNotes,
}: OrganizedViewProps) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    new Set(idea.content.sections.map((_, i) => i)),
  )
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editingTags, setEditingTags] = useState(false)
  const [tagDraft, setTagDraft] = useState<string[]>(tags)
  const [tagInput, setTagInput] = useState('')
  const [savingTags, setSavingTags] = useState(false)
  const [tagError, setTagError] = useState<string | null>(null)
  const [showSourceNotes, setShowSourceNotes] = useState(false)
  const suggestedTags = buildInitialIdeaTags(idea.type, idea.title, idea.content, idea.note_ids.length)
    .filter((suggestion) => !tagDraft.some((tag) => tag.toLocaleLowerCase('pt-BR') === suggestion.toLocaleLowerCase('pt-BR')))

  useEffect(() => {
    setTagDraft(tags)
    setTagInput('')
  }, [tags])

  const toggleSection = (index: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const copyAsMarkdown = () => {
    let md = `# ${idea.title}\n\n`
    if (idea.content.summary) {
      md += `${idea.content.summary}\n\n`
    }
    for (const section of idea.content.sections) {
      md += `## ${section.title}\n\n`
      for (const item of section.items) {
        md += `- ${item}\n`
      }
      md += '\n'
    }
    navigator.clipboard.writeText(md)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const date = new Date(idea.created_at)
  const formattedDate = date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  const handleSaveTags = async () => {
    if (!onUpdateTags) return

    setSavingTags(true)
    setTagError(null)

    try {
      await onUpdateTags(idea.id, tagDraft)
      setEditingTags(false)
    } catch (error: unknown) {
      setTagError(error instanceof Error ? error.message : 'Não foi possível salvar as tags.')
    } finally {
      setSavingTags(false)
    }
  }

  const addDraftTag = (value: string) => {
    const nextTags = normalizeTagList([...tagDraft, value])
    setTagDraft(nextTags)
    setTagInput('')
  }

  const removeDraftTag = (tagToRemove: string) => {
    setTagDraft((current) => current.filter((tag) => tag !== tagToRemove))
  }

  return (
    <article className="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div className="p-4 border-b border-gray-50">
        <div className="flex items-start justify-between">
          <div>
            <span className="mb-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-primary">
              {getOrganizationTypeLabel(idea.type, idea.note_ids.length)}
            </span>
            <span className="mb-1 ml-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              {idea.note_ids.length > 1
                ? `Consolidação de ${idea.note_ids.length} notas`
                : 'Derivada de 1 nota'}
            </span>
            <h3 className="font-semibold text-gray-900">{idea.title}</h3>
          </div>
          <div className="flex items-center gap-1">
            {canShare && onShare && (
              <button
                type="button"
                onClick={() => onShare(idea)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-slate-100 hover:text-primary"
                aria-label={`Compartilhar ideia ${idea.title}`}
              >
                <Share2 className="w-4 h-4" />
              </button>
            )}
            {canEditTags && onUpdateTags && (
              <button
                type="button"
                onClick={() => {
                  setEditingTags((prev) => !prev)
                  setTagError(null)
                  setTagDraft(tags)
                  setTagInput('')
                }}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-slate-100 hover:text-primary"
                aria-label={`Editar tags da ideia ${idea.title}`}
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={copyAsMarkdown}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50"
              aria-label={copied ? 'Markdown copiado' : `Copiar ideia ${idea.title} como Markdown`}
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
            {canDelete && onDelete && (
              confirmDelete ? (
                <>
                  <button
                    type="button"
                    onClick={() => onDelete(idea.id)}
                    className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                    aria-label={`Confirmar exclusão da ideia ${idea.title}`}
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                    aria-label="Cancelar exclusão"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  aria-label={`Excluir ideia ${idea.title}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )
            )}
          </div>
        </div>
        {idea.content.summary && (
          <p className="text-sm text-gray-500 mt-2">{idea.content.summary}</p>
        )}
        {sourceNotes.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            <div className="flex flex-col gap-3 px-3 py-3 md:flex-row md:items-start md:justify-between">
              <button
                type="button"
                onClick={() => setShowSourceNotes((current) => !current)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                    <Link2 className="h-3.5 w-3.5" />
                    Notas-fonte
                  </div>
                  <p className="text-sm font-medium text-gray-900">
                    {idea.note_ids.length > 1
                      ? `Consolidação derivada de ${sourceNotes.length} notas salvas`
                      : 'Ideia organizada derivada de 1 nota salva'}
                  </p>
                  <p className="text-xs text-gray-500">
                    As notas originais continuam intactas no acervo e este resultado é um artefato novo.
                  </p>
                </div>
                {showSourceNotes ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />
                )}
              </button>
              {onOpenSourceNotes && (
                <button
                  type="button"
                  onClick={() => onOpenSourceNotes(idea)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-slate-100"
                >
                  Abrir notas-fonte
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {showSourceNotes && (
              <div className="space-y-2 border-t border-slate-200 px-3 py-3">
                {sourceNotes.map((note, index) => (
                  <div key={note.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-500">
                      <FileText className="h-3.5 w-3.5" />
                      Nota {index + 1}
                    </div>
                    <p className="text-sm font-medium text-gray-900">
                      {note.title?.trim() || `Nota criada em ${new Date(note.created_at).toLocaleDateString('pt-BR')}`}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {truncateNotePreview(note.raw_text)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {editingTags && canEditTags && onUpdateTags && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-100/80 p-3">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-primary">
              Editar tags
            </label>
            <div className="rounded-xl border border-slate-300 bg-white p-3">
              {tagDraft.length > 0 && (
                <div className="max-h-28 overflow-y-auto pr-1">
                  <div className="flex flex-wrap gap-2">
                    {tagDraft.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-white"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeDraftTag(tag)}
                          className="rounded-full p-0.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
                          aria-label={`Remover tag ${tag}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.key === 'Enter' || event.key === ',') && tagInput.trim()) {
                      event.preventDefault()
                      addDraftTag(tagInput)
                    }
                    if (event.key === 'Backspace' && !tagInput && tagDraft.length > 0) {
                      setTagDraft((current) => current.slice(0, -1))
                    }
                  }}
                  onBlur={() => {
                    if (tagInput.trim()) {
                      addDraftTag(tagInput)
                    }
                  }}
                  placeholder={tagDraft.length === 0 ? 'Digite uma tag e pressione Enter' : 'Adicionar tag'}
                  aria-label={`Adicionar tag a ideia ${idea.title}`}
                  className="w-full bg-transparent py-1 text-sm text-gray-700 outline-none placeholder:text-gray-400"
                />
              </div>
            </div>
            {suggestedTags.length > 0 && (
              <div className="mt-3">
                <p className="mb-2 text-xs font-medium text-gray-500">Sugestões da própria ideia</p>
                <div className="flex flex-wrap gap-2">
                  {suggestedTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addDraftTag(tag)}
                      className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
                    >
                      + {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-gray-500">
              Use Enter ou vírgula para adicionar. Se deixar vazio, a ideia fica sem tags visíveis.
            </p>
            {tagError && (
              <p className="mt-2 text-xs text-red-600">{tagError}</p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingTags(false)
                  setTagError(null)
                  setTagDraft(tags)
                  setTagInput('')
                }}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleSaveTags()}
                disabled={savingTags}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingTags ? 'Salvando...' : 'Salvar tags'}
              </button>
            </div>
          </div>
        )}
        {tags.length > 0 && (
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              <Tags className="h-3 w-3" />
              Tags
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <MetaChip
                  key={tag}
                  label={tag}
                  active={activeTag === tag}
                  onClick={onTagClick ? () => onTagClick(activeTag === tag ? null : tag) : undefined}
                />
              ))}
            </div>
          </div>
        )}
        {folders.length > 0 && (
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              <FolderOpen className="h-3 w-3" />
              Pastas de origem
            </div>
            <div className="flex flex-wrap gap-2">
              {folders.map((folder) => (
                <MetaChip
                  key={folder}
                  label={folder}
                  active={activeFolder === folder}
                  tone="amber"
                  onClick={onFolderClick ? () => onFolderClick(activeFolder === folder ? null : folder) : undefined}
                />
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
          <Clock className="w-3 h-3" />
          {formattedDate}
        </div>
      </div>

      <div className="divide-y divide-gray-50">
        {idea.content.sections.map((section, i) => (
          <div key={i}>
            <button
              type="button"
              onClick={() => toggleSection(i)}
              aria-expanded={expandedSections.has(i)}
              aria-controls={`idea-${idea.id}-section-${i}`}
              className="w-full flex items-center gap-2 p-4 text-left hover:bg-gray-50 transition-colors"
            >
              {expandedSections.has(i) ? (
                <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              )}
              <span className="font-medium text-sm text-gray-800">{section.title}</span>
              <span className="text-xs text-gray-400 ml-auto">
                {section.items.length} {section.items.length === 1 ? 'item' : 'itens'}
              </span>
            </button>
            {expandedSections.has(i) && (
              <ul id={`idea-${idea.id}-section-${i}`} className="px-4 pb-4 pl-10 space-y-1.5">
                {section.items.map((item, j) => (
                  <li key={j} className="text-sm text-gray-600 flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </article>
  )
}

function truncateNotePreview(text: string) {
  const trimmed = text.trim()
  if (trimmed.length <= 220) {
    return trimmed
  }

  return `${trimmed.slice(0, 217).trimEnd()}...`
}

function MetaChip({
  label,
  active,
  onClick,
  tone = 'indigo',
}: {
  label: string
  active: boolean
  onClick?: () => void
  tone?: 'indigo' | 'amber'
}) {
  const baseClass = tone === 'amber'
    ? active
      ? 'bg-amber-500 text-white'
      : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
    : active
      ? 'bg-primary text-white'
      : 'bg-slate-100 text-primary hover:bg-slate-200'

  const content = (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${baseClass}`}>
      {label}
    </span>
  )

  if (!onClick) {
    return content
  }

  return (
    <button type="button" onClick={onClick} className="rounded-full">
      {content}
    </button>
  )
}
