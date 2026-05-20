/**
 * VI_QUEUE_TRIAGE_UX_PHASE_1 (2026-05-20)
 *
 * Card de uma sessão (header + alerta de pasta provisória + ações de
 * sessão + lista de chunks + cards de transcrição e nota por chunk).
 *
 * Extraído de `src/pages/CaptureQueue.tsx` (linhas 818–1378 do estado
 * pré-PHASE_1) **sem mudança comportamental**. Toda a apresentação,
 * confirmações de delete, edição de nome final, banners de erro e
 * notice continuam exatamente como antes.
 *
 * Não consome `showCaptureFileDetails` ainda — isso entra no commit
 * 2 (`feat(queue): add compact session triage view`).
 */

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FolderPen,
  History,
  Loader2,
  Scissors,
  Trash2,
  Waves,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { AudioPlayer } from '../audio/AudioPlayer'
import { ProvisionalFolderBadge } from '../Folders/ProvisionalFolderBadge'
import { StatusBanner } from '../StatusBanner'
import {
  createSignedCaptureAudioSource,
} from '../../services/audioPlaybackService'
import { mapCaptureQueueErrorMessage } from '../../utils/captureQueueErrorMessage'
import type { CaptureSession } from '../../types/capture'
import type { AudioChunk, AudioChunkQueueStatus } from '../../types/chunk'
import type { Note } from '../../types/database'
import type { CaptureSessionFolderState } from '../../hooks/useFolderRenameRequired'
import type { ChunkTranscriptionState } from '../../types/transcription'
import type { TranslationKey, TranslationParams } from '../../lib/i18n'
import type { NoteSaveState } from './types'
import { ProvisionalFolderAlert } from './ProvisionalFolderAlert'
import {
  SessionStatusSummary,
  type SessionSummaryTranscriptionStatus,
} from './SessionStatusSummary'
import { TechnicalDetailsDisclosure } from './TechnicalDetailsDisclosure'

// ─── Helpers (copiados de CaptureQueue.tsx para isolar o componente) ──

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

function sessionStatusLabel(status: CaptureSession['processingStatus'] | string) {
  return (
    {
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
    } as Record<string, string>
  )[status] ?? status
}

function chunkReasonLabel(reason: AudioChunk['segmentationReason']) {
  return (
    {
      'strong-delimiter': 'corte intencional',
      'probable-silence': 'pausa curta',
      'structural-silence': 'pausa longa',
      'session-end': 'fim da sessao',
      'manual-stop': 'parada manual',
      'single-pass': 'ideia unica',
      fallback: 'ajuste automatico',
      unknown: 'ajuste automatico',
    } as Record<string, string>
  )[reason] ?? reason
}

function transcriptionStatusLabel(
  status: 'awaiting-transcription' | 'transcribing' | 'transcribed' | 'failed',
) {
  return ({
    'awaiting-transcription': 'aguardando transcricao',
    transcribing: 'transcrevendo',
    transcribed: 'transcrito',
    failed: 'falhou',
  })[status] ?? status
}

function transcriptionJobStatusLabel(
  status: 'pending' | 'processing' | 'completed' | 'failed',
) {
  return ({
    pending: 'aguardando',
    processing: 'transcrevendo',
    completed: 'transcrito',
    failed: 'falhou',
  })[status] ?? status
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
  })[status] ?? status
}

function noteSaveStateHelperText(status: NoteSaveState) {
  return ({
    'waiting-transcription':
      'Transcreva este trecho primeiro para liberar o salvamento da nota.',
    'ready-to-save':
      'O texto bruto ja esta pronto. Agora voce pode salvar esta ideia como nota.',
    saving: 'A nota deste trecho esta sendo salva agora.',
    saved: 'Este trecho ja gerou uma nota real no acervo do app.',
  })[status] ?? 'Este trecho ja pode virar nota.'
}

