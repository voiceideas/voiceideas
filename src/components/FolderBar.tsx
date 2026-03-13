import { useState } from 'react'
import { FolderOpen, Pencil, Trash2, Check, X } from 'lucide-react'
import type { Folder } from '../types/database'

interface FolderBarProps {
  folders: Folder[]
  activeFolderId: string | null
  onSelectFolder: (folderId: string | null) => void
  onRename: (id: string, name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function FolderBar({ folders, activeFolderId, onSelectFolder, onRename, onDelete }: FolderBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  if (folders.length === 0) return null

  const startRename = (folder: Folder) => {
    setEditingId(folder.id)
    setEditName(folder.name)
  }

  const saveRename = async () => {
    if (!editingId || !editName.trim()) return
    await onRename(editingId, editName.trim())
    setEditingId(null)
  }

  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      setTimeout(() => setConfirmDeleteId(null), 3000)
      return
    }
    await onDelete(id)
    if (activeFolderId === id) {
      onSelectFolder(null)
    }
    setConfirmDeleteId(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider px-1">
        <FolderOpen className="w-3.5 h-3.5" />
        Pastas
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {/* "Todas" chip */}
        <button
          onClick={() => onSelectFolder(null)}
          className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-colors ${
            activeFolderId === null
              ? 'bg-primary text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Todas
        </button>

        {/* Folder chips */}
        {folders.map((folder) => (
          <div
            key={folder.id}
            className={`flex-shrink-0 flex items-center gap-1 rounded-lg transition-colors ${
              activeFolderId === folder.id
                ? 'bg-primary text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {editingId === folder.id ? (
              <div className="flex items-center gap-1 px-2 py-1">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="w-24 px-1.5 py-0.5 text-xs rounded border border-gray-300 text-gray-900 focus:outline-none focus:border-primary"
                  autoFocus
                />
                <button onClick={saveRename} className="p-0.5 hover:bg-green-100 rounded">
                  <Check className="w-3 h-3 text-green-600" />
                </button>
                <button onClick={() => setEditingId(null)} className="p-0.5 hover:bg-red-100 rounded">
                  <X className="w-3 h-3 text-red-500" />
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => onSelectFolder(folder.id)}
                  className="flex items-center gap-1.5 text-xs font-medium pl-3 py-2 pr-1"
                >
                  {folder.name}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    activeFolderId === folder.id
                      ? 'bg-white/20'
                      : 'bg-gray-200'
                  }`}>
                    {folder.note_count || 0}
                  </span>
                </button>
                <div className="flex items-center pr-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); startRename(folder) }}
                    className={`p-1 rounded transition-colors ${
                      activeFolderId === folder.id
                        ? 'hover:bg-white/20'
                        : 'hover:bg-gray-300'
                    }`}
                    title="Renomear"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(folder.id) }}
                    className={`p-1 rounded transition-colors ${
                      confirmDeleteId === folder.id
                        ? 'bg-red-500 text-white'
                        : activeFolderId === folder.id
                          ? 'hover:bg-white/20'
                          : 'hover:bg-gray-300'
                    }`}
                    title={confirmDeleteId === folder.id ? 'Confirmar exclusao' : 'Excluir pasta'}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
