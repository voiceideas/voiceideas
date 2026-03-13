import { NoteCard } from './NoteCard'
import { FileText } from 'lucide-react'
import type { Note } from '../types/database'

interface NotesListProps {
  notes: Note[]
  selectedIds: string[]
  onToggleSelect: (id: string) => void
  onDelete: (id: string) => void
  onEdit?: (id: string, updates: { raw_text?: string; title?: string }) => Promise<void>
  loading: boolean
}

export function NotesList({ notes, selectedIds, onToggleSelect, onDelete, onEdit, loading }: NotesListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-full mb-1" />
            <div className="h-3 bg-gray-100 rounded w-2/3" />
          </div>
        ))}
      </div>
    )
  }

  if (notes.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500 font-medium">Nenhuma nota ainda</p>
        <p className="text-gray-400 text-sm mt-1">
          Grave sua primeira nota de voz acima
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          selected={selectedIds.includes(note.id)}
          onToggleSelect={onToggleSelect}
          onDelete={onDelete}
          onEdit={onEdit}
        />
      ))}
    </div>
  )
}