/**
 * VI_QUEUE_TRIAGE_UX_PHASE_1 commit 2: agrega o status de transcrição
 * da sessão a partir dos chunks. Reduz a redundância de 5 labels
 * espalhados ("transcrita"/"transcrito"/"Transcrição pronta"/...) numa
 * única classificação humana.
 */
function deriveSessionTranscriptionStatus(
  session: CaptureSession,
  chunks: AudioChunk[],
  getState: (
    chunkId: string,
    chunkQueueStatus?: AudioChunkQueueStatus,
  ) => ChunkTranscriptionState,
): SessionSummaryTranscriptionStatus {
  if (session.processingStatus === 'failed') return 'failed'

  if (chunks.length === 0) {
    if (
      session.processingStatus === 'awaiting-segmentation' ||
      session.processingStatus === 'captured' ||
      session.processingStatus === 'segmenting'
    ) {
      return 'pending'
    }
    return 'pending'
  }

  let allDone = true
  let anyInProgress = false
  let anyFailed = false
  let anyDone = false

  for (const chunk of chunks) {
    const state = getState(chunk.id, chunk.queueStatus)
    if (state.status === 'transcribing') anyInProgress = true
    else if (state.status === 'failed') anyFailed = true
    else if (state.status === 'transcribed') anyDone = true
    if (state.status !== 'transcribed') allDone = false
  }

  if (anyInProgress) return 'in-progress'
  if (allDone) return 'completed'
  if (anyDone) return 'partial'
  if (anyFailed) return 'failed'
  return 'pending'
}

/**
 * Label compacto para chunk no modo compacto: "Ideia 1", "Ideia 2"…
 * Numerado pela ordem do chunk dentro da sessão.
 */
function compactChunkLabel(
  index: number,
  t: (key: TranslationKey, params?: TranslationParams) => string,
): string {
  return t('captureQueue.compactChunk.idea', { index: index + 1 })
}

// ─── Props ────────────────────────────────────────────────────────────

export interface SessionCardProps {
  /** Sessão sendo renderizada. */
  session: CaptureSession
  /** Chunks pertencentes a esta sessão (já ordenados). */
  sessionChunks: AudioChunk[]
  /** Lookup chunkId → Note salva (se existir). */
  noteByChunk: Map<string, Note>
  /** Estado de pasta provisória / nome final, vindo de `useFolderRenameRequired`. */
  folderState: CaptureSessionFolderState
  /** Estado UI do editor de nome final. */
  isEditingFinalName: boolean
  /** Valor atual do input de rename. */
  renameValue: string
  onRenameValueChange: (value: string) => void
  onStartEditFinalName: () => void
  onSubmitRename: () => void
  /** Estado de confirmação de exclusão da sessão. */
  isConfirmingSessionDelete: boolean
  onStartConfirmSessionDelete: () => void
  onCancelConfirmSessionDelete: () => void
  onConfirmSessionDelete: () => void
  /** Estado de confirmação de exclusão de chunk. */
  confirmingChunkDeleteId: string | null
  onStartConfirmChunkDelete: (chunkId: string) => void
  onCancelConfirmChunkDelete: () => void
  onConfirmChunkDelete: (chunk: AudioChunk) => void
  /** Ações por chunk. */
  onSegmentSession: () => void
  onTranscribeChunk: (chunk: AudioChunk) => void
  onSaveChunkNote: (chunk: AudioChunk, transcriptText: string) => void
  /** Estado de loading + erros + notices indexados por actionKey. */
  actionLoading: Record<string, boolean>
  actionErrors: Record<string, string>
  actionNotices: Record<string, string>
  /** Lookup state de transcrição por chunk. */
  getChunkTranscriptionState: (
    chunkId: string,
    chunkQueueStatus?: AudioChunkQueueStatus,
  ) => ChunkTranscriptionState
  /** Player ativo (id) + setter — para coordenar múltiplos AudioPlayers. */
  activePlayerId: string | null
  setActivePlayerId: (id: string | null) => void
  /** i18n. */
  t: (key: TranslationKey, params?: TranslationParams) => string
  /** Construtor de actionKey (mantém compat com CaptureQueue). */
  buildActionKey: (
    kind:
      | 'segment'
      | 'rename'
      | 'delete-session'
      | 'transcribe'
      | 'save-note'
      | 'delete-chunk',
    id: string,
  ) => string
  /**
   * VI_QUEUE_TRIAGE_UX_PHASE_1 commit 2: quando `false` (default),
   * card renderiza apenas estado consolidado humano. Quando `true`,
   * blocos técnicos (rawStoragePath, storage paths, status bruto,
   * timestamps de jobs, helper texts redundantes) ficam visíveis.
   * Fonte: `recorderUiPreferences.showCaptureFileDetails`.
   */
  showCaptureFileDetails: boolean
}

