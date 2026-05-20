/**
 * VI_QUEUE_TRIAGE_UX_PHASE_1 (2026-05-20)
 *
 * Empty state da página Fila. No commit 1 substitui o bloco inline
 * que aparece quando não há sessões nem pending uploads.
 *
 * Variantes:
 *   - `no-sessions`: nada para mostrar ainda.
 *   - `all-done`: tudo transcrito e pronto.
 *   - `ideas-ready`: N ideias prontas para virar nota.
 *
 * Por enquanto apenas `no-sessions` é renderizado pelo CaptureQueue.
 * As outras variantes serão usadas no commit 2 quando a página
 * passar a refletir o estado consolidado.
 */

import { useI18n } from '../../hooks/useI18n'

export type QueueEmptyStateKind = 'no-sessions' | 'all-done' | 'ideas-ready'

export interface QueueEmptyStateProps {
  kind: QueueEmptyStateKind
  /** Usado apenas em `ideas-ready` para mostrar "N ideias prontas". */
  count?: number
}

export function QueueEmptyState({ kind, count = 0 }: QueueEmptyStateProps) {
  const { t } = useI18n()

  if (kind === 'no-sessions') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        {t('captureQueue.empty.noSessions')}
      </div>
    )
  }

  if (kind === 'all-done') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-900">
        {t('captureQueue.empty.allDone')}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
      {t('captureQueue.empty.ideasReady', { count })}
    </div>
  )
}
