import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, RefreshCw, ShieldX } from 'lucide-react'
import { CollapsibleMetaCard } from './CollapsibleMetaCard'
import { IdeaBridgeExportButton } from './IdeaBridgeExportButton'
import { useI18n } from '../hooks/useI18n'
import { useIntegrationSettings } from '../hooks/useIntegrationSettings'
import {
  exportBridgeContent,
  listBridgeExports,
  validateBridgeContent,
} from '../services/bridgeExportService'
import type {
  BridgeExport,
  BridgeExportContentType,
  BridgeExportEligibility,
} from '../types/bridge'
import { mapCaptureQueueErrorMessage } from '../utils/captureQueueErrorMessage'

// VI_BRIDGE.STATUS_AND_RESEND.1: estado pós-Bardo derivado de
// (bridge_exports.status, bridge_items.bridge_status). O contrato físico:
//   - imported → bridge_exports.status='exported' + bridge_items.bridge_status='consumed'
//   - rejected → bridge_exports.status='exported' + bridge_items.bridge_status='blocked'
//   - pending  → bridge_exports.status='pending'  (item ainda em fila do Bardo)
//   - failed   → bridge_exports.status='failed'
type BardoLifecycle = 'never_sent' | 'pending' | 'imported' | 'rejected' | 'failed' | 'exported_unknown'

function deriveBardoLifecycle(latest: BridgeExport | null): BardoLifecycle {
  if (!latest) return 'never_sent'
  if (latest.status === 'pending' || latest.status === 'exporting') return 'pending'
  if (latest.status === 'failed') return 'failed'
  const itemStatus = latest.bridgeItem?.bridgeStatus
  if (itemStatus === 'consumed') return 'imported'
  if (itemStatus === 'blocked') return 'rejected'
  return 'exported_unknown'
}

interface BardoBridgeExportPanelProps {
  contentType: Extract<BridgeExportContentType, 'note' | 'organized_idea'>
  contentId: string
}

function emptyEligibility(
  contentType: Extract<BridgeExportContentType, 'note' | 'organized_idea'>,
  contentId: string,
): BridgeExportEligibility {
  return {
    contentType,
    contentId,
    destination: 'bardo',
    eligible: false,
    sourceSessionMode: null,
    sourceSessionIds: [],
    validationStatus: 'blocked',
    validationIssues: [],
    reason: null,
  }
}

/**
 * BardoBridgeExportPanel — painel de exportação para o Bardo.
 *
 * VI_BRIDGE.MODES.1 (2026-05-12): renomeado de `SafeCaptureBridgeExportPanel`.
 * Antes cobria apenas notas de captura segura (Android Foreground Service).
 * Agora reflete a regra por-modo do servidor: aceita também notas manual e
 * contínuo (qualquer nota sem `source_capture_session_id`). A elegibilidade
 * real é decidida server-side em `validateBridgeContent` — este componente
 * apenas reflete o resultado e ativa/desativa o botão conforme.
 */
