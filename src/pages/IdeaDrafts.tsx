import { useMemo, useState } from 'react'
import { CheckCircle2, ChevronLeft, FilePenLine, Save, Sparkles } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { AudioPlayer } from '../components/audio/AudioPlayer'
import { StatusBanner } from '../components/StatusBanner'
import { useCaptureQueue } from '../hooks/useCaptureQueue'
import { useIdeaDrafts } from '../hooks/useIdeaDrafts'
import { useCaptureSession } from '../hooks/useCaptureSession'
import { useIntegrationSettings } from '../hooks/useIntegrationSettings'
import { createSignedCaptureAudioSource } from '../services/audioPlaybackService'
import { mapCaptureQueueErrorMessage } from '../utils/captureQueueErrorMessage'
import type { IdeaDraft } from '../types/ideaDraft'
import type { AudioChunk } from '../types/chunk'

interface DraftEditState {
  suggestedTitle: string
  suggestedFolder: string
  suggestedTags: string
  cleanedText: string
}

function buildDraftEditState(draft: IdeaDraft): DraftEditState {
  return {
    suggestedTitle: draft.suggestedTitle || '',
    suggestedFolder: draft.suggestedFolder || '',
    suggestedTags: draft.suggestedTags.join(', '),
    cleanedText: draft.cleanedText || draft.transcriptText,
  }
}

