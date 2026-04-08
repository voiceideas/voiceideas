import { useState } from 'react'
import { VoiceRecorder } from '../components/VoiceRecorder'
import { NotesList } from '../components/NotesList'
import { OrganizePanel } from '../components/OrganizePanel'
import { useNotes } from '../hooks/useNotes'
import { useUserProfile } from '../hooks/useUserProfile'
import { getErrorMessage } from '../lib/errors'
import type { OrganizationType } from '../types/database'
import { idleCaptureMagicState, type CaptureMagicMode, type CaptureMagicState } from '../types/magicCapture'
import { runCaptureMagicFlow } from '../services/captureMagicService'
import { createOrganizedIdeaFromNotes, findExactOrganizedIdeaForNoteSet } from '../services/organizedIdeaService'
import { useNavigate } from 'react-router-dom'
import type { VoiceSegmentationSettings } from '../types/segmentation'

export function Home() {
  const { notes, loading, addNote, upsertCapturedNote, deleteNote, updateNote, refetch: refetchNotes } = useNotes()
  const { todayCount, dailyLimit, remainingToday, canCreateNote, refetch: refetchProfile } = useUserProfile()
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [captureMagicState, setCaptureMagicState] = useState<CaptureMagicState>(idleCaptureMagicState)
  const navigate = useNavigate()
  const looseNotes = notes.filter((note) => !note.folder_id)

  const handleSave = async (text: string) => {
    const note = await addNote(text)
    setSaveMessage('Nota salva.')
    refetchProfile()
    if (note) {
      setSelectedIds([note.id])
    }
    setTimeout(() => setSaveMessage(null), 3000)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    )
  }

  const handleOrganize = async (type: OrganizationType) => {
    setError(null)
    const noteById = new Map(notes.map((note) => [note.id, note]))
    const selectedNotes = selectedIds
      .map((noteId) => noteById.get(noteId))
      .filter((note): note is (typeof notes)[number] => Boolean(note))

    try {
      await createOrganizedIdeaFromNotes(selectedNotes, type)
      setSelectedIds([])
      navigate('/organized')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Não foi possível organizar as notas agora.')
    }
  }

  const handleRunCaptureFlow = async (input: {
    sessionId: string
    mode: CaptureMagicMode
    segmentationSettings: VoiceSegmentationSettings
  }) => {
    setError(null)
    setSaveMessage(null)
    setCaptureMagicState({
      status: 'running',
      mode: input.mode,
      sessionId: input.sessionId,
      progress: {
        phase: 'segmenting',
        label: input.mode === 'magic'
          ? 'Separando a gravação em ideias...'
          : 'Preparando uma nota bruta da gravação...',
      },
      result: null,
      error: null,
    })

    try {
      const result = await runCaptureMagicFlow({
        sessionId: input.sessionId,
        mode: input.mode,
        segmentationSettings: input.segmentationSettings,
        saveCapturedNote: upsertCapturedNote,
        createInitialGrouping: async (capturedNotes) => {
          if (capturedNotes.length < 2) {
            return null
          }

          const existingIdea = await findExactOrganizedIdeaForNoteSet(
            capturedNotes.map((note) => note.id),
            'topicos',
          )

          if (existingIdea) {
            return existingIdea
          }

          return createOrganizedIdeaFromNotes(capturedNotes, 'topicos')
        },
        onProgress: (progress) => {
          setCaptureMagicState((previous) => ({
            ...previous,
            status: 'running',
            mode: input.mode,
            sessionId: input.sessionId,
            progress,
            result: null,
            error: null,
          }))
        },
      })

      await Promise.all([
        refetchProfile(),
        refetchNotes(),
      ])

      setCaptureMagicState({
        status: 'success',
        mode: input.mode,
        sessionId: input.sessionId,
        progress: {
          phase: 'completed',
          label: 'Tudo pronto.',
        },
        result,
        error: null,
      })
    } catch (captureMagicError) {
      setCaptureMagicState({
        status: 'error',
        mode: input.mode,
        sessionId: input.sessionId,
        progress: null,
        result: null,
        error: getErrorMessage(captureMagicError, 'Não foi possível concluir o processamento automático desta gravação.'),
      })
    }
  }

  const recentNotes = looseNotes.slice(0, 5)

  return (
    <div className="space-y-6">
      <VoiceRecorder
        onSave={handleSave}
        canSave={canCreateNote}
        remainingNotes={remainingToday}
        todayCount={todayCount}
        dailyLimit={dailyLimit}
        captureMagicState={captureMagicState}
        onRunCaptureFlow={handleRunCaptureFlow}
      />

      {saveMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 text-center">
          {saveMessage}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Painel de organizar aparece quando ha notas selecionadas */}
      <OrganizePanel selectedCount={selectedIds.length} onOrganize={handleOrganize} />

      {recentNotes.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Notas recentes
          </h2>
          <NotesList
            notes={recentNotes}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onDelete={deleteNote}
            onEdit={async (id, updates) => { await updateNote(id, updates) }}
            loading={loading}
            emptyTitle="Nenhuma nota solta no fluxo principal"
            emptyDescription="Notas que já estão em pastas deixam de aparecer aqui."
          />
        </div>
      )}

      {!loading && recentNotes.length === 0 && notes.length > 0 && (
        <div className="rounded-lg border border-slate-300 bg-slate-100 p-4 text-sm text-slate-700">
          Todas as suas notas recentes já estão em pastas. Aqui aparecem apenas notas sem pasta.
        </div>
      )}
    </div>
  )
}
