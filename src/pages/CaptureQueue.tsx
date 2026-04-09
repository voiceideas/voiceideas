import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  FolderPen,
  History,
  Loader2,
  RefreshCcw,
  Scissors,
  Trash2,
  UploadCloud,
  Waves,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { AudioPlayer } from '../components/audio/AudioPlayer'
import { ProvisionalFolderBadge } from '../components/Folders/ProvisionalFolderBadge'
import { StatusBanner } from '../components/StatusBanner'
import { useCaptureSession } from '../hooks/useCaptureSession'
import { useCaptureQueue } from '../hooks/useCaptureQueue'
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
import { createLocalBlobAudioSource, createSignedCaptureAudioSource } from '../services/audioPlaybackService'
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

function formatChunkRange(chunk: AudioChunk) {
  return `${Math.round(chunk.startMs / 1000)}s - ${Math.round(chunk.endMs / 1000)}s`
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

function sessionStatusLabel(status: CaptureSession['processingStatus']) {
  return ({
    captured: 'capturada',
    'awaiting-segmentation': 'aguardando separar ideias',
    segmenting: 'separando ideias',
    segmented: 'ideias ja separadas',
    'awaiting-transcription': 'ideias separadas, aguardando transcricao',
    transcribing: 'transcrevendo',
    transcribed: 'transcrita',
    materialized: 'materializada',
    ready: 'pronta',
    failed: 'falhou',
  }[status] ?? status)
}

function chunkReasonLabel(reason: AudioChunk['segmentationReason']) {
  return ({
    'strong-delimiter': 'corte intencional',
    'probable-silence': 'pausa curta',
    'structural-silence': 'pausa longa',
    'session-end': 'fim da sessao',
    'manual-stop': 'parada manual',
    'single-pass': 'ideia unica',
    fallback: 'ajuste automatico',
    unknown: 'ajuste automatico',
  }[reason] ?? reason)
}

function transcriptionStatusLabel(status: 'awaiting-transcription' | 'transcribing' | 'transcribed' | 'failed') {
  return ({
    'awaiting-transcription': 'aguardando transcricao',
    transcribing: 'transcrevendo',
    transcribed: 'transcrito',
    failed: 'falhou',
  }[status] ?? status)
}

function transcriptionJobStatusLabel(status: 'pending' | 'processing' | 'completed' | 'failed') {
  return ({
    pending: 'aguardando',
    processing: 'transcrevendo',
    completed: 'transcrito',
    failed: 'falhou',
  }[status] ?? status)
}

function transcriptionActionLabel(
  status: 'awaiting-transcription' | 'transcribing' | 'transcribed' | 'failed',
  canRetry: boolean,
  canReuseCompleted: boolean,
) {
  if (status === 'transcribing') return 'Transcrevendo...'
  if (canRetry) return 'Tentar de novo'
  if (canReuseCompleted) return 'Reaproveitar transcricao'
  if (status === 'transcribed') return 'Transcricao pronta'
  return 'Transcrever trecho'
}

function transcriptionStatusHelperText(
  status: 'awaiting-transcription' | 'transcribing' | 'transcribed' | 'failed',
  canRetry: boolean,
  canReuseCompleted: boolean,
) {
  if (status === 'transcribing') {
    return 'A transcricao deste trecho esta em andamento agora.'
  }

  if (canRetry) {
    return 'A ultima tentativa falhou, mas voce pode tentar de novo so neste trecho.'
  }

  if (canReuseCompleted) {
    return 'Ja existe uma transcricao concluida pronta para reaproveitamento.'
  }

  if (status === 'transcribed') {
    return 'Este trecho ja tem transcricao pronta para seguir no fluxo.'
  }

  return 'Este trecho ja pode virar texto.'
}

type NoteSaveState =
  | 'waiting-transcription'
  | 'ready-to-save'
  | 'saving'
  | 'saved'

function noteSaveStateTone(status: NoteSaveState) {
  if (status === 'saved') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (status === 'saving' || status === 'ready-to-save') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }

  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function noteSaveStateLabel(status: NoteSaveState) {
  return ({
    'waiting-transcription': 'aguardando transcricao',
    'ready-to-save': 'pronto para salvar',
    saving: 'salvando nota',
    saved: 'nota salva',
  }[status] ?? status)
}

function noteSaveStateHelperText(status: NoteSaveState) {
  return ({
    'waiting-transcription': 'Transcreva este trecho primeiro para liberar o salvamento da nota.',
    'ready-to-save': 'O texto bruto ja esta pronto. Agora voce pode salvar esta ideia como nota.',
    saving: 'A nota deste trecho esta sendo salva agora.',
    saved: 'Este trecho ja gerou uma nota real no acervo do app.',
  }[status] ?? 'Este trecho ja pode virar nota.')
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
            <h2 className="text-lg font-semibold text-slate-900">Fila de Captura</h2>
            <p className="mt-1 text-sm text-slate-600">
              Aqui a captura deixa de depender da fe. Cada sessao mostra onde o audio esta, em que etapa entrou e qual acao ainda falta.
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
            Atualizar fila
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="text-xs font-medium uppercase tracking-wider text-amber-700">Pendentes locais</p>
            <p className="mt-1 text-2xl font-semibold">{summary.pendingUploads}</p>
          </div>
          <div className="rounded-lg border border-slate-300 bg-slate-100 p-3 text-sm text-slate-900">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-700">Sessoes prontas</p>
            <p className="mt-1 text-2xl font-semibold">{summary.readySessions}</p>
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            <p className="text-xs font-medium uppercase tracking-wider text-sky-700">Ideias em transcricao</p>
            <p className="mt-1 text-2xl font-semibold">{summary.transcribingChunks}</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p className="text-xs font-medium uppercase tracking-wider text-red-700">Pastas provisórias</p>
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
                {pendingRenameCount} {pendingRenameCount === 1 ? 'sessao ainda usa pasta provisoria.' : 'sessoes ainda usam pasta provisoria.'}
              </p>
              <p className="mt-1">
                A captura ja esta segura, mas o nome temporario continua insistindo ate voce definir um nome final na propria fila.
              </p>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-amber-800">
              {finalizedCount} {finalizedCount === 1 ? 'sessao ja normalizada' : 'sessoes ja normalizadas'}
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
          <p className="font-medium text-slate-900">Separacao automatica de ideias</p>
          <p className="mt-1 text-xs">
            O VoiceIdeas usa um preset interno para dividir a captura em trechos uteis. A interface normal nao expoe ajustes tecnicos dessa etapa.
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
          <p className="mt-2">Carregando a fila de captura...</p>
        </div>
      )}

      {isPendingUploadStoreSupported && pendingUploads.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Capturas locais pendentes</h3>
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
                  <p>Etapa: <span className="font-medium text-slate-900">{pendingUploadStageLabel(pendingUpload.stage)}</span></p>
                  <p>Duracao: <span className="font-medium text-slate-900">{formatSeconds(pendingUpload.durationMs)}</span></p>
                  <p>Plataforma: <span className="font-medium text-slate-900">{pendingUpload.platformSource}</span></p>
                  <p>Arquivo: <span className="font-medium text-slate-900">{pendingUpload.fileName}</span></p>
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
                    <p className="text-sm font-semibold text-red-900">Excluir copia local pendente?</p>
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
                        Cancelar
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
                        Excluir
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
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Sessoes da fila</h3>
        </div>

        {!isLoading && sessions.length === 0 && pendingUploads.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            Nenhuma sessao apareceu na fila ainda. Quando voce usar a Captura segura, ela passa a existir aqui antes mesmo de virar texto final.
          </div>
        )}

        {orderedSessions.map((session) => {
          const sessionChunks = chunksBySession.get(session.id) ?? []
          const sessionSavedNotes = sessionChunks.map((chunk) => noteByChunk.get(chunk.id)).filter(Boolean)
          const folderState = getFolderState(session)
          const isEditingFinalName = Boolean(editingFinalNames[session.id])
          const renameValue = renameDrafts[session.id] ?? session.finalFolderName ?? session.provisionalFolderName
          const segmentActionKey = buildActionKey('segment', session.id)
          const renameActionKey = buildActionKey('rename', session.id)
          const segmentError = actionErrors[segmentActionKey]
          const renameError = actionErrors[renameActionKey]
          const renameNotice = actionNotices[renameActionKey]
          const canSegmentSession = Boolean(session.rawStoragePath) && sessionChunks.length === 0
          const deleteSessionActionKey = buildActionKey('delete-session', session.id)
          const deleteSessionError = actionErrors[deleteSessionActionKey]
          const isDeletingSession = Boolean(actionLoading[deleteSessionActionKey])
          const isConfirmingSessionDelete = confirmingSessionDeleteId === session.id

          return (
            <div
              key={session.id}
              className={`rounded-xl border bg-white p-4 shadow-sm ${
                folderState.needsRename
                  ? 'border-red-200 ring-1 ring-red-100'
                  : 'border-slate-200'
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {folderState.displayName}
                    </p>
                    <ProvisionalFolderBadge needsRename={folderState.needsRename} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Sessao iniciada em {formatDateTime(session.startedAt)} · plataforma {session.platformSource}
                  </p>
                </div>

                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusTone(session.processingStatus)}`}>
                  {session.processingStatus === 'failed' ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {sessionStatusLabel(session.processingStatus)}
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                <p>Ideias separadas: <span className="font-medium text-slate-900">{sessionChunks.length}</span></p>
                <p>Notas salvas: <span className="font-medium text-slate-900">{sessionSavedNotes.length}</span></p>
                <p>Status bruto: <span className="font-medium text-slate-900">{session.status}</span></p>
                <p>Rename: <span className="font-medium text-slate-900">{folderState.needsRename ? 'pendente' : 'normalizado'}</span></p>
              </div>

              {session.rawStoragePath && (
                <p className="mt-2 break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600">
                  rawStoragePath: {session.rawStoragePath}
                </p>
              )}

              <div className={`mt-4 rounded-lg border p-3 ${
                folderState.needsRename
                  ? 'border-red-200 bg-red-50'
                  : 'border-emerald-200 bg-emerald-50'
              }`}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className={`text-xs font-medium uppercase tracking-wider ${
                        folderState.needsRename ? 'text-red-700' : 'text-emerald-700'
                      }`}
                      >
                        {folderState.needsRename ? 'Pasta provisoria' : 'Nome final da sessao'}
                      </p>
                      <p className={`mt-1 text-sm ${folderState.needsRename ? 'text-red-900' : 'text-emerald-900'}`}>
                        {folderState.needsRename
                          ? folderState.provisionalName
                          : folderState.finalName}
                      </p>
                      <p className={`mt-2 text-xs ${folderState.needsRename ? 'text-red-700' : 'text-emerald-700'}`}>
                        {folderState.helperText}
                      </p>
                    </div>

                    {!folderState.needsRename && !isEditingFinalName && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingFinalNames((current) => ({ ...current, [session.id]: true }))
                        }}
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                      >
                        <FolderPen className="h-4 w-4" />
                        Editar nome
                      </button>
                    )}
                  </div>

                  {(folderState.needsRename || isEditingFinalName) && (
                    <div className="flex flex-1 gap-2 sm:max-w-xl">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(event) => {
                          const value = event.target.value
                          setRenameDrafts((current) => ({ ...current, [session.id]: value }))
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void handleRenameSession(session)
                        }}
                        disabled={Boolean(actionLoading[renameActionKey])}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {actionLoading[renameActionKey]
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <FolderPen className="h-4 w-4" />}
                        {folderState.needsRename ? 'Definir nome final' : 'Salvar ajuste'}
                      </button>
                    </div>
                  )}
                </div>
                {renameError && (
                  <StatusBanner
                    key={`rename-error:${session.id}:${renameError}`}
                    variant="error"
                    size="compact"
                    dismissible
                    className="mt-3"
                  >
                    {renameError}
                  </StatusBanner>
                )}
                {renameNotice && (
                  <StatusBanner
                    key={`rename-notice:${session.id}:${renameNotice}`}
                    variant="success"
                    size="compact"
                    className="mt-3"
                  >
                    {renameNotice}
                  </StatusBanner>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {session.rawStoragePath && (
                  <AudioPlayer
                    playerId={`session:${session.id}`}
                    activePlayerId={activePlayerId}
                    onActivePlayerChange={setActivePlayerId}
                    listenLabel="Ouvir sessao"
                    description="Audio bruto preservado da sessao antes de separar as ideias ou para auditoria posterior."
                    loadSource={async () => createSignedCaptureAudioSource(session.rawStoragePath as string)}
                  />
                )}

                <button
                  type="button"
                  onClick={() => {
                    void handleSegmentSession(session)
                  }}
                  disabled={!canSegmentSession || Boolean(actionLoading[segmentActionKey])}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionLoading[segmentActionKey]
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Scissors className="h-4 w-4" />}
                  {canSegmentSession ? 'Separar ideias' : 'Ideias ja separadas'}
                </button>

                {!isConfirmingSessionDelete ? (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingSessionDeleteId(session.id)
                    }}
                    disabled={isDeletingSession}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                    Excluir sessao
                  </button>
                ) : null}
              </div>

              {segmentError && (
                <StatusBanner
                  key={`segment-error:${session.id}:${segmentError}`}
                  variant="error"
                  size="compact"
                  dismissible
                  className="mt-3"
                >
                  {segmentError}
                </StatusBanner>
              )}

              {deleteSessionError && (
                <StatusBanner
                  key={`delete-session-error:${session.id}:${deleteSessionError}`}
                  variant="error"
                  size="compact"
                  dismissible
                  className="mt-3"
                >
                  {deleteSessionError}
                </StatusBanner>
              )}

              {isConfirmingSessionDelete && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-semibold text-red-900">Excluir sessao remota?</p>
                  <p className="mt-1 text-xs text-red-700">
                    Isso apaga a sessao remota, o audio bruto e todo o ramo novo derivado dela. O legado nao sera tocado.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingSessionDeleteId((current) => (
                          current === session.id ? null : current
                        ))
                      }}
                      disabled={isDeletingSession}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleDeleteSession(session)
                      }}
                      disabled={isDeletingSession}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isDeletingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Excluir sessao
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-3">
                {sessionChunks.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    {session.processingStatus === 'awaiting-segmentation' || session.processingStatus === 'captured'
                      ? 'A sessao existe, o audio bruto esta preservado e ainda falta separar em ideias.'
                      : session.processingStatus === 'failed'
                        ? 'A sessao falhou em alguma etapa. O audio bruto continua ancorado para retry.'
                        : 'Esta sessao ainda nao tem ideias separadas visiveis.'}
                  </div>
                ) : (
                  sessionChunks.map((chunk) => {
                    const transcriptionState = getChunkTranscriptionState(chunk.id, chunk.queueStatus)
                    const latestJob = transcriptionState.latestJob
                    const latestCompletedJob = transcriptionState.latestCompletedJob
                    const transcribeActionKey = buildActionKey('transcribe', chunk.id)
                    const saveNoteActionKey = buildActionKey('save-note', chunk.id)
                    const canReuseCompleted = transcriptionState.canReuseCompleted
                      && !['transcribed', 'materialized', 'ready'].includes(chunk.queueStatus)
                    const transcriptText = latestCompletedJob?.transcriptText?.trim() ?? ''
                    const savedNote = noteByChunk.get(chunk.id) ?? null
                    const noteSaveState: NoteSaveState = actionLoading[saveNoteActionKey]
                      ? 'saving'
                      : savedNote
                        ? 'saved'
                        : transcriptText
                          ? 'ready-to-save'
                          : 'waiting-transcription'
                    const deleteChunkActionKey = buildActionKey('delete-chunk', chunk.id)
                    const deleteChunkError = actionErrors[deleteChunkActionKey]
                    const isDeletingChunk = Boolean(actionLoading[deleteChunkActionKey])
                    const isConfirmingChunkDelete = confirmingChunkDeleteId === chunk.id

                    return (
                      <div key={chunk.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              Trecho {formatChunkRange(chunk)}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              {formatSeconds(chunk.durationMs)} · {chunkReasonLabel(chunk.segmentationReason)}
                            </p>
                          </div>
                          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusTone(chunk.queueStatus)}`}>
                            {session.processingStatus === 'failed' || chunk.queueStatus === 'failed'
                              ? <AlertTriangle className="h-3.5 w-3.5" />
                              : <CheckCircle2 className="h-3.5 w-3.5" />}
                            {sessionStatusLabel(chunk.queueStatus)}
                          </div>
                        </div>

                        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                                Transcricao
                              </p>
                              <p className="mt-1 text-sm font-medium text-slate-900">
                                {transcriptionStatusLabel(transcriptionState.status)}
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                {transcriptionStatusHelperText(
                                  transcriptionState.status,
                                  transcriptionState.canRetry,
                                  canReuseCompleted,
                                )}
                              </p>
                            </div>

                            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusTone(transcriptionState.status)}`}>
                              {transcriptionState.status === 'failed'
                                ? <AlertTriangle className="h-3.5 w-3.5" />
                                : transcriptionState.status === 'transcribing'
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <CheckCircle2 className="h-3.5 w-3.5" />}
                              {transcriptionStatusLabel(transcriptionState.status)}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <AudioPlayer
                            playerId={`chunk:${chunk.id}`}
                            activePlayerId={activePlayerId}
                            onActivePlayerChange={setActivePlayerId}
                            listenLabel="Ouvir trecho"
                            description={`Trecho ${formatChunkRange(chunk)} derivado da sessao para ouvir o audio antes de salvar a nota.`}
                            loadSource={async () => createSignedCaptureAudioSource(chunk.storagePath)}
                          />

                          <button
                            type="button"
                            onClick={() => {
                              void handleTranscribeChunk(chunk)
                            }}
                            disabled={
                              Boolean(actionLoading[transcribeActionKey])
                              || transcriptionState.status === 'transcribing'
                              || (transcriptionState.status === 'transcribed' && !transcriptionState.canRetry && !canReuseCompleted)
                            }
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actionLoading[transcribeActionKey]
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Waves className="h-4 w-4" />}
                            {transcriptionActionLabel(
                              transcriptionState.status,
                              transcriptionState.canRetry,
                              canReuseCompleted,
                            )}
                          </button>

                          {!savedNote && (
                            <button
                              type="button"
                              onClick={() => {
                                void handleSaveChunkNote(chunk, transcriptText)
                              }}
                              disabled={Boolean(actionLoading[saveNoteActionKey]) || !transcriptText}
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {actionLoading[saveNoteActionKey]
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <FileText className="h-4 w-4" />}
                              {actionLoading[saveNoteActionKey] ? 'Salvando nota...' : 'Salvar nota'}
                            </button>
                          )}

                          {savedNote && (
                            <Link
                              to="/notes"
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                            >
                              <FileText className="h-4 w-4" />
                              Abrir notas
                            </Link>
                          )}

                          {!isConfirmingChunkDelete ? (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmingChunkDeleteId(chunk.id)
                              }}
                              disabled={isDeletingChunk}
                              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Trash2 className="h-4 w-4" />
                              Excluir trecho
                            </button>
                          ) : null}
                        </div>

                        {[transcribeActionKey, saveNoteActionKey]
                          .map((key) => actionErrors[key])
                          .filter(Boolean)
                          .map((message, index) => (
                            <StatusBanner
                              key={`${chunk.id}-error-${index}:${message}`}
                              variant="error"
                              size="compact"
                              dismissible
                              className="mt-3"
                            >
                              {message}
                            </StatusBanner>
                          ))}

                        {[transcribeActionKey, saveNoteActionKey]
                          .map((key) => actionNotices[key])
                          .filter(Boolean)
                          .map((message, index) => (
                            <StatusBanner
                              key={`${chunk.id}-notice-${index}:${message}`}
                              variant="success"
                              size="compact"
                              className="mt-3"
                            >
                              {message}
                            </StatusBanner>
                          ))}

                        {deleteChunkError && (
                          <StatusBanner
                            key={`delete-chunk-error:${chunk.id}:${deleteChunkError}`}
                            variant="error"
                            size="compact"
                            dismissible
                            className="mt-3"
                          >
                            {deleteChunkError}
                          </StatusBanner>
                        )}

                        {isConfirmingChunkDelete && (
                          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                            <p className="text-sm font-semibold text-red-900">Excluir trecho remoto?</p>
                            <p className="mt-1 text-xs text-red-700">
                              Isso apaga este trecho remoto, o audio derivado e o ramo de transcricao ligado a ele. A sessao bruta continua intacta.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmingChunkDeleteId((current) => (
                                    current === chunk.id ? null : current
                                  ))
                                }}
                                disabled={isDeletingChunk}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleDeleteChunk(chunk)
                                }}
                                disabled={isDeletingChunk}
                                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isDeletingChunk ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                Excluir trecho
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="mt-3 space-y-2 text-xs text-slate-600">
                          <p>Storage: <span className="break-all font-mono text-[11px] text-slate-700">{chunk.storagePath}</span></p>
                          <p>Estado da transcricao: <span className="font-medium text-slate-900">{transcriptionStatusLabel(transcriptionState.status)}</span></p>
                          {latestJob && (
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700">
                              <div className="flex items-center gap-2">
                                <History className="h-3.5 w-3.5 text-slate-500" />
                                <p>
                                  Ultima tentativa: <span className="font-medium">{transcriptionJobStatusLabel(latestJob.status)}</span>
                                  {' '}· iniciada em <span className="font-medium">{formatDateTime(latestJob.createdAt)}</span>
                                  {latestJob.completedAt ? (
                                    <>
                                      {' '}· concluida em <span className="font-medium">{formatDateTime(latestJob.completedAt)}</span>
                                    </>
                                  ) : null}
                                </p>
                              </div>
                              {transcriptionState.activeJob && (
                                <p className="mt-2 text-amber-700">
                                  Ja existe uma transcricao em andamento para este trecho. A fila nao abre outra em paralelo.
                                </p>
                              )}
                              {transcriptionState.canRetry && (
                                <p className="mt-2 text-red-700">
                                  O ultimo job falhou, mas a sessao continua integra e este trecho pode ser tentado de novo isoladamente.
                                </p>
                              )}
                              {transcriptionState.canReuseCompleted && !transcriptionState.canRetry && (
                                <p className="mt-2 text-emerald-700">
                                  {canReuseCompleted
                                    ? 'Existe uma transcricao concluida pronta para reaproveitamento caso o estado deste trecho precise ser reparado.'
                                    : 'A ultima transcricao concluida deste trecho ja esta consolidada.'}
                                </p>
                              )}
                            </div>
                          )}
                          {latestJob?.error && (
                            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                              {mapCaptureQueueErrorMessage(latestJob.error, 'transcribe')}
                            </p>
                          )}
                          {latestJob?.transcriptText && (
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700">
                              {latestJob.transcriptText}
                            </div>
                          )}
                        </div>

                        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                                Nota
                              </p>
                              <p className="mt-1 text-sm font-medium text-slate-900">
                                {noteSaveStateLabel(noteSaveState)}
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                {noteSaveStateHelperText(noteSaveState)}
                              </p>
                            </div>

                            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${noteSaveStateTone(noteSaveState)}`}>
                              {noteSaveState === 'saving'
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <CheckCircle2 className="h-3.5 w-3.5" />}
                              {noteSaveStateLabel(noteSaveState)}
                            </div>
                          </div>
                        </div>

                        {savedNote && (
                          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                            <p className="font-medium">Nota criada a partir deste trecho</p>
                            <p className="mt-1 text-emerald-800">
                              {savedNote.title || 'Nova nota'} · salva em {formatDateTime(savedNote.created_at)}
                            </p>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}