// ─── Componente ───────────────────────────────────────────────────────

export function SessionCard(props: SessionCardProps) {
  const {
    session,
    sessionChunks,
    noteByChunk,
    folderState,
    isEditingFinalName,
    renameValue,
    onRenameValueChange,
    onStartEditFinalName,
    onSubmitRename,
    isConfirmingSessionDelete,
    onStartConfirmSessionDelete,
    onCancelConfirmSessionDelete,
    onConfirmSessionDelete,
    confirmingChunkDeleteId,
    onStartConfirmChunkDelete,
    onCancelConfirmChunkDelete,
    onConfirmChunkDelete,
    onSegmentSession,
    onTranscribeChunk,
    onSaveChunkNote,
    actionLoading,
    actionErrors,
    actionNotices,
    getChunkTranscriptionState,
    activePlayerId,
    setActivePlayerId,
    t,
    buildActionKey,
    showCaptureFileDetails,
  } = props

  const segmentActionKey = buildActionKey('segment', session.id)
  const renameActionKey = buildActionKey('rename', session.id)
  const segmentError = actionErrors[segmentActionKey]
  const renameError = actionErrors[renameActionKey]
  const renameNotice = actionNotices[renameActionKey]
  const canSegmentSession =
    Boolean(session.rawStoragePath) && sessionChunks.length === 0
  const deleteSessionActionKey = buildActionKey('delete-session', session.id)
  const deleteSessionError = actionErrors[deleteSessionActionKey]
  const isDeletingSession = Boolean(actionLoading[deleteSessionActionKey])
  const sessionSavedNotes = sessionChunks
    .map((chunk) => noteByChunk.get(chunk.id))
    .filter(Boolean)
  const aggregatedTranscriptionStatus = deriveSessionTranscriptionStatus(
    session,
    sessionChunks,
    getChunkTranscriptionState,
  )

  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        folderState.needsRename
          ? 'border-red-200 ring-1 ring-red-100'
          : 'border-slate-200'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-900">
              {folderState.displayName}
            </p>
            <ProvisionalFolderBadge needsRename={folderState.needsRename} />
          </div>
          {/* Resumo humano consolidado: sempre visível, substitui no
              compacto a redundância de "transcrita"/"transcrito"/badge. */}
          <div className="mt-1">
            <SessionStatusSummary
              transcriptionStatus={aggregatedTranscriptionStatus}
              ideasCount={sessionChunks.length}
              savedNotesCount={sessionSavedNotes.length}
              audioSaved={Boolean(session.rawStoragePath)}
            />
          </div>
          <TechnicalDetailsDisclosure visible={showCaptureFileDetails}>
            <p className="mt-1 text-xs text-slate-500">
              Sessao iniciada em {formatDateTime(session.startedAt)} · plataforma{' '}
              {session.platformSource}
            </p>
          </TechnicalDetailsDisclosure>
        </div>

        <TechnicalDetailsDisclosure visible={showCaptureFileDetails}>
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusTone(
              session.processingStatus,
            )}`}
          >
            {session.processingStatus === 'failed' ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            {sessionStatusLabel(session.processingStatus)}
          </div>
        </TechnicalDetailsDisclosure>
      </div>

      <TechnicalDetailsDisclosure visible={showCaptureFileDetails}>
        <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
          <p>
            {t('captureQueue.deep.ideasSeparated')}{' '}
            <span className="font-medium text-slate-900">
              {sessionChunks.length}
            </span>
          </p>
          <p>
            {t('captureQueue.deep.notesSaved')}{' '}
            <span className="font-medium text-slate-900">
              {sessionSavedNotes.length}
            </span>
          </p>
          <p>
            {t('captureQueue.deep.rawStatus')}{' '}
            <span className="font-medium text-slate-900">{session.status}</span>
          </p>
          <p>
            {t('captureQueue.deep.rename')}{' '}
            <span className="font-medium text-slate-900">
              {folderState.needsRename ? 'pendente' : 'normalizado'}
            </span>
          </p>
        </div>

        {session.rawStoragePath && (
          <p className="mt-2 break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600">
            rawStoragePath: {session.rawStoragePath}
          </p>
        )}
      </TechnicalDetailsDisclosure>

      {/* Compacto: alerta de pasta provisória menor + ação Renomear. */}
      {folderState.needsRename && !showCaptureFileDetails && (
        <ProvisionalFolderAlert
          onRenameClick={onStartEditFinalName}
        />
      )}

      {/* Modo detalhes: bloco grande verde/vermelho de pasta provisória
          continua disponível para QA / suporte. */}
      <TechnicalDetailsDisclosure visible={showCaptureFileDetails}>
      <div
        className={`mt-4 rounded-lg border p-3 ${
          folderState.needsRename
            ? 'border-red-200 bg-red-50'
            : 'border-emerald-200 bg-emerald-50'
        }`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p
                className={`text-xs font-medium uppercase tracking-wider ${
                  folderState.needsRename ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {folderState.needsRename
                  ? 'Pasta provisoria'
                  : 'Nome final da sessao'}
              </p>
              <p
                className={`mt-1 text-sm ${
                  folderState.needsRename ? 'text-red-900' : 'text-emerald-900'
                }`}
              >
                {folderState.needsRename
                  ? folderState.provisionalName
                  : folderState.finalName}
              </p>
              <p
                className={`mt-2 text-xs ${
                  folderState.needsRename ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {folderState.helperText}
              </p>
            </div>

            {!folderState.needsRename && !isEditingFinalName && (
              <button
                type="button"
                onClick={onStartEditFinalName}
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
                onChange={(event) => onRenameValueChange(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                onClick={onSubmitRename}
                disabled={Boolean(actionLoading[renameActionKey])}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading[renameActionKey] ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderPen className="h-4 w-4" />
                )}
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
      </TechnicalDetailsDisclosure>

      <div className="mt-4 flex flex-wrap gap-2">
        {session.rawStoragePath && (
          <AudioPlayer
            playerId={`session:${session.id}`}
            activePlayerId={activePlayerId}
            onActivePlayerChange={setActivePlayerId}
            listenLabel="Ouvir sessao"
            description="Audio bruto preservado da sessao antes de separar as ideias ou para auditoria posterior."
            loadSource={async () =>
              createSignedCaptureAudioSource(session.rawStoragePath as string)
            }
          />
        )}

        <button
          type="button"
          onClick={onSegmentSession}
          disabled={!canSegmentSession || Boolean(actionLoading[segmentActionKey])}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {actionLoading[segmentActionKey] ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Scissors className="h-4 w-4" />
          )}
          {canSegmentSession ? 'Separar ideias' : 'Ideias ja separadas'}
        </button>

        {!isConfirmingSessionDelete ? (
          <button
            type="button"
            onClick={onStartConfirmSessionDelete}
            disabled={isDeletingSession}
            className={
              showCaptureFileDetails
                ? 'inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60'
                : 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60'
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
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
          <p className="text-sm font-semibold text-red-900">
            {t('captureQueue.deep.deleteRemoteSessionConfirm')}
          </p>
          <p className="mt-1 text-xs text-red-700">
            Isso apaga a sessao remota, o audio bruto e todo o ramo novo
            derivado dela. O legado nao sera tocado.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onCancelConfirmSessionDelete}
              disabled={isDeletingSession}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirmSessionDelete}
              disabled={isDeletingSession}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeletingSession ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {t('common.delete')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {sessionChunks.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            {session.processingStatus === 'awaiting-segmentation' ||
            session.processingStatus === 'captured'
              ? 'A sessao existe, o audio bruto esta preservado e ainda falta separar em ideias.'
              : session.processingStatus === 'failed'
                ? 'A sessao falhou em alguma etapa. O audio bruto continua ancorado para retry.'
                : 'Esta sessao ainda nao tem ideias separadas visiveis.'}
          </div>
        ) : (
          sessionChunks.map((chunk, chunkIndex) => {
            const transcriptionState = getChunkTranscriptionState(
              chunk.id,
              chunk.queueStatus,
            )
            const latestJob = transcriptionState.latestJob
            const transcribeActionKey = buildActionKey('transcribe', chunk.id)
            const saveNoteActionKey = buildActionKey('save-note', chunk.id)
            const canReuseCompleted =
              transcriptionState.canReuseCompleted &&
              !['transcribed', 'materialized', 'ready'].includes(
                chunk.queueStatus,
              )
            const transcriptText =
              transcriptionState.latestCompletedJob?.transcriptText?.trim() ?? ''
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
              <div
                key={chunk.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    {/* Compacto: "Ideia N". Técnico: "Trecho 0s - 13s". */}
                    <p className="text-sm font-medium text-slate-900">
                      {showCaptureFileDetails
                        ? `Trecho ${formatChunkRange(chunk)}`
                        : compactChunkLabel(chunkIndex, t)}
                    </p>
                    <TechnicalDetailsDisclosure visible={showCaptureFileDetails}>
                      <p className="mt-1 text-xs text-slate-600">
                        {formatSeconds(chunk.durationMs)} ·{' '}
                        {chunkReasonLabel(chunk.segmentationReason)}
                      </p>
                    </TechnicalDetailsDisclosure>
                  </div>
                  <TechnicalDetailsDisclosure visible={showCaptureFileDetails}>
                    <div
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusTone(
                        chunk.queueStatus,
                      )}`}
                    >
                      {session.processingStatus === 'failed' ||
                      chunk.queueStatus === 'failed' ? (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      {sessionStatusLabel(chunk.queueStatus)}
                    </div>
                  </TechnicalDetailsDisclosure>
                </div>

                {/* Card de Transcrição (label + helper + badge) é redundância
                    no compact — o status já vai no SessionStatusSummary do header
                    da sessão. Só mostra em modo detalhes. */}
                <TechnicalDetailsDisclosure visible={showCaptureFileDetails}>
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

                      <div
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusTone(
                          transcriptionState.status,
                        )}`}
                      >
                        {transcriptionState.status === 'failed' ? (
                          <AlertTriangle className="h-3.5 w-3.5" />
                        ) : transcriptionState.status === 'transcribing' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        {transcriptionStatusLabel(transcriptionState.status)}
                      </div>
                    </div>
                  </div>
                </TechnicalDetailsDisclosure>

                {/* Compacto: mostra o transcript real (a "ideia") quando há,
                    para que o usuário veja conteúdo em vez de chunk técnico. */}
                {!showCaptureFileDetails && transcriptText && (
                  <p className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                    {transcriptText}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <AudioPlayer
                    playerId={`chunk:${chunk.id}`}
                    activePlayerId={activePlayerId}
                    onActivePlayerChange={setActivePlayerId}
                    listenLabel="Ouvir trecho"
                    description={`Trecho ${formatChunkRange(chunk)} derivado da sessao para ouvir o audio antes de salvar a nota.`}
                    loadSource={async () =>
                      createSignedCaptureAudioSource(chunk.storagePath)
                    }
                  />

                  <button
                    type="button"
                    onClick={() => onTranscribeChunk(chunk)}
                    disabled={
                      Boolean(actionLoading[transcribeActionKey]) ||
                      transcriptionState.status === 'transcribing' ||
                      (transcriptionState.status === 'transcribed' &&
                        !transcriptionState.canRetry &&
                        !canReuseCompleted)
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionLoading[transcribeActionKey] ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Waves className="h-4 w-4" />
                    )}
                    {transcriptionActionLabel(
                      transcriptionState.status,
                      transcriptionState.canRetry,
                      canReuseCompleted,
                    )}
                  </button>

                  {!savedNote && (
                    <button
                      type="button"
                      onClick={() => onSaveChunkNote(chunk, transcriptText)}
                      disabled={
                        Boolean(actionLoading[saveNoteActionKey]) ||
                        !transcriptText
                      }
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionLoading[saveNoteActionKey] ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                      {actionLoading[saveNoteActionKey]
                        ? 'Salvando nota...'
                        : 'Salvar nota'}
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
                      onClick={() => onStartConfirmChunkDelete(chunk.id)}
                      disabled={isDeletingChunk}
                      className={
                        showCaptureFileDetails
                          ? 'inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60'
                          : 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60'
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
                    <p className="text-sm font-semibold text-red-900">
                      {t('captureQueue.deep.deleteRemoteChunkConfirm')}
                    </p>
                    <p className="mt-1 text-xs text-red-700">
                      Isso apaga este trecho remoto, o audio derivado e o ramo
                      de transcricao ligado a ele. A sessao bruta continua
                      intacta.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onCancelConfirmChunkDelete}
                        disabled={isDeletingChunk}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onConfirmChunkDelete(chunk)}
                        disabled={isDeletingChunk}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isDeletingChunk ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                )}

                <TechnicalDetailsDisclosure visible={showCaptureFileDetails}>
                <div className="mt-3 space-y-2 text-xs text-slate-600">
                  <p>
                    {t('captureQueue.deep.storage')}{' '}
                    <span className="break-all font-mono text-[11px] text-slate-700">
                      {chunk.storagePath}
                    </span>
                  </p>
                  <p>
                    {t('captureQueue.deep.transcriptionState')}{' '}
                    <span className="font-medium text-slate-900">
                      {transcriptionStatusLabel(transcriptionState.status)}
                    </span>
                  </p>
                  {latestJob && (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700">
                      <div className="flex items-center gap-2">
                        <History className="h-3.5 w-3.5 text-slate-500" />
                        <p>
                          Ultima tentativa:{' '}
                          <span className="font-medium">
                            {transcriptionJobStatusLabel(latestJob.status)}
                          </span>{' '}
                          · iniciada em{' '}
                          <span className="font-medium">
                            {formatDateTime(latestJob.createdAt)}
                          </span>
                          {latestJob.completedAt ? (
                            <>
                              {' '}· concluida em{' '}
                              <span className="font-medium">
                                {formatDateTime(latestJob.completedAt)}
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      {transcriptionState.activeJob && (
                        <p className="mt-2 text-amber-700">
                          Ja existe uma transcricao em andamento para este
                          trecho. A fila nao abre outra em paralelo.
                        </p>
                      )}
                      {transcriptionState.canRetry && (
                        <p className="mt-2 text-red-700">
                          O ultimo job falhou, mas a sessao continua integra e
                          este trecho pode ser tentado de novo isoladamente.
                        </p>
                      )}
                      {transcriptionState.canReuseCompleted &&
                        !transcriptionState.canRetry && (
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

                    <div
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${noteSaveStateTone(
                        noteSaveState,
                      )}`}
                    >
                      {noteSaveState === 'saving' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      {noteSaveStateLabel(noteSaveState)}
                    </div>
                  </div>
                </div>
                </TechnicalDetailsDisclosure>

                {savedNote && (
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                    <p className="font-medium">
                      {t('captureQueue.deep.noteFromChunk')}
                    </p>
                    <p className="mt-1 text-emerald-800">
                      {savedNote.title || 'Nova nota'} · salva em{' '}
                      {formatDateTime(savedNote.created_at)}
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
}
