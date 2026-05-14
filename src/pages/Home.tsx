import { useEffect, useMemo, useState } from 'react'
import { Eraser } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { VoiceRecorder } from '../components/VoiceRecorder'
import { NotesList } from '../components/NotesList'
import { OrganizePanel } from '../components/OrganizePanel'
import { StatusBanner } from '../components/StatusBanner'
import { useI18n } from '../hooks/useI18n'
import { useNotes } from '../hooks/useNotes'
import { useRecorderUiPreferences } from '../hooks/useRecorderUiPreferences'
import { useUserProfile } from '../hooks/useUserProfile'
import { getErrorMessage } from '../lib/errors'
import type { OrganizationType } from '../types/database'
import { idleCaptureMagicState, type CaptureMagicMode, type CaptureMagicState } from '../types/magicCapture'
import { runCaptureMagicFlow } from '../services/captureMagicService'
import { createOrganizedIdeaFromNotes, findExactOrganizedIdeaForNoteSet } from '../services/organizedIdeaService'
import type { VoiceSegmentationSettings } from '../types/segmentation'

export function Home() {
  const { t, locale } = useI18n()
  const { notes, loading, addNote, upsertCapturedNote, deleteNote, updateNote, refetch: refetchNotes } = useNotes()
  const { todayCount, dailyLimit, remainingToday, canCreateNote, refetch: refetchProfile } = useUserProfile()
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [captureMagicState, setCaptureMagicState] = useState<CaptureMagicState>(idleCaptureMagicState)
  const navigate = useNavigate()
  // VI_MOBILE.RECORDING_DEFAULTS_AND_RECENTS_CLEANUP (2026-05-14):
  // `hideRecentNoteIds` esconde notas APENAS da lista de recentes na
  // tela Gravar. Não apaga do banco — usuário vê em Notas/Fila/Organizadas.
  const {
    preferences: recorderUiPreferences,
    hideRecentNoteIds,
    pruneHiddenRecentNoteIds,
  } = useRecorderUiPreferences()
  const [recentsCleanedAt, setRecentsCleanedAt] = useState<number | null>(null)
  const looseNotes = notes.filter((note) => !note.folder_id)
  const hiddenIdsSet = useMemo(
    () => new Set(recorderUiPreferences.hiddenRecentNoteIds),
    [recorderUiPreferences.hiddenRecentNoteIds],
  )
  // Sweep: remove IDs de notas que já não existem (deletadas, etc).
  useEffect(() => {
    if (loading || recorderUiPreferences.hiddenRecentNoteIds.length === 0) return
    pruneHiddenRecentNoteIds(notes.map((n) => n.id))
  }, [loading, notes, pruneHiddenRecentNoteIds, recorderUiPreferences.hiddenRecentNoteIds.length])

  const handleSave = async (text: string) => {
    const note = await addNote(text)
    setSaveMessage(t('home.noteSaved'))
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
      await createOrganizedIdeaFromNotes(selectedNotes, type, locale)
      setSelectedIds([])
      navigate('/organized')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('home.organizeError'))
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
          ? t('home.progress.segmentingMagic')
          : t('home.progress.preparingRaw'),
      },
      result: null,
      error: null,
    })

    try {
      const result = await runCaptureMagicFlow({
        sessionId: input.sessionId,
        mode: input.mode,
        locale,
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

          return createOrganizedIdeaFromNotes(capturedNotes, 'topicos', locale)
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
          label: t('common.done'),
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
        error: getErrorMessage(captureMagicError, t('home.magicError')),
      })
    }
  }

  const visibleLooseNotes = looseNotes.filter((note) => !hiddenIdsSet.has(note.id))
  const recentNotes = visibleLooseNotes.slice(0, 5)

  const handleClearRecents = () => {
    if (recentNotes.length === 0) return
    hideRecentNoteIds(recentNotes.map((note) => note.id))
    setSelectedIds([])
    setRecentsCleanedAt(Date.now())
  }

  useEffect(() => {
    if (recentsCleanedAt === null) return
    const timer = window.setTimeout(() => setRecentsCleanedAt(null), 4000)
    return () => window.clearTimeout(timer)
  }, [recentsCleanedAt])

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
        <StatusBanner key={saveMessage} variant="success" className="text-center">
          {saveMessage}
        </StatusBanner>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Painel de organizar aparece quando ha notas selecionadas */}
      <OrganizePanel selectedCount={selectedIds.length} onOrganize={handleOrganize} />

      {recentsCleanedAt !== null && (
        <StatusBanner key={`recents-cleared:${recentsCleanedAt}`} variant="info" className="text-center">
          {t('home.recentNotesCleared')}
        </StatusBanner>
      )}

      {recentNotes.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
              {t('home.recentNotes')}
            </h2>
            <button
              type="button"
              onClick={handleClearRecents}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
              title={t('home.clearRecentsHelp')}
            >
              <Eraser className="h-3.5 w-3.5" />
              {t('home.clearRecents')}
            </button>
          </div>
          <NotesList
            notes={recentNotes}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onDelete={deleteNote}
            onEdit={async (id, updates) => { await updateNote(id, updates) }}
            loading={loading}
            emptyTitle={t('home.emptyLooseTitle')}
            emptyDescription={t('home.emptyLooseDescription')}
          />
        </div>
      )}

      {!loading && recentNotes.length === 0 && notes.length > 0 && (
        <StatusBanner key={`all-filed:${notes.length}`} variant="info">
          {t('home.allFiledNotice')}
        </StatusBanner>
      )}
    </div>
  )
}
