import { useState } from 'react'
import { Trash2, Check, Square, Clock, Pencil, Save, X } from 'lucide-react'
import type { Note } from '../types/database'

interface NoteCardProps {
  note: Note
  selected: boolean
  onToggleSelect: (id: string) => void
  onDelete: (id: string) => void
  onEdit?: (id: string, updates: { raw_text?: string; title?: string }) => Promise<void>
}

export function NoteCard({ note, selected, onToggleSelect, onDelete, onEdit }: NoteCardProps) {
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
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium mb-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="w-full h-32 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleSaveEdit}
            disabled={saving || !editText.trim()}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark disabled:bg-gray-300 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
          <button
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
    <div
      className={`bg-white rounded-xl border p-4 transition-all cursor-pointer ${
        selected
          ? 'border-primary ring-2 ring-primary/20'
          : 'border-gray-100 hover:border-gray-200'
      }`}
      onClick={() => onToggleSelect(note.id)}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {selected ? (
            <Check className="w-5 h-5 text-primary" />
          ) : (
            <Square className="w-5 h-5 text-gray-300" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 text-sm truncate">
            {note.title || 'Sem titulo'}
          </h3>
          <p className="text-gray-500 text-xs mt-1 line-clamp-3">{note.raw_text}</p>
          <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
            <Clock className="w-3 h-3" />
            {formattedDate}
          </div>
        </div>
        <div className="flex gap-1">
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setEditing(true)
              }}
              className="p-1.5 rounded-lg transition-colors text-gray-300 hover:text-primary hover:bg-indigo-50"
              title="Editar nota"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (confirmDelete) {
                onDelete(note.id)
              } else {
                setConfirmDelete(true)
                setTimeout(() => setConfirmDelete(false), 3000)
              }
            }}
            className={`p-1.5 rounded-lg transition-colors ${
              confirmDelete
                ? 'bg-red-100 text-red-600'
                : 'text-gray-300 hover:text-red-500 hover:bg-red-50'
            }`}
            title={confirmDelete ? 'Clique novamente para confirmar' : 'Excluir nota'}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
