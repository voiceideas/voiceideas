import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Check, Trash2, Clock, Share2, X, FolderOpen, Tags } from 'lucide-react'
import type { OrganizedIdea } from '../types/database'
import { TYPE_LABELS } from '../lib/organize'

interface OrganizedViewProps {
  idea: OrganizedIdea
  onDelete?: (id: string) => void
  onShare?: (idea: OrganizedIdea) => void
  canDelete?: boolean
  canShare?: boolean
  tags?: string[]
  folders?: string[]
  activeTag?: string | null
  activeFolder?: string | null
  onTagClick?: (tag: string | null) => void
  onFolderClick?: (folder: string | null) => void
}

export function OrganizedView({
  idea,
  onDelete,
  onShare,
  canDelete = false,
  canShare = false,
  tags = [],
  folders = [],
  activeTag = null,
  activeFolder = null,
  onTagClick,
  onFolderClick,
}: OrganizedViewProps) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    new Set(idea.content.sections.map((_, i) => i)),
  )
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

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

  return (
    <article className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-gray-50">
        <div className="flex items-start justify-between">
          <div>
            <span className="inline-block text-xs font-medium text-primary bg-indigo-50 px-2 py-0.5 rounded-full mb-1">
              {TYPE_LABELS[idea.type]}
            </span>
            <h3 className="font-semibold text-gray-900">{idea.title}</h3>
          </div>
          <div className="flex items-center gap-1">
            {canShare && onShare && (
              <button
                type="button"
                onClick={() => onShare(idea)}
                className="p-1.5 text-gray-400 hover:text-primary rounded-lg hover:bg-indigo-50"
                aria-label={`Compartilhar ideia ${idea.title}`}
              >
                <Share2 className="w-4 h-4" />
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
                    aria-label={`Confirmar exclusao da ideia ${idea.title}`}
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                    aria-label="Cancelar exclusao"
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
      : 'bg-indigo-50 text-primary hover:bg-indigo-100'

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
