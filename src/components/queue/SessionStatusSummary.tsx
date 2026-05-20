/**
 * VI_QUEUE_TRIAGE_UX_PHASE_1 (2026-05-20)
 *
 * Linha humana consolidada de status de uma sessão.
 *
 * Substitui no commit 2 o conjunto redundante de status hoje espalhado:
 *   - sessionStatusLabel ("transcrita")
 *   - transcriptionStatusLabel ("transcrito")
 *   - transcriptionJobStatusLabel ("transcrito")
 *   - transcriptionActionLabel ("Transcricao pronta")
 *   - noteSaveStateLabel ("pronto para salvar")
 *
 * Em uma única linha:
 *   "Transcrição concluída · 3 ideias · 1 nota salva · áudio salvo"
 *
 * No commit 1 o componente existe mas NÃO é renderizado ainda — o
 * CaptureQueue continua usando os badges/labels redundantes atuais.
 */

import { useI18n } from '../../hooks/useI18n'
import type { TranslationKey } from '../../lib/i18n'

export type SessionSummaryTranscriptionStatus =
  | 'pending'
  | 'in-progress'
  | 'partial'
  | 'completed'
  | 'failed'

export interface SessionStatusSummaryProps {
  /** Status agregado da transcrição (após consolidar chunk + session + jobs). */
  transcriptionStatus: SessionSummaryTranscriptionStatus
  /** Quantidade de chunks (= ideias separadas). */
  ideasCount: number
  /** Quantidade de notas já salvas a partir desses chunks. */
  savedNotesCount: number
  /** Se há áudio bruto persistido na sessão (rawStoragePath != null). */
  audioSaved: boolean
}

function transcriptionLabel(
  status: SessionSummaryTranscriptionStatus,
  t: (key: TranslationKey) => string,
): string {
  switch (status) {
    case 'pending':
      return t('captureQueue.summary.transcription.pending')
    case 'in-progress':
      return t('captureQueue.summary.transcription.inProgress')
    case 'partial':
      return t('captureQueue.summary.transcription.partial')
    case 'completed':
      return t('captureQueue.summary.transcription.completed')
    case 'failed':
      return t('captureQueue.summary.transcription.failed')
  }
}

export function SessionStatusSummary(props: SessionStatusSummaryProps) {
  const { transcriptionStatus, ideasCount, savedNotesCount, audioSaved } = props
  const { t } = useI18n()

  const parts: string[] = [transcriptionLabel(transcriptionStatus, t)]

  if (ideasCount > 0) {
    parts.push(t('captureQueue.summary.ideas', { count: ideasCount }))
  }

  if (savedNotesCount > 0) {
    parts.push(t('captureQueue.summary.notes', { count: savedNotesCount }))
  }

  if (audioSaved) {
    parts.push(t('captureQueue.summary.audio.saved'))
  }

  return (
    <p className="text-xs text-slate-600">
      {parts.join(' · ')}
    </p>
  )
}
