import { useMemo, useState } from 'react'
import { ChevronLeft, FileText, Loader2 } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { AudioPlayer } from '../components/audio/AudioPlayer'
import { StatusBanner } from '../components/StatusBanner'
import { useCaptureQueue } from '../hooks/useCaptureQueue'
import { useCaptureSession } from '../hooks/useCaptureSession'
import { useNotes } from '../hooks/useNotes'
import { createSignedCaptureAudioSource } from '../services/audioPlaybackService'
import { mapCaptureQueueErrorMessage } from '../utils/captureQueueErrorMessage'

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR')
}

function formatChunkRange(startMs: number, endMs: number) {
  return `${Math.round(startMs / 1000)}s - ${Math.round(endMs / 1000)}s`
}

export function IdeaDrafts() {
  const [searchParams] = useSearchParams()
  const targetChunkId = searchParams.get('chunkId')
  const targetSessionId = searchParams.get('sessionId')
  const queueFilters = useMemo(
    () => (targetSessionId ? {
      chunkFilters: { sessionId: targetSessionId },
      jobFilters: { sessionId: targetSessionId },
    } : {}),
    [targetSessionId],
  )
  const sessionFilters = useMemo(() => ({ limit: 100 }), [])
  const {
    chunks,
    getChunkTranscriptionState,
    loading: queueLoading,
    error: queueError,
  } = useCaptureQueue(queueFilters)
  const {
    sessions,
    loading: sessionsLoading,
    error: sessionsError,
  } = useCaptureSession(sessionFilters)
  const {
    notes,
    loading: notesLoading,
    error: notesError,
    addCapturedNote,
  } = useNotes()
  const [savingChunkId, setSavingChunkId] = useState<string | null>(null)
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({})
  const [saveNotices, setSaveNotices] = useState<Record<string, string>>({})
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null)

  const sessionsById = useMemo(() => {
    const mapped = new Map<string, { label: string; rawStoragePath: string | null }>()

    for (const session of sessions) {
      mapped.set(session.id, {
        label: session.finalFolderName || session.provisionalFolderName,
        rawStoragePath: session.rawStoragePath,
      })
    }

    return mapped
  }, [sessions])

  const noteByChunk = useMemo(() => {
    const mapped = new Map<string, (typeof notes)[number]>()

    for (const note of notes) {
      if (note.source_audio_chunk_id && !mapped.has(note.source_audio_chunk_id)) {
        mapped.set(note.source_audio_chunk_id, note)
      }
    }

    return mapped
  }, [notes])

  const transcribedItems = useMemo(() => {
    const items = chunks
      .map((chunk) => {
        const transcriptionState = getChunkTranscriptionState(chunk.id, chunk.queueStatus)
        const latestCompletedJob = transcriptionState.latestCompletedJob
        const transcriptText = latestCompletedJob?.transcriptText?.trim() ?? ''

        if (!latestCompletedJob || !transcriptText) {
          return null
        }

        if (targetChunkId && chunk.id !== targetChunkId) {
          return null
        }

        return {
          chunk,
          transcriptText,
          completedAt: latestCompletedJob.completedAt || latestCompletedJob.createdAt,
          session: sessionsById.get(chunk.sessionId) ?? null,
          note: noteByChunk.get(chunk.id) ?? null,
        }
      })
      .filter(Boolean) as Array<{
      chunk: (typeof chunks)[number]
      transcriptText: string
      completedAt: string
      session: { label: string; rawStoragePath: string | null } | null
      note: (typeof notes)[number] | null
    }>

    items.sort((left, right) => {
      if (targetChunkId) {
        if (left.chunk.id === targetChunkId) return -1
        if (right.chunk.id === targetChunkId) return 1
      }

      return right.completedAt.localeCompare(left.completedAt)
    })

    return items
  }, [chunks, getChunkTranscriptionState, noteByChunk, sessionsById, targetChunkId])

  const isLoading = queueLoading || sessionsLoading || notesLoading
  const loadErrors = Array.from(new Set(
    [queueError, sessionsError, notesError]
      .filter(Boolean)
      .map((message) => mapCaptureQueueErrorMessage(message, 'load')),
  ))

  const clearMessages = (chunkId: string) => {
    setSaveErrors((current) => {
      const next = { ...current }
      delete next[chunkId]
      return next
    })
    setSaveNotices((current) => {
      const next = { ...current }
      delete next[chunkId]
      return next
    })
  }

  const handleSaveNote = async (chunkId: string, sessionId: string, transcriptText: string) => {
    clearMessages(chunkId)
    setSavingChunkId(chunkId)

    try {
      const note = await addCapturedNote({
        rawText: transcriptText,
        sourceCaptureSessionId: sessionId,
        sourceAudioChunkId: chunkId,
      })
      setSaveNotices((current) => ({
        ...current,
        [chunkId]: `Nota salva. "${note.title || 'Nova nota'}" ja entrou no acervo do app.`,
      }))
    } catch (saveError) {
      setSaveErrors((current) => ({
        ...current,
        [chunkId]: mapCaptureQueueErrorMessage(saveError, 'save-note'),
      }))
    } finally {
      setSavingChunkId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Textos da fila</h2>
            <p className="mt-1 text-sm text-slate-600">
              Cada ideia transcrita aparece aqui do jeito que saiu do audio: texto bruto preservado, audio de origem e acao principal de salvar como nota.
            </p>
          </div>
          <Link
            to="/capture-queue"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar para a fila
          </Link>
        </div>
      </div>

      {loadErrors.map((message) => (
        <StatusBanner key={message} variant="error" title="Falha ao carregar textos da fila">
          {message}
        </StatusBanner>
      ))}

      {isLoading && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          Carregando textos transcritos...
        </div>
      )}

      {!isLoading && transcribedItems.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Nenhum trecho transcrito ficou pronto ainda. Volte para a fila, transcreva uma ideia e salve a nota assim que o texto bruto aparecer.
        </div>
      )}

      {transcribedItems.map((item) => {
        const sessionLabel = item.session?.label || item.chunk.sessionId
        const saveError = saveErrors[item.chunk.id]
        const saveNotice = saveNotices[item.chunk.id]
        const isSaving = savingChunkId === item.chunk.id

        return (
          <div key={item.chunk.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {sessionLabel}
                  </p>
                  {item.note && (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      nota salva
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Trecho {formatChunkRange(item.chunk.startMs, item.chunk.endMs)} · transcrito em {formatDateTime(item.completedAt)}
                </p>
              </div>
              {item.note ? (
                <Link
                  to="/notes"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                >
                  <FileText className="h-4 w-4" />
                  Abrir notas
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void handleSaveNote(item.chunk.id, item.chunk.sessionId, item.transcriptText)
                  }}
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {isSaving ? 'Salvando nota...' : 'Salvar nota'}
                </button>
              )}
            </div>

            {(item.session?.rawStoragePath || item.chunk.storagePath) && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Ouvir audio</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.session?.rawStoragePath && (
                    <AudioPlayer
                      playerId={`queue-session:${item.chunk.id}`}
                      activePlayerId={activePlayerId}
                      onActivePlayerChange={setActivePlayerId}
                      listenLabel="Ouvir sessao"
                      description="Audio bruto da sessao original para recuperar o contexto completo da ideia."
                      loadSource={async () => createSignedCaptureAudioSource(item.session?.rawStoragePath as string)}
                    />
                  )}
                  {item.chunk.storagePath && (
                    <AudioPlayer
                      playerId={`queue-chunk:${item.chunk.id}`}
                      activePlayerId={activePlayerId}
                      onActivePlayerChange={setActivePlayerId}
                      listenLabel="Ouvir trecho"
                      description="Trecho exato que gerou este texto bruto."
                      loadSource={async () => createSignedCaptureAudioSource(item.chunk.storagePath)}
                    />
                  )}
                </div>
              </div>
            )}

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Texto bruto</p>
              <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 whitespace-pre-wrap">
                {item.transcriptText}
              </div>
            </div>

            {saveError && (
              <StatusBanner
                key={`save-error:${item.chunk.id}:${saveError}`}
                variant="error"
                size="compact"
                dismissible
                className="mt-4"
              >
                {saveError}
              </StatusBanner>
            )}

            {saveNotice && (
              <StatusBanner
                key={`save-notice:${item.chunk.id}:${saveNotice}`}
                variant="success"
                size="compact"
                className="mt-4"
              >
                {saveNotice}
              </StatusBanner>
            )}

            {item.note && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                <p className="font-medium">Nota criada a partir deste trecho</p>
                <p className="mt-1 text-emerald-800">
                  {item.note.title || 'Nova nota'} · salva em {formatDateTime(item.note.created_at)}
                </p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
