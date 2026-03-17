import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Check, Trash2, Clock, Share2 } from 'lucide-react'
import type { OrganizedIdea } from '../types/database'
import { TYPE_LABELS } from '../lib/organize'

interface OrganizedViewProps {
  idea: OrganizedIdea
  onDelete?: (id: string) => void
  onShare?: (idea: OrganizedIdea) => void
  canDelete?: boolean
  canShare?: boolean
}

export function OrganizedView({
  idea,
  onDelete,
  onShare,
  canDelete = false,
  canShare = false,
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
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
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
                onClick={() => onShare(idea)}
                className="p-1.5 text-gray-400 hover:text-primary rounded-lg hover:bg-indigo-50"
                title="Compartilhar"
              >
                <Share2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={copyAsMarkdown}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50"
              title="Copiar como Markdown"
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
            {canDelete && onDelete && (
              <button
                onClick={() => {
                  if (confirmDelete) {
                    onDelete(idea.id)
                  } else {
                    setConfirmDelete(true)
                    setTimeout(() => setConfirmDelete(false), 3000)
                  }
                }}
                className={`p-1.5 rounded-lg transition-colors ${
                  confirmDelete
                    ? 'bg-red-100 text-red-600'
                    : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                }`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        {idea.content.summary && (
          <p className="text-sm text-gray-500 mt-2">{idea.content.summary}</p>
        )}
        <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
          <Clock className="w-3 h-3" />
          {formattedDate}
        </div>
      </div>

      {/* Sections */}
      <div className="divide-y divide-gray-50">
        {idea.content.sections.map((section, i) => (
          <div key={i}>
            <button
              onClick={() => toggleSection(i)}
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
              <ul className="px-4 pb-4 pl-10 space-y-1.5">
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
    </div>
  )
}
