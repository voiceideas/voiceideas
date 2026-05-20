import { useMemo, useState } from 'react'
import {
  Clock3,
  Loader2,
  RefreshCcw,
  Trash2,
  UploadCloud,
  Waves,
} from 'lucide-react'
import { AudioPlayer } from '../components/audio/AudioPlayer'
import { StatusBanner } from '../components/StatusBanner'
import { QueueEmptyState } from '../components/queue/QueueEmptyState'
import { SessionCard } from '../components/queue/SessionCard'
import { useCaptureSession } from '../hooks/useCaptureSession'
import { useCaptureQueue } from '../hooks/useCaptureQueue'
import { useI18n } from '../hooks/useI18n'
import { useNotes } from '../hooks/useNotes'
import { useFolderRenameRequired } from '../hooks/useFolderRenameRequired'
import { usePendingCaptureUploads } from '../hooks/usePendingCaptureUploads'
import { useVoiceSegmentationSettings } from '../hooks/useVoiceSegmentationSettings'
import { VoiceSegmentationSettings } from '../components/settings/VoiceSegmentationSettings'
import { serializeErrorForDebug } from '../lib/errors'
import { deleteCaptureSession, segmentCaptureSession } from '../services/captureSessionService'
import { deleteAudioChunk } from '../services/audioChunkService'
import { transcribeChunk } from '../services/transcriptionQueueService'
import { retryPendingCaptureUpload } from '../services/pendingCaptureUploadService'
import { createLocalBlobAudioSource } from '../services/audioPlaybackService'
import type { CaptureSession } from '../types/capture'
import type { AudioChunk } from '../types/chunk'
import type { PendingCaptureUploadRecord } from '../services/mobileLocalCaptureStore'
import { mapCaptureQueueErrorMessage, type CaptureQueueErrorContext } from '../utils/captureQueueErrorMessage'

type ActionKind =
  | 'retry-upload'
  | 'discard-local-upload'
  | 'segment'
  | 'rename'
  | 'transcribe'
  | 'save-note'
  | 'delete-chunk'
  | 'delete-session'

function buildActionKey(kind: ActionKind, id: string) {
  return `${kind}:${id}`
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR')
}

function formatSeconds(durationMs: number) {
  return `${Math.max(1, Math.round(durationMs / 1000))}s`
}

