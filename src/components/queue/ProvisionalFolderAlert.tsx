/**
 * VI_QUEUE_TRIAGE_UX_PHASE_1 (2026-05-20)
 *
 * Alerta compacto de pasta provisória — substituirá no commit 2 o
 * bloco vermelho/emerald grande de hoje (linhas 876–963 do CaptureQueue
 * original) por uma linha menor com call-to-action discreta.
 *
 * Copy curta padrão:
 *   "Nome provisório. Renomeie para encontrar depois."
 *   [Renomear]  [Agora não]
 *
 * Atualmente apenas declarado — o CaptureQueue continua usando o
 * alerta inline até o commit 2.
 */

import { FolderPen } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'

export interface ProvisionalFolderAlertProps {
  /** Click handler do botão "Renomear" (abre editor de nome final). */
  onRenameClick: () => void
  /** Click handler do "Agora não" (dispensa o alerta nesta sessão). */
  onDismiss?: () => void
}

export function ProvisionalFolderAlert({
  onRenameClick,
  onDismiss,
}: ProvisionalFolderAlertProps) {
  const { t } = useI18n()

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p>{t('captureQueue.provisionalAlert.short')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRenameClick}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
        >
          <FolderPen className="h-3.5 w-3.5" />
          {t('captureQueue.provisionalAlert.actionRename')}
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-transparent px-2.5 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
          >
            {t('captureQueue.provisionalAlert.actionLater')}
          </button>
        )}
      </div>
    </div>
  )
}