export function BardoBridgeExportPanel({
  contentType,
  contentId,
}: BardoBridgeExportPanelProps) {
  const { t } = useI18n()
  const { isIntegrationActive } = useIntegrationSettings()
  const [history, setHistory] = useState<BridgeExport[]>([])
  const [eligibility, setEligibility] = useState<BridgeExportEligibility>(() => emptyEligibility(contentType, contentId))
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [validating, setValidating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isActive = isIntegrationActive('bardo')
  const latestExport = history[0] ?? null

  const filters = useMemo(() => (
    contentType === 'note'
      ? { contentType, noteId: contentId, destination: 'bardo' as const, limit: 8 }
      : { contentType, organizedIdeaId: contentId, destination: 'bardo' as const, limit: 8 }
  ), [contentId, contentType])

  const loadHistory = useCallback(async () => {
    if (!isActive) {
      setHistory([])
      return
    }

    setLoadingHistory(true)

    try {
      const nextHistory = await listBridgeExports(filters)
      setHistory(nextHistory)
    } catch (historyError) {
      const message = historyError instanceof Error
        ? historyError.message
        : 'Nao foi possivel carregar o historico de exportacao.'
      setError(message)
    } finally {
      setLoadingHistory(false)
    }
  }, [filters, isActive])

  const loadEligibility = useCallback(async () => {
    if (!isActive) {
      setEligibility(emptyEligibility(contentType, contentId))
      return
    }

    setValidating(true)

    try {
      const result = await validateBridgeContent({
        contentType,
        contentId,
        destination: 'bardo',
      })
      setEligibility(result.eligibility)
    } catch (validationError) {
      const message = validationError instanceof Error
        ? validationError.message
        : 'Nao foi possivel validar a ponte com o Bardo.'

      setEligibility({
        ...emptyEligibility(contentType, contentId),
        reason: message,
        validationIssues: [{ code: 'validation_failed', message }],
      })
      setError(message)
    } finally {
      setValidating(false)
    }
  }, [contentId, contentType, isActive])

  useEffect(() => {
    if (!isActive) {
      setHistory([])
      setError(null)
      return
    }

    setError(null)
    void Promise.all([loadHistory(), loadEligibility()])
  }, [isActive, loadEligibility, loadHistory])

  const lifecycle = useMemo(() => deriveBardoLifecycle(latestExport), [latestExport])
  const isTerminalInBardo = lifecycle === 'imported' || lifecycle === 'rejected'
  // Resend é necessário sempre que o item passou pelo Bardo (sucesso ou
  // rejeição) OU falhou no transporte. 'pending' não-clicar pra não duplicar.
  const canResend = lifecycle === 'failed' || isTerminalInBardo
  // VI_BRIDGE.UX_STATE_AND_PREFS.1: quando a fonte atual não está elegível
  // (ex.: organized_idea cujas notas-fonte foram deletadas) MAS já existe um
  // payload exportado, oferecemos reenvio via snapshot.
  const hasSnapshot = !!latestExport?.payload
  const canSnapshotResend = canResend && !eligibility.eligible && hasSnapshot

  const handleExport = useCallback(async (mode: 'normal' | 'retry' | 'snapshot' = 'normal') => {
    setExporting(true)
    setError(null)

    try {
      // VI_BRIDGE.STATUS_AND_RESEND.1 + UX_STATE_AND_PREFS.1:
      //   - 'normal'   → primeiro envio (retry só se latestExport=failed)
      //   - 'retry'    → reenvio explícito a partir da fonte (re-resolve)
      //   - 'snapshot' → reenvio do último payload exportado, ignorando
      //                  elegibilidade atual (útil quando a fonte sumiu)
      const retry = mode === 'retry' || mode === 'snapshot' || latestExport?.status === 'failed'
      const useSnapshot = mode === 'snapshot'
      await exportBridgeContent({
        contentType,
        contentId,
        destination: 'bardo',
        retry,
        useSnapshot,
      })
      await Promise.all([loadHistory(), loadEligibility()])
    } catch (exportError) {
      const message = exportError instanceof Error
        ? exportError.message
        : 'Nao foi possivel exportar para o Bardo.'
      setError(message)
      await Promise.all([loadHistory(), loadEligibility()])
    } finally {
      setExporting(false)
    }
  }, [contentId, contentType, latestExport?.status, loadEligibility, loadHistory])

  if (!isActive) {
    return null
  }

  // VI_UX.MOBILE_COMPACTION (2026-05-13): card sempre colapsado (mobile +
  // desktop) — Bardo é estado crítico, mas não deve ocupar área nobre
  // expandido por default. Status fica no badge do header (statusLabel).
  const attempts = history.length

  type BadgeState = {
    label: string
    variant: 'neutral' | 'success' | 'warning' | 'error' | 'info'
  }
  const badgeState: BadgeState = (() => {
    if (validating || loadingHistory) {
      return { label: t('bardo.bridge.badge.reading'), variant: 'info' }
    }
    if (lifecycle === 'imported') {
      return { label: t('bardo.bridge.lifecycle.imported'), variant: 'success' }
    }
    if (lifecycle === 'rejected') {
      return { label: t('bardo.bridge.lifecycle.rejected'), variant: 'error' }
    }
    if (lifecycle === 'failed') {
      return { label: t('bardo.bridge.badge.blocked'), variant: 'error' }
    }
    if (eligibility.eligible) {
      return { label: t('bardo.bridge.badge.ready'), variant: 'success' }
    }
    return { label: t('bardo.bridge.badge.blocked'), variant: 'warning' }
  })()

  const summary = (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span>
        {validating
          ? t('bardo.bridge.status.validating')
          : eligibility.eligible
            ? eligibility.sourceSessionMode === 'safe_capture'
              ? t('bardo.bridge.status.eligibleSafe')
              : t('bardo.bridge.status.eligibleDefault')
            : (eligibility.reason ?? t('bardo.bridge.status.notReady'))}
      </span>
      {attempts > 0 && (
        <span className="text-slate-400">
          · {t('bardo.bridge.attemptsSummary', { count: attempts })}
        </span>
      )}
    </span>
  )

  return (
    <CollapsibleMetaCard
      className="mt-3"
      title={t('bardo.bridge.title')}
      statusLabel={badgeState.label}
      statusVariant={badgeState.variant}
      summary={summary}
      defaultOpen={false}
      forceOpenOnDesktop={false}
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-600">
          {validating
            ? t('bardo.bridge.status.validating')
            : eligibility.eligible
              ? eligibility.sourceSessionMode === 'safe_capture'
                ? t('bardo.bridge.status.eligibleSafe')
                : t('bardo.bridge.status.eligibleDefault')
              : (eligibility.reason ?? t('bardo.bridge.status.notReady'))}
        </p>

        <IdeaBridgeExportButton
          destination="bardo"
          latestExport={latestExport}
          history={history}
          disabled={exporting || validating || !eligibility.eligible}
          loading={exporting}
          onExport={() => {
            void handleExport('normal')
          }}
        />

        {/* VI_BRIDGE.STATUS_AND_RESEND.1: estado pós-Bardo + Reenviar */}
        {isTerminalInBardo && (
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
            <div className="flex items-center gap-2">
              {lifecycle === 'imported' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t('bardo.bridge.lifecycle.imported')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700">
                  <ShieldX className="h-3.5 w-3.5" />
                  {t('bardo.bridge.lifecycle.rejected')}
                </span>
              )}
            </div>
            <p className="mt-2">
              {lifecycle === 'imported'
                ? t('bardo.bridge.lifecycle.importedMessage')
                : t('bardo.bridge.lifecycle.rejectedMessage')}
            </p>
            <p className="mt-1 text-slate-500">
              {t('bardo.bridge.resendHelp')}
            </p>
          </div>
        )}

        {canResend && eligibility.eligible && (
          <button
            type="button"
            onClick={() => {
              void handleExport('retry')
            }}
            disabled={exporting || validating}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {lifecycle === 'failed' ? t('bardo.bridge.retry') : t('bardo.bridge.resend')}
          </button>
        )}

        {/* VI_BRIDGE.UX_STATE_AND_PREFS.1: snapshot resend quando fonte sumiu */}
        {canSnapshotResend && (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-600">
              {t('bardo.bridge.snapshotResendNotice')}
            </p>
            <button
              type="button"
              onClick={() => {
                void handleExport('snapshot')
              }}
              disabled={exporting || validating}
              className="mt-2 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t('bardo.bridge.snapshotResend')}
            </button>
          </div>
        )}

        {!eligibility.eligible && eligibility.reason && !canSnapshotResend && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            {eligibility.reason}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {mapCaptureQueueErrorMessage(error, 'export')}
          </div>
        )}
      </div>
    </CollapsibleMetaCard>
  )
}
