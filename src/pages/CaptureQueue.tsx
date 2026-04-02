import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FolderPen,
  History,
  Loader2,
  RefreshCcw,
  Scissors,
  Sparkles,
  Trash2,
  UploadCloud,
  Waves,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { AudioPlayer } from '../components/audio/AudioPlayer'
import { ProvisionalFolderBadge } from '../components/Folders/ProvisionalFolderBadge'
import { IdeaBridgeExportButton } from '../components/IdeaBridgeExportButton'
import { useCaptureSession } from '../hooks/useCaptureSession'
import { useCaptureQueue } from '../hooks/useCaptureQueue'
import { useIdeaDrafts } from '../hooks/useIdeaDrafts'
import { useBridgeExport } from '../hooks/useBridgeExport'
import { useIntegrationSettings } from '../hooks/useIntegrationSettings'
import { useFolderRenameRequired } from '../hooks/useFolderRenameRequired'
import { usePendingCaptureUploads } from '../hooks/usePendingCaptureUploads'
import { useVoiceSegmentationSettings } from '../hooks/useVoiceSegmentationSettings'
import { VoiceSegmentationSettings } from '../components/settings/VoiceSegmentationSettings'
import { serializeErrorForDebug } from '../lib/errors'
import { getBridgeDestinationLabel } from '../lib/integrations'
import { deleteCaptureSession, segmentCaptureSession } from '../services/captureSessionService'
import { deleteAudioChunk } from '../services/audioChunkService'
import { transcribeChunk } from '../services/transcriptionQueueService'
import { materializeIdea } from '../services/ideaDraftService'
import { exportIdeaDraft } from '../services/bridgeExportService'
import { retryPendingCaptureUpload } from '../services/pendingCaptureUploadService'
import { createLocalBlobAudioSource, createSignedCaptureAudioSource } from '../services/audioPlaybackService'
import type { CaptureSession } from '../types/capture'
import type { AudioChunk } from '../types/chunk'
import type { IdeaDraft } from '../types/ideaDraft'
import type { BridgeExportDestination } from '../types/bridge'
import type { PendingCaptureUploadRecord } from '../services/mobileLocalCaptureStore'
import { mapCaptureQueueErrorMessage, type CaptureQueueErrorContext } from '../utils/captureQueueErrorMessage'

type ActionKind =
  | 'retry-upload'
  | 'discard-local-upload'
  | 'segment'
  | 'rename'
  | 'transcribe'
  | 'materialize'
  | 'export-cenax'
  | 'export-bardo'
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
    'strong-delimiter': 'expressao forte',
    'probable-silence': 'silencio medio',
    'structural-silence': 'silencio longo',
    'session-end': 'fim da sessao',
    'manual-stop': 'parada manual',
    'single-pass': 'ideia unica',
    fallback: 'fallback',
    unknown: 'desconhecido',
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

type DraftVisualState =
  | 'waiting-transcription'
  | 'ready-to-generate'
  | 'generating'
  | 'drafted'
  | 'reviewed'
  | 'exported'
  | 'failed'

function draftVisualStateTone(status: DraftVisualState) {
  if (status === 'failed') {
    return 'border-red-200 bg-red-50 text-red-700'
  }

  if (status === 'reviewed' || status === 'exported') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (status === 'generating' || status === 'ready-to-generate') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }

  if (status === 'drafted') {
    return 'border-indigo-200 bg-indigo-50 text-indigo-700'
  }

  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function draftVisualStateLabel(status: DraftVisualState) {
  return ({
    'waiting-transcription': 'aguardando transcricao',
    'ready-to-generate': 'pronto para rascunho',
    generating: 'gerando rascunho',
    drafted: 'rascunho gerado',
    reviewed: 'revisado',
    exported: 'exportado',
    failed: 'falhou',
  }[status] ?? status)
}

function draftVisualStateHelperText(status: DraftVisualState) {
  return ({
    'waiting-transcription': 'Transcreva este trecho primeiro para liberar a criacao do rascunho.',
    'ready-to-generate': 'Este trecho ja tem texto e pode virar um rascunho revisavel.',
    generating: 'O rascunho deste trecho esta sendo gerado agora.',
    drafted: 'O rascunho ja existe e esta pronto para ser revisado em Rascunhos.',
    reviewed: 'O rascunho ja foi revisado e esta pronto para seguir no fluxo.',
    exported: 'O rascunho deste trecho ja passou pela exportacao.',
    failed: 'A ultima tentativa falhou, mas voce pode gerar o rascunho de novo.',
  }[status] ?? 'O rascunho deste trecho esta pronto para seguir no fluxo.')
}

