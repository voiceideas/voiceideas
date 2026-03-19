import { useState } from 'react'
import { Trash2, Check, Square, Clock, Pencil, Save, X, FolderOpen } from 'lucide-react'
import type { Note } from '../types/database'

interface NoteCardProps {
  note: Note
  selected: boolean
  onToggleSelect: (id: string) => void
  onDelete: (id: string) => void
  onEdit?: (id: string, updates: { raw_text?: string; title?: string }) => Promise<void>
  folderName?: string
}

export function NoteCard({ note, selected, onToggleSelect, onDelete, onEdit, folderName }: NoteCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(note.title || '')
  const [editText, setEditText] = useState(note.raw_text)
  const [saving, setSaving] = useState(false)

  const date = new Date(note.created_at)
  const formattedDate = date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const noteLabel = note.title || 'Sem titulo'

  const handleSaveEdit = async () => {
    if (!onEdit || !editText.trim()) return
    setSaving(true)
    try {
      await onEdit(note.id, { raw_text: editText.trim(), title: editTitle.trim() || undefined })
      setEditing(false)
    } catch {
      // error handled by parent
    } finally {
      setSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setEditTitle(note.title || '')
    setEditText(note.raw_text)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="bg-white rounded-xl border border-primary ring-2 ring-primary/20 p-4">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          placeholder="Titulo da nota"
          aria-label="Titulo da nota"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium mb-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          aria-label="Texto da nota"
          className="w-full h-32 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={handleSaveEdit}
            disabled={saving || !editText.trim()}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark disabled:bg-gray-300 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={handleCancelEdit}
            className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 py-2 px-4 rounded-lg text-sm border border-gray-200 hover:border-gray-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <article
      className={`bg-white rounded-xl border p-4 transition-all ${
        selected
          ? 'border-primary ring-2 ring-primary/20'
          : 'border-gray-100 hover:border-gray-200'
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onToggleSelect(note.id)}
          aria-pressed={selected}
          aria-label={`${selected ? 'Desmarcar' : 'Selecionar'} nota ${noteLabel}`}
          className="flex flex-1 min-w-0 items-start gap-3 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <div className="mt-0.5">
            {selected ? (
              <Check className="w-5 h-5 text-primary" aria-hidden="true" />
            ) : (
              <Square className="w-5 h-5 text-gray-300" aria-hidden="true" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-gray-900 text-sm truncate">{noteLabel}</h3>
            <p className="text-gray-500 text-xs mt-1 line-clamp-3">{note.raw_text}</p>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <Clock className="w-3 h-3" aria-hidden="true" />
                {formattedDate}
              </div>
              {folderName && (
                <div className="flex items-center gap-1 text-xs text-indigo-400 bg-indigo-50 px-1.5 py-0.5 rounded">
                  <FolderOpen className="w-3 h-3" aria-hidden="true" />
                  {folderName}
                </div>
              )}
            </div>
          </div>
        </button>
        <div className="flex gap-1 shrink-0">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setEditing(true)
              }}
              className="p-1.5 rounded-lg transition-colors text-gray-300 hover:text-primary hover:bg-indigo-50"
              aria-label={`Editar nota ${noteLabel}`}
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(note.id)
                }}
                className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                aria-label={`Confirmar exclusao da nota ${noteLabel}`}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmDelete(false)
                }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Cancelar exclusao"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setConfirmDelete(true)
              }}
              className="p-1.5 rounded-lg transition-colors text-gray-300 hover:text-red-500 hover:bg-red-50"
              aria-label={`Excluir nota ${noteLabel}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