function statusTone(status: string) {
  if (status === 'failed' || status === 'permission-denied') {
    return 'border-red-200 bg-red-50 text-red-700'
  }

  if (
    status === 'ready'
    || status === 'completed'
    || status === 'materialized'
    || status === 'exported'
    || status === 'uploaded'
    || status === 'transcribed'
  ) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (
    status === 'segmenting'
    || status === 'transcribing'
    || status === 'exporting'
    || status === 'uploading'
    || status === 'saving-session'
  ) {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }

  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function pendingUploadStatusLabel(status: PendingCaptureUploadRecord['status']) {
  return ({
    'captured-locally': 'gravada localmente',
    'pending-upload': 'pendente de envio',
    uploading: 'enviando',
    uploaded: 'enviada',
    failed: 'falhou no envio',
  }[status] ?? status)
}

function pendingUploadStageLabel(stage: PendingCaptureUploadRecord['stage']) {
  return ({
    'local-capture': 'captura local',
    'storage-upload': 'upload do arquivo',
    'metadata-persist': 'persistencia do rawStoragePath',
    'session-complete': 'conclusao da sessao',
  }[stage] ?? stage)
}

function errorContextFromActionKey(key: string): CaptureQueueErrorContext {
  if (key.startsWith('retry-upload:')) return 'pending-upload'
  if (key.startsWith('discard-local-upload:')) return 'discard-local-upload'
  if (key.startsWith('segment:')) return 'segment'
  if (key.startsWith('rename:')) return 'rename'
  if (key.startsWith('transcribe:')) return 'transcribe'
  if (key.startsWith('save-note:')) return 'save-note'
  if (key.startsWith('delete-chunk:')) return 'delete-chunk'
  if (key.startsWith('delete-session:')) return 'delete-session'
  return 'generic'
}

export function CaptureQueue() {
  const { t } = useI18n()
  const sessionFilters = useMemo(() => ({ limit: 30 }), [])
  const {
    sessions,
    loading: sessionsLoading,
    error: sessionsError,
    updateSession,
    refetch: refetchSessions,
  } = useCaptureSession(sessionFilters)
  const {
    chunks,
    getChunkTranscriptionState,
    loading: queueLoading,
    error: queueError,
    refetch: refetchQueue,
  } = useCaptureQueue()
  const {
    notes,
    loading: notesLoading,
    error: notesError,
    addCapturedNote,
    refetch: refetchNotes,
  } = useNotes()
  const {
    isSupported: isPendingUploadStoreSupported,
    loading: pendingUploadsLoading,
    error: pendingUploadsError,
    pendingUploads,
    refreshPendingUploads,
    removePendingUpload,
  } = usePendingCaptureUploads()
  const {
    settings: segmentationSettings,
    advancedModeEnabled: showAdvancedSegmentationControls,
    updateSetting: updateSegmentationSetting,
    resetSettings: resetSegmentationSettings,
  } = useVoiceSegmentationSettings()
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [actionNotices, setActionNotices] = useState<Record<string, string>>({})
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({})
  const [editingFinalNames, setEditingFinalNames] = useState<Record<string, boolean>>({})
  const [confirmingDiscardSessionId, setConfirmingDiscardSessionId] = useState<string | null>(null)
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null)
  const [confirmingChunkDeleteId, setConfirmingChunkDeleteId] = useState<string | null>(null)
  const [confirmingSessionDeleteId, setConfirmingSessionDeleteId] = useState<string | null>(null)

  const isLoading = sessionsLoading || queueLoading || notesLoading || pendingUploadsLoading
  const hasVisibleQueueData = pendingUploads.length > 0 || sessions.length > 0
  const showBlockingLoadingState = isLoading && !hasVisibleQueueData
  const {
    orderedSessions,
    pendingRenameCount,
    finalizedCount,
    getFolderState,
  } = useFolderRenameRequired(sessions)

  const chunksBySession = useMemo(() => {
    const grouped = new Map<string, AudioChunk[]>()

    for (const chunk of chunks) {
      const sessionChunks = grouped.get(chunk.sessionId) ?? []
      sessionChunks.push(chunk)
      grouped.set(chunk.sessionId, sessionChunks)
    }

    for (const sessionChunks of grouped.values()) {
      sessionChunks.sort((left, right) => left.startMs - right.startMs)
    }

    return grouped
  }, [chunks])

  const noteByChunk = useMemo(() => {
    const mapped = new Map<string, (typeof notes)[number]>()

    for (const note of notes) {
      if (note.source_audio_chunk_id && !mapped.has(note.source_audio_chunk_id)) {
        mapped.set(note.source_audio_chunk_id, note)
      }
    }

    return mapped
  }, [notes])

  const refreshRemotePipeline = async () => {
    await Promise.all([
      refetchSessions(),
      refetchQueue(),
      refetchNotes(),
    ])
  }

  const setActionBusy = (key: string, value: boolean) => {
    setActionLoading((current) => ({ ...current, [key]: value }))
  }

  const setActionError = (key: string, value: unknown) => {
    setActionErrors((current) => {
      if (!value) {
        const next = { ...current }
        delete next[key]
        return next
      }

      return {
        ...current,
        [key]: mapCaptureQueueErrorMessage(value, errorContextFromActionKey(key)),
      }
    })
  }

  const setActionNotice = (key: string, value: string | null) => {
    setActionNotices((current) => {
      if (!value) {
        const next = { ...current }
        delete next[key]
        return next
      }

      return { ...current, [key]: value }
    })
  }

  const runAction = async (key: string, action: () => Promise<void>) => {
    setActionBusy(key, true)
    setActionError(key, null)
    setActionNotice(key, null)

    try {
      await action()
    } catch (error) {
      console.debug('[voiceideas:capture-queue-action-error]', {
        key,
        error: serializeErrorForDebug(error, 'Falha ao executar a acao da fila.'),
      })
      setActionError(key, error)
    } finally {
      setActionBusy(key, false)
    }
  }

  const handleRetryPendingUpload = async (sessionId: string) => {
    const actionKey = buildActionKey('retry-upload', sessionId)

    await runAction(actionKey, async () => {
      await retryPendingCaptureUpload(sessionId)
      await Promise.all([
        refreshPendingUploads(),
        refetchSessions(),
      ])
    })
  }

  const handleDiscardPendingUpload = async (sessionId: string) => {
    const actionKey = buildActionKey('discard-local-upload', sessionId)

    await runAction(actionKey, async () => {
      await removePendingUpload(sessionId)
      setConfirmingDiscardSessionId((current) => (current === sessionId ? null : current))
    })
  }

  const handleSegmentSession = async (session: CaptureSession) => {
    const actionKey = buildActionKey('segment', session.id)

    await runAction(actionKey, async () => {
      await segmentCaptureSession({
        sessionId: session.id,
        mediumSilenceMs: segmentationSettings.mediumSilenceMs,
        longSilenceMs: segmentationSettings.longSilenceMs,
        minChunkMs: segmentationSettings.minChunkMs,
        analysisWindowMs: segmentationSettings.analysisWindowMs,
        strongDelimiterPhrase: segmentationSettings.strongDelimiterPhrase,
      })
      await refreshRemotePipeline()
    })
  }

  const handleDeleteChunk = async (chunk: AudioChunk) => {
    const actionKey = buildActionKey('delete-chunk', chunk.id)

    await runAction(actionKey, async () => {
      await deleteAudioChunk(chunk.id)
      setConfirmingChunkDeleteId((current) => (current === chunk.id ? null : current))
      setActivePlayerId(null)
      await refreshRemotePipeline()
    })
  }

  const handleDeleteSession = async (session: CaptureSession) => {
    const actionKey = buildActionKey('delete-session', session.id)

    await runAction(actionKey, async () => {
      await deleteCaptureSession(session.id)
      setConfirmingSessionDeleteId((current) => (current === session.id ? null : current))
      setActivePlayerId(null)
      await refreshRemotePipeline()
    })
  }

  const handleRenameSession = async (session: CaptureSession) => {
    const actionKey = buildActionKey('rename', session.id)
    const nextName = (renameDrafts[session.id] ?? session.finalFolderName ?? session.provisionalFolderName).trim()

    if (!nextName) {
      setActionError(actionKey, 'Digite um nome valido para substituir a pasta provisoria.')
      return
    }

    await runAction(actionKey, async () => {
      await updateSession(session.id, {
        finalFolderName: nextName,
        renameRequired: false,
      })
      setEditingFinalNames((current) => ({ ...current, [session.id]: false }))
      setActionNotice(actionKey, 'Nome final salvo. Esta sessao saiu do estado provisório.')
      await refetchSessions()
    })
  }

  const handleTranscribeChunk = async (chunk: AudioChunk) => {
    const actionKey = buildActionKey('transcribe', chunk.id)
    const transcriptionState = getChunkTranscriptionState(chunk.id, chunk.queueStatus)
    const canReuseCompleted = transcriptionState.canReuseCompleted
      && !['transcribed', 'materialized', 'ready'].includes(chunk.queueStatus)

    if (transcriptionState.activeJob) {
      setActionError(actionKey, 'Ja existe um job de transcricao em andamento para este trecho.')
      return
    }

    if (transcriptionState.status === 'transcribed' && !transcriptionState.canRetry && !canReuseCompleted) {
      return
    }

    await runAction(actionKey, async () => {
      const result = await transcribeChunk({
        chunkId: chunk.id,
        retry: transcriptionState.canRetry,
      })
      await refreshRemotePipeline()
      if (result.reused) {
        setActionNotice(actionKey, 'A transcricao pronta deste trecho foi reaproveitada sem criar tentativa duplicada.')
      }
    })
  }

  const handleSaveChunkNote = async (chunk: AudioChunk, transcriptText: string) => {
    const actionKey = buildActionKey('save-note', chunk.id)
    if (!transcriptText.trim()) {
      setActionError(actionKey, 'Este trecho ainda nao tem texto para salvar como nota.')
      return
    }

    await runAction(actionKey, async () => {
      const note = await addCapturedNote({
        rawText: transcriptText,
        sourceCaptureSessionId: chunk.sessionId,
        sourceAudioChunkId: chunk.id,
      })
      setActionNotice(
        actionKey,
        `Nota salva. "${note.title || 'Nova nota'}" ja entrou no acervo do app.`,
      )
      await refetchNotes()
    })
  }

  const summary = useMemo(() => {
    const readySessions = sessions.filter((session) => session.processingStatus === 'ready').length
    const failedSessions = sessions.filter((session) => session.processingStatus === 'failed').length
    const transcribingChunks = chunks.filter((chunk) => chunk.queueStatus === 'transcribing').length

    return {
      pendingUploads: pendingUploads.length,
      readySessions,
      failedSessions,
      transcribingChunks,
      pendingRenameCount,
    }
  }, [chunks, pendingUploads.length, pendingRenameCount, sessions])

  const pendingUploadsErrorMessage = pendingUploadsError
    ? mapCaptureQueueErrorMessage(pendingUploadsError, 'pending-upload')
    : null

  const remoteLoadErrors = Array.from(new Set(
    [sessionsError, queueError, notesError]
      .filter(Boolean)
      .map((message) => mapCaptureQueueErrorMessage(message, 'load')),
  ))

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t('captureQueue.title')}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {t('captureQueue.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void Promise.all([
                refreshPendingUploads(),
                refreshRemotePipeline(),
              ])
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <RefreshCcw className="h-4 w-4" />
            {t('captureQueue.refresh')}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="text-xs font-medium uppercase tracking-wider text-amber-700">{t('captureQueue.kpi.pendingLocal')}</p>
            <p className="mt-1 text-2xl font-semibold">{summary.pendingUploads}</p>
          </div>
          <div className="rounded-lg border border-slate-300 bg-slate-100 p-3 text-sm text-slate-900">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-700">{t('captureQueue.kpi.readySessions')}</p>
            <p className="mt-1 text-2xl font-semibold">{summary.readySessions}</p>
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            <p className="text-xs font-medium uppercase tracking-wider text-sky-700">{t('captureQueue.kpi.transcribingIdeas')}</p>
            <p className="mt-1 text-2xl font-semibold">{summary.transcribingChunks}</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p className="text-xs font-medium uppercase tracking-wider text-red-700">{t('captureQueue.kpi.pendingFolders')}</p>
            <p className="mt-1 text-2xl font-semibold">{summary.pendingRenameCount}</p>
          </div>
        </div>
      </div>

      {pendingRenameCount > 0 && (
        <StatusBanner
          key={`pending-rename:${pendingRenameCount}:${finalizedCount}`}
          variant="warning"
          autoDismissMs={null}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">
                {pendingRenameCount === 1
                  ? t('captureQueue.pendingRename.one', { count: pendingRenameCount })
                  : t('captureQueue.pendingRename.other', { count: pendingRenameCount })}
              </p>
              <p className="mt-1">
                {t('captureQueue.pendingRename.body')}
              </p>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-amber-800">
              {finalizedCount === 1
                ? t('captureQueue.pendingRename.finalizedOne', { count: finalizedCount })
                : t('captureQueue.pendingRename.finalizedOther', { count: finalizedCount })}
            </p>
          </div>
        </StatusBanner>
      )}

      {showAdvancedSegmentationControls ? (
        <VoiceSegmentationSettings
          settings={segmentationSettings}
          onChange={updateSegmentationSetting}
          onReset={resetSegmentationSettings}
        />
      ) : (
        <StatusBanner key="segmentation-preset-info" variant="info" autoDismissMs={null}>
          <p className="font-medium text-slate-900">{t('captureQueue.segmentation.title')}</p>
          <p className="mt-1 text-xs">
            {t('captureQueue.segmentation.body')}
          </p>
        </StatusBanner>
      )}

      {pendingUploadsErrorMessage && (
        <StatusBanner
          key={`pending-uploads-error:${pendingUploadsErrorMessage}`}
          variant="error"
          size="compact"
          dismissible
        >
          {pendingUploadsErrorMessage}
        </StatusBanner>
      )}

      {remoteLoadErrors.length > 0 && (
        <StatusBanner
          key={`remote-load-errors:${remoteLoadErrors.join('|')}`}
          variant="error"
          size="compact"
          dismissible
        >
          {remoteLoadErrors.join(' · ')}
        </StatusBanner>
      )}

      {showBlockingLoadingState && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
          <p className="mt-2">{t('captureQueue.loadingBlocking')}</p>
        </div>
      )}

      {isPendingUploadStoreSupported && pendingUploads.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">{t('captureQueue.localPendingTitle')}</h3>
          </div>

          {pendingUploads.map((pendingUpload) => {
            const retryActionKey = buildActionKey('retry-upload', pendingUpload.sessionId)
            const discardActionKey = buildActionKey('discard-local-upload', pendingUpload.sessionId)
            const isRetryBusy = Boolean(actionLoading[retryActionKey])
            const isDiscardBusy = Boolean(actionLoading[discardActionKey])
            const isBusy = isRetryBusy || isDiscardBusy
            const retryErrorMessage = actionErrors[retryActionKey]
            const discardErrorMessage = actionErrors[discardActionKey]
            const isConfirmingDiscard = confirmingDiscardSessionId === pendingUpload.sessionId

            return (
              <div key={pendingUpload.sessionId} className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{pendingUpload.provisionalFolderName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Sessao gravada no aparelho em {formatDateTime(pendingUpload.startedAt)}
                    </p>
                  </div>
                  <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusTone(pendingUpload.status)}`}>
                    <Clock3 className="h-3.5 w-3.5" />
                    {pendingUploadStatusLabel(pendingUpload.status)}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                  <p>{t('captureQueue.deep.stage')} <span className="font-medium text-slate-900">{pendingUploadStageLabel(pendingUpload.stage)}</span></p>
                  <p>{t('captureQueue.deep.duration')} <span className="font-medium text-slate-900">{formatSeconds(pendingUpload.durationMs)}</span></p>
                  <p>{t('captureQueue.deep.platform')} <span className="font-medium text-slate-900">{pendingUpload.platformSource}</span></p>
                  <p>{t('captureQueue.deep.file')} <span className="font-medium text-slate-900">{pendingUpload.fileName}</span></p>
                </div>

                {pendingUpload.lastError && (
                  <StatusBanner
                    key={`pending-upload-last-error:${pendingUpload.sessionId}:${pendingUpload.lastError}`}
                    variant="error"
                    size="compact"
                    dismissible
                    className="mt-3"
                  >
                    {mapCaptureQueueErrorMessage(pendingUpload.lastError, 'pending-upload')}
                  </StatusBanner>
                )}

                {retryErrorMessage && (
                  <StatusBanner
                    key={`retry-error:${pendingUpload.sessionId}:${retryErrorMessage}`}
                    variant="error"
                    size="compact"
                    dismissible
                    className="mt-3"
                  >
                    {retryErrorMessage}
                  </StatusBanner>
                )}

                {discardErrorMessage && (
                  <StatusBanner
                    key={`discard-error:${pendingUpload.sessionId}:${discardErrorMessage}`}
                    variant="error"
                    size="compact"
                    dismissible
                    className="mt-3"
                  >
                    {discardErrorMessage}
                  </StatusBanner>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {pendingUpload.blob && (
                    <AudioPlayer
                      playerId={`pending-session:${pendingUpload.sessionId}`}
                      activePlayerId={activePlayerId}
                      onActivePlayerChange={setActivePlayerId}
                      listenLabel="Ouvir sessao"
                      description="Use esta auditoria para conferir a captura local antes do reenvio."
                      loadSource={async () => createLocalBlobAudioSource(pendingUpload.blob as Blob)}
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      void handleRetryPendingUpload(pendingUpload.sessionId)
                    }}
                    disabled={isBusy}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRetryBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                    Tentar envio de novo
                  </button>

                  {!isConfirmingDiscard ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingDiscardSessionId(pendingUpload.sessionId)
                      }}
                      disabled={isBusy}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Trash2 className="h-4 w-4" />
                      Excluir pendente
                    </button>
                  ) : null}
                </div>

                {isConfirmingDiscard && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-sm font-semibold text-red-900">{t('captureQueue.deep.deleteLocalConfirm')}</p>
                    <p className="mt-1 text-xs text-red-700">
                      Isso remove apenas a captura local pendente deste aparelho. Sessoes ja salvas na nuvem nao serao apagadas.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingDiscardSessionId((current) => (
                            current === pendingUpload.sessionId ? null : current
                          ))
                        }}
                        disabled={isBusy}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleDiscardPendingUpload(pendingUpload.sessionId)
                        }}
                        disabled={isBusy}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isDiscardBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Waves className="h-4 w-4 text-slate-600" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">{t('captureQueue.deep.queueSessionsTitle')}</h3>
        </div>

        {!isLoading && sessions.length === 0 && pendingUploads.length === 0 && (
          <QueueEmptyState kind="no-sessions" />
        )}

        {orderedSessions.map((session) => {
          const sessionChunks = chunksBySession.get(session.id) ?? []
          const folderState = getFolderState(session)
          const isEditingFinalName = Boolean(editingFinalNames[session.id])
          const renameValue =
            renameDrafts[session.id] ??
            session.finalFolderName ??
            session.provisionalFolderName
          const isConfirmingSessionDelete = confirmingSessionDeleteId === session.id

          return (
            <SessionCard
              key={session.id}
              session={session}
              sessionChunks={sessionChunks}
              noteByChunk={noteByChunk}
              folderState={folderState}
              isEditingFinalName={isEditingFinalName}
              renameValue={renameValue}
              onRenameValueChange={(value) => {
                setRenameDrafts((current) => ({ ...current, [session.id]: value }))
              }}
              onStartEditFinalName={() => {
                setEditingFinalNames((current) => ({
                  ...current,
                  [session.id]: true,
                }))
              }}
              onSubmitRename={() => {
                void handleRenameSession(session)
              }}
              isConfirmingSessionDelete={isConfirmingSessionDelete}
              onStartConfirmSessionDelete={() => {
                setConfirmingSessionDeleteId(session.id)
              }}
              onCancelConfirmSessionDelete={() => {
                setConfirmingSessionDeleteId((current) =>
                  current === session.id ? null : current,
                )
              }}
              onConfirmSessionDelete={() => {
                void handleDeleteSession(session)
              }}
              confirmingChunkDeleteId={confirmingChunkDeleteId}
              onStartConfirmChunkDelete={(chunkId) => {
                setConfirmingChunkDeleteId(chunkId)
              }}
              onCancelConfirmChunkDelete={() => {
                setConfirmingChunkDeleteId(null)
              }}
              onConfirmChunkDelete={(chunk) => {
                void handleDeleteChunk(chunk)
              }}
              onSegmentSession={() => {
                void handleSegmentSession(session)
              }}
              onTranscribeChunk={(chunk) => {
                void handleTranscribeChunk(chunk)
              }}
              onSaveChunkNote={(chunk, transcriptText) => {
                void handleSaveChunkNote(chunk, transcriptText)
              }}
              actionLoading={actionLoading}
              actionErrors={actionErrors}
              actionNotices={actionNotices}
              getChunkTranscriptionState={getChunkTranscriptionState}
              activePlayerId={activePlayerId}
              setActivePlayerId={setActivePlayerId}
              t={t}
              buildActionKey={buildActionKey}
            />
          )
        })}
      </section>
    </div>
  )
}