function draftActionLabel(status: DraftVisualState) {
  if (status === 'generating') return 'Gerando rascunho...'
  if (status === 'failed') return 'Tentar de novo'
  return 'Gerar rascunho'
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

function bridgeDestinationLabel(destination: BridgeExportDestination) {
  return getBridgeDestinationLabel(destination)
}

function getVisibleDraftStatus(status: IdeaDraft['status'], showExportIntegrations: boolean): IdeaDraft['status'] {
  if (!showExportIntegrations && status === 'exported') {
    return 'reviewed'
  }

  return status
}

function errorContextFromActionKey(key: string): CaptureQueueErrorContext {
  if (key.startsWith('retry-upload:')) return 'pending-upload'
  if (key.startsWith('discard-local-upload:')) return 'discard-local-upload'
  if (key.startsWith('segment:')) return 'segment'
  if (key.startsWith('rename:')) return 'rename'
  if (key.startsWith('transcribe:')) return 'transcribe'
  if (key.startsWith('materialize:')) return 'materialize'
  if (key.startsWith('export-cenax:') || key.startsWith('export-bardo:')) return 'export'
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
    drafts,
    loading: draftsLoading,
    error: draftsError,
    refetch: refetchDrafts,
  } = useIdeaDrafts()
  const { isIntegrationActive } = useIntegrationSettings()
  const showBardoIntegration = isIntegrationActive('bardo')
  const bridgeExportFilters = useMemo(
    () => (showBardoIntegration ? { destination: 'bardo' as const } : {}),
    [showBardoIntegration],
  )
  const {
    loading: exportsLoading,
    error: exportsError,
    getExportsForDraftDestination,
    getLatestExportForDraftDestination,
    refetch: refetchExports,
  } = useBridgeExport(bridgeExportFilters, { enabled: showBardoIntegration })
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

  const isLoading = sessionsLoading || queueLoading || draftsLoading || exportsLoading || pendingUploadsLoading
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

  const draftByChunk = useMemo(() => {
    const mapped = new Map<string, IdeaDraft>()

    for (const draft of drafts) {
      if (!mapped.has(draft.chunkId)) {
        mapped.set(draft.chunkId, draft)
      }
    }

    return mapped
  }, [drafts])

  const refreshRemotePipeline = async () => {
    const tasks = [
      refetchSessions(),
      refetchQueue(),
      refetchDrafts(),
    ]

    if (showBardoIntegration) {
      tasks.push(refetchExports())
    }

    await Promise.all(tasks)
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

  const handleMaterializeChunk = async (chunk: AudioChunk) => {
    const actionKey = buildActionKey('materialize', chunk.id)
    const draft = draftByChunk.get(chunk.id)

    await runAction(actionKey, async () => {
      const result = await materializeIdea({
        chunkId: chunk.id,
        retry: draft?.status === 'failed',
      })
      await refreshRemotePipeline()
      setActionNotice(
        actionKey,
        result.created
          ? 'Rascunho gerado. Abra em Rascunhos para revisar o texto bruto, o texto limpo e as sugestoes.'
          : 'Rascunho existente reaproveitado. Abra em Rascunhos para revisar.',
      )
    })
  }

  const handleExportDraft = async (draft: IdeaDraft, destination: BridgeExportDestination) => {
    if (!showBardoIntegration) {
      return
    }

    const actionKey = buildActionKey(destination === 'cenax' ? 'export-cenax' : 'export-bardo', draft.id)
    const latestExport = getLatestExportForDraftDestination(draft.id, destination)
    const destinationLabel = bridgeDestinationLabel(destination)

    await runAction(actionKey, async () => {
      const result = await exportIdeaDraft({
        ideaDraftId: draft.id,
        destination,
        retry: latestExport?.status === 'failed',
      })
      await refreshRemotePipeline()
      setActionNotice(
        actionKey,
        result.reused
          ? `O historico mais recente de envio para ${destinationLabel} foi reaproveitado sem criar tentativa duplicada.`
          : result.auditOnly || !result.dispatched
            ? `Envio para ${destinationLabel} registrado de forma auditavel. O despacho externo depende da bridge configurada.`
            : `Rascunho enviado para ${destinationLabel} com sucesso.`,
      )
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
    [sessionsError, queueError, draftsError, exportsError]
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
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
            <p className="text-xs font-medium uppercase tracking-wider text-indigo-700">Sessoes prontas</p>
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
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">
                {pendingRenameCount} {pendingRenameCount === 1 ? 'sessao ainda usa pasta provisoria.' : 'sessoes ainda usam pasta provisoria.'}
              </p>
              <p className="mt-1 text-red-700">
                A captura ja esta segura, mas o nome temporario continua insistindo ate voce definir um nome final na propria fila.
              </p>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-red-700">
              {finalizedCount} {finalizedCount === 1 ? 'sessao ja normalizada' : 'sessoes ja normalizadas'}
            </p>
          </div>
        </div>
      )}

      <VoiceSegmentationSettings
        settings={segmentationSettings}
        onChange={updateSegmentationSetting}
        onReset={resetSegmentationSettings}
      />

      {pendingUploadsErrorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {pendingUploadsErrorMessage}
        </div>
      )}

      {remoteLoadErrors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {remoteLoadErrors.join(' · ')}
        </div>
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
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    {mapCaptureQueueErrorMessage(pendingUpload.lastError, 'pending-upload')}
                  </div>
                )}

                {retryErrorMessage && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    {retryErrorMessage}
                  </div>
                )}

                {discardErrorMessage && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    {discardErrorMessage}
                  </div>
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
          const sessionDrafts = sessionChunks.map((chunk) => draftByChunk.get(chunk.id)).filter(Boolean) as IdeaDraft[]
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
                <p>Rascunhos: <span className="font-medium text-slate-900">{sessionDrafts.length}</span></p>
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
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    {renameError}
                  </div>
                )}
                {renameNotice && (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                    {renameNotice}
                  </div>
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
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {segmentError}
                </div>
              )}

              {deleteSessionError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {deleteSessionError}
                </div>
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
                    const draft = draftByChunk.get(chunk.id) ?? null
                    const latestBardoExport = draft ? getLatestExportForDraftDestination(draft.id, 'bardo') : null
                    const bardoHistory = draft ? getExportsForDraftDestination(draft.id, 'bardo') : []
                    const transcribeActionKey = buildActionKey('transcribe', chunk.id)
                    const materializeActionKey = buildActionKey('materialize', chunk.id)
                    const exportBardoActionKey = draft ? buildActionKey('export-bardo', draft.id) : null
                    const canExportDraft = draft ? draft.status === 'reviewed' || draft.status === 'exported' : false
                    const canReuseCompleted = transcriptionState.canReuseCompleted
                      && !['transcribed', 'materialized', 'ready'].includes(chunk.queueStatus)
                    const isMaterializing = Boolean(actionLoading[materializeActionKey])
                    const visibleDraftStatus = draft ? getVisibleDraftStatus(draft.status, showBardoIntegration) : null
                    const draftVisualState: DraftVisualState = isMaterializing
                      ? 'generating'
                      : draft?.status === 'failed'
                        ? 'failed'
                        : visibleDraftStatus === 'exported'
                          ? 'exported'
                          : visibleDraftStatus === 'reviewed'
                            ? 'reviewed'
                            : draft
                              ? 'drafted'
                              : latestCompletedJob
                                ? 'ready-to-generate'
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
                            description={
                              showBardoIntegration
                                ? `Trecho ${formatChunkRange(chunk)} derivado da sessao para auditoria antes de transcrever ou enviar.`
                                : `Trecho ${formatChunkRange(chunk)} derivado da sessao para auditoria antes de transcrever ou revisar.`
                            }
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

                          {(!draft || draft.status === 'failed') && (
                            <button
                              type="button"
                              onClick={() => {
                                void handleMaterializeChunk(chunk)
                              }}
                              disabled={isMaterializing || !latestCompletedJob}
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isMaterializing
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Sparkles className="h-4 w-4" />}
                              {draftActionLabel(draftVisualState)}
                            </button>
                          )}

                          {draft && draft.status !== 'failed' && (
                            <Link
                              to={`/idea-drafts?draftId=${draft.id}&sessionId=${draft.sessionId}`}
                              className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                            >
                              <Sparkles className="h-4 w-4" />
                              Abrir rascunho
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

                        {[transcribeActionKey, materializeActionKey]
                          .map((key) => actionErrors[key])
                          .filter(Boolean)
                          .map((message, index) => (
                            <div key={`${chunk.id}-error-${index}`} className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                              {message}
                            </div>
                          ))}

                        {[transcribeActionKey, materializeActionKey]
                          .map((key) => actionNotices[key])
                          .filter(Boolean)
                          .map((message, index) => (
                            <div key={`${chunk.id}-notice-${index}`} className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                              {message}
                            </div>
                          ))}

                        {deleteChunkError && (
                          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                            {deleteChunkError}
                          </div>
                        )}

                        {isConfirmingChunkDelete && (
                          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                            <p className="text-sm font-semibold text-red-900">Excluir trecho remoto?</p>
                            <p className="mt-1 text-xs text-red-700">
                              {showBardoIntegration
                                ? 'Isso apaga este trecho remoto, o audio derivado e o ramo de transcricao, draft e integracao externa ligado a ele. A sessao bruta continua intacta.'
                                : 'Isso apaga este trecho remoto, o audio derivado e o ramo de transcricao e draft ligado a ele. A sessao bruta continua intacta.'}
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
                                Rascunho
                              </p>
                              <p className="mt-1 text-sm font-medium text-slate-900">
                                {draftVisualStateLabel(draftVisualState)}
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                {draftVisualStateHelperText(draftVisualState)}
                              </p>
                            </div>

                            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${draftVisualStateTone(draftVisualState)}`}>
                              {draftVisualState === 'failed'
                                ? <AlertTriangle className="h-3.5 w-3.5" />
                                : draftVisualState === 'generating'
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <CheckCircle2 className="h-3.5 w-3.5" />}
                              {draftVisualStateLabel(draftVisualState)}
                            </div>
                          </div>
                        </div>

                        {draft && (
                          <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
                              <p className="font-medium">Rascunho gerado</p>
                              <div className="mt-2 space-y-1 text-indigo-800">
                              <p>Status: <span className="font-medium">{draftVisualStateLabel(visibleDraftStatus === 'failed' ? 'failed' : visibleDraftStatus === 'reviewed' ? 'reviewed' : visibleDraftStatus === 'exported' ? 'exported' : 'drafted')}</span></p>
                              <p>Titulo sugerido: <span className="font-medium">{draft.suggestedTitle || 'Ideia sem titulo'}</span></p>
                              <p>Pasta sugerida: <span className="font-medium">{draft.suggestedFolder || 'sem sugestao'}</span></p>
                              <p>Tags: <span className="font-medium">{draft.suggestedTags.length ? draft.suggestedTags.join(', ') : 'sem tags'}</span></p>
                            </div>
                            <div className="mt-3 grid gap-3 lg:grid-cols-2">
                              <div className="rounded-lg border border-indigo-100 bg-white px-3 py-2 text-indigo-900">
                                <p className="text-[11px] font-medium uppercase tracking-wider text-indigo-500">Texto bruto</p>
                                <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-xs">
                                  {draft.transcriptText}
                                </p>
                              </div>
                              <div className="rounded-lg border border-indigo-100 bg-white px-3 py-2 text-indigo-900">
                                <p className="text-[11px] font-medium uppercase tracking-wider text-indigo-500">Texto limpo</p>
                                <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-xs">
                                  {draft.cleanedText || 'Ainda sem texto limpo gerado.'}
                                </p>
                              </div>
                            </div>
                            {draft.cleanedText && (
                              <div className="mt-3 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-indigo-900">
                                {draft.cleanedText}
                              </div>
                            )}

                            <div className="mt-3 flex flex-wrap gap-2">
                              <Link
                                to={`/idea-drafts?draftId=${draft.id}&sessionId=${draft.sessionId}`}
                                className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                              >
                                <Sparkles className="h-4 w-4" />
                                Abrir em Rascunhos
                              </Link>
                            </div>

                            {[exportBardoActionKey]
                              .filter(Boolean)
                              .map((key) => (key ? actionErrors[key] : null))
                              .filter(Boolean)
                              .map((message, index) => (
                                <div key={`${draft.id}-export-error-${index}`} className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                                  {message}
                                </div>
                              ))}

                            {[exportBardoActionKey]
                              .filter(Boolean)
                              .map((key) => (key ? actionNotices[key] : null))
                              .filter(Boolean)
                              .map((message, index) => (
                                <div key={`${draft.id}-export-notice-${index}`} className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                                  {message}
                                </div>
                              ))}

                            {showBardoIntegration && !canExportDraft && (
                              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                                Este rascunho ja existe, mas a exportacao fica bloqueada ate voce revisar o texto limpo, o titulo, as tags e a pasta sugerida.
                              </div>
                            )}

                            {showBardoIntegration && (
                              <div className="mt-3">
                                <IdeaBridgeExportButton
                                  destination="bardo"
                                  latestExport={latestBardoExport}
                                  history={bardoHistory}
                                  disabled={!exportBardoActionKey || Boolean(actionLoading[exportBardoActionKey]) || !canExportDraft}
                                  loading={Boolean(exportBardoActionKey && actionLoading[exportBardoActionKey])}
                                  onExport={() => {
                                    void handleExportDraft(draft, 'bardo')
                                  }}
                                />
                              </div>
                            )}
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