function normalizeTags(raw: string) {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function statusTone(status: IdeaDraft['status']) {
  if (status === 'failed') {
    return 'border-red-200 bg-red-50 text-red-700'
  }

  if (status === 'exported') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (status === 'reviewed') {
    return 'border-slate-300 bg-slate-100 text-slate-700'
  }

  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function statusLabel(status: IdeaDraft['status']) {
  return ({
    drafted: 'rascunho gerado',
    reviewed: 'revisado',
    exported: 'exportado',
    failed: 'falhou',
  }[status] ?? status)
}

function getVisibleDraftStatus(status: IdeaDraft['status'], showExportIntegrations: boolean): IdeaDraft['status'] {
  if (!showExportIntegrations && status === 'exported') {
    return 'reviewed'
  }

  return status
}

function mapDraftScreenErrorMessage(error: unknown, context: 'load' | 'save') {
  const mapped = mapCaptureQueueErrorMessage(error, context === 'load' ? 'load' : 'generic')

  if (context === 'save' && mapped === 'Algo deu errado. Tente novamente.') {
    return 'Nao foi possivel salvar o rascunho agora.'
  }

  return mapped
}

export function IdeaDrafts() {
  const [searchParams] = useSearchParams()
  const targetDraftId = searchParams.get('draftId')
  const targetSessionId = searchParams.get('sessionId')
  const sessionFilters = useMemo(() => ({ limit: 100 }), [])
  const {
    drafts,
    loading,
    error,
    updateDraft,
    refetch,
  } = useIdeaDrafts(targetSessionId ? { sessionId: targetSessionId } : {})
  const { sessions } = useCaptureSession(sessionFilters)
  const { chunks } = useCaptureQueue()
  const { isIntegrationActive } = useIntegrationSettings()
  const showBardoIntegration = isIntegrationActive('bardo')
  const [editState, setEditState] = useState<Record<string, DraftEditState>>({})
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null)
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({})
  const [saveNotices, setSaveNotices] = useState<Record<string, string>>({})
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null)

  const orderedDrafts = useMemo(() => {
    const sortedDrafts = [...drafts]

    if (!targetDraftId) {
      return sortedDrafts
    }

    sortedDrafts.sort((left, right) => {
      if (left.id === targetDraftId) return -1
      if (right.id === targetDraftId) return 1
      return right.createdAt.localeCompare(left.createdAt)
    })

    return sortedDrafts
  }, [drafts, targetDraftId])

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

  const chunksById = useMemo(() => {
    const mapped = new Map<string, AudioChunk>()

    for (const chunk of chunks) {
      mapped.set(chunk.id, chunk)
    }

    return mapped
  }, [chunks])

  const getLocalDraftState = (draft: IdeaDraft) => editState[draft.id] ?? buildDraftEditState(draft)

  const patchLocalDraftState = (draft: IdeaDraft, patch: Partial<DraftEditState>) => {
    setEditState((current) => ({
      ...current,
      [draft.id]: {
        ...getLocalDraftState(draft),
        ...patch,
      },
    }))
  }

  const clearMessages = (draftId: string) => {
    setSaveErrors((current) => {
      const next = { ...current }
      delete next[draftId]
      return next
    })
    setSaveNotices((current) => {
      const next = { ...current }
      delete next[draftId]
      return next
    })
  }

  const persistDraft = async (draft: IdeaDraft, markReviewed: boolean) => {
    const localState = getLocalDraftState(draft)
    clearMessages(draft.id)
    setSavingDraftId(draft.id)

    try {
      const updatedDraft = await updateDraft(draft.id, {
        suggestedTitle: localState.suggestedTitle.trim() || null,
        suggestedFolder: localState.suggestedFolder.trim() || null,
        suggestedTags: normalizeTags(localState.suggestedTags),
        cleanedText: localState.cleanedText.trim() || draft.transcriptText,
        status: markReviewed ? 'reviewed' : draft.status,
      })

      setEditState((current) => ({
        ...current,
        [draft.id]: buildDraftEditState(updatedDraft),
      }))
      setSaveNotices((current) => ({
        ...current,
        [draft.id]: markReviewed
          ? (showBardoIntegration
              ? 'Rascunho revisado e pronto para exportacao.'
              : 'Rascunho revisado e pronto para seguir no app.')
          : 'Ajustes salvos sem sobrescrever o texto bruto.',
      }))
      await refetch()
    } catch (saveError) {
      setSaveErrors((current) => ({
        ...current,
        [draft.id]: saveError instanceof Error ? saveError.message : 'Falha ao salvar o rascunho.',
      }))
    } finally {
      setSavingDraftId(null)
    }
  }

  const resetLocalDraft = (draft: IdeaDraft) => {
    clearMessages(draft.id)
    setEditState((current) => ({
      ...current,
      [draft.id]: buildDraftEditState(draft),
    }))
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Rascunhos</h2>
            <p className="mt-1 text-sm text-slate-600">
              {showBardoIntegration
                ? 'Aqui cada trecho transcrito vira material de trabalho: texto bruto preservado, texto limpo editavel e sugestoes revisaveis antes de qualquer envio.'
                : 'Aqui cada trecho transcrito vira material de trabalho: texto bruto preservado, texto limpo editavel e sugestoes revisaveis antes de consolidar a ideia.'}
            </p>
          </div>
          <Link
            to={targetSessionId ? `/capture-queue?sessionId=${targetSessionId}` : '/capture-queue'}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar para a fila
          </Link>
        </div>
      </div>

      {error && (
        <StatusBanner variant="error" title="Falha ao carregar rascunhos">
          {mapDraftScreenErrorMessage(error, 'load')}
        </StatusBanner>
      )}

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          Carregando rascunhos...
        </div>
      )}

      {!loading && orderedDrafts.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Nenhum rascunho foi gerado ainda. Volte para a fila, transcreva um trecho e clique em Gerar rascunho.
        </div>
      )}

      {orderedDrafts.map((draft) => {
        const localState = getLocalDraftState(draft)
        const saveError = saveErrors[draft.id]
        const saveNotice = saveNotices[draft.id]
        const isFocused = targetDraftId === draft.id
        const isSaving = savingDraftId === draft.id
        const visibleDraftStatus = getVisibleDraftStatus(draft.status, showBardoIntegration)
        const session = sessionsById.get(draft.sessionId)
        const sessionLabel = session?.label || draft.sessionId
        const chunk = chunksById.get(draft.chunkId) ?? null

        return (
          <div
            key={draft.id}
            className={`rounded-xl border bg-white p-4 shadow-sm ${isFocused ? 'border-primary ring-2 ring-primary/10' : 'border-slate-200'}`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {draft.suggestedTitle || 'Ideia sem titulo'}
                  </p>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(visibleDraftStatus)}`}>
                    {statusLabel(visibleDraftStatus)}
                  </span>
                  {isFocused && (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      foco atual
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Sessao: {sessionLabel} · trecho {draft.chunkId} · criado em {new Date(draft.createdAt).toLocaleString('pt-BR')}
                </p>
              </div>
              <Link
                to={`/capture-queue?sessionId=${draft.sessionId}`}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Sparkles className="h-4 w-4" />
                Ver trecho na fila
              </Link>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                {(session?.rawStoragePath || chunk?.storagePath) && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Auditoria de audio</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {session?.rawStoragePath && (
                        <AudioPlayer
                          playerId={`draft-session:${draft.id}`}
                          activePlayerId={activePlayerId}
                          onActivePlayerChange={setActivePlayerId}
                          listenLabel="Ouvir sessao"
                          description="Audio bruto da sessao original para revisar o contexto completo antes de concluir este draft."
                          loadSource={async () => createSignedCaptureAudioSource(session.rawStoragePath as string)}
                        />
                      )}
                      {chunk?.storagePath && (
                        <AudioPlayer
                          playerId={`draft-chunk:${draft.id}`}
                          activePlayerId={activePlayerId}
                          onActivePlayerChange={setActivePlayerId}
                          listenLabel="Ouvir trecho"
                          description={
                            showBardoIntegration
                              ? 'Trecho que originou este rascunho, util para revisar fidelidade antes de um envio externo.'
                              : 'Trecho que originou este rascunho, util para revisar fidelidade antes de concluir o texto.'
                          }
                          loadSource={async () => createSignedCaptureAudioSource(chunk.storagePath)}
                        />
                      )}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Texto bruto do chunk</p>
                  <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                    {draft.transcriptText}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Texto limpo revisavel</span>
                  <textarea
                    value={localState.cleanedText}
                    onChange={(event) => patchLocalDraftState(draft, { cleanedText: event.target.value })}
                    className="h-48 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Titulo sugerido</span>
                  <input
                    type="text"
                    value={localState.suggestedTitle}
                    onChange={(event) => patchLocalDraftState(draft, { suggestedTitle: event.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Tags sugeridas</span>
                  <input
                    type="text"
                    value={localState.suggestedTags}
                    onChange={(event) => patchLocalDraftState(draft, { suggestedTags: event.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <p className="mt-1 text-xs text-slate-500">Separe por virgula.</p>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Pasta sugerida</span>
                  <input
                    type="text"
                    value={localState.suggestedFolder}
                    onChange={(event) => patchLocalDraftState(draft, { suggestedFolder: event.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </label>

                <div className="rounded-lg border border-slate-300 bg-slate-100 p-3 text-xs text-slate-900">
                  <p className="font-medium">
                    {showBardoIntegration ? 'Revisao humana antes da exportacao' : 'Revisao humana do rascunho'}
                  </p>
                  <p className="mt-1 text-slate-700">
                    {showBardoIntegration
                      ? 'O texto bruto permanece intacto. Aqui voce aceita ou ajusta o texto limpo e as sugestoes antes de liberar este rascunho para exportar.'
                      : 'O texto bruto permanece intacto. Aqui voce aceita ou ajusta o texto limpo e as sugestoes antes de seguir com o rascunho no app.'}
                  </p>
                </div>
              </div>
            </div>

            {saveError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {mapDraftScreenErrorMessage(saveError, 'save')}
              </div>
            )}

            {saveNotice && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                {saveNotice}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void persistDraft(draft, false)
                }}
                disabled={isSaving}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? <Save className="h-4 w-4" /> : <FilePenLine className="h-4 w-4" />}
                Salvar ajustes
              </button>
              <button
                type="button"
                onClick={() => {
                  void persistDraft(draft, true)
                }}
                disabled={isSaving}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {draft.status === 'reviewed' || draft.status === 'exported' ? 'Revisado' : 'Marcar como revisado'}
              </button>
              <button
                type="button"
                onClick={() => resetLocalDraft(draft)}
                disabled={isSaving}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Restaurar texto atual
              </button>
              {(draft.status === 'reviewed' || draft.status === 'exported') && (
                <button
                  type="button"
                  onClick={() => {
                    void persistDraft({ ...draft, status: 'drafted' }, false)
                  }}
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Voltar para rascunho
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
