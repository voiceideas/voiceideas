import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { IdeaBridgeExportButton } from './IdeaBridgeExportButton'
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

interface SafeCaptureBridgeExportPanelProps {
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

export function SafeCaptureBridgeExportPanel({
  contentType,
  contentId,
}: SafeCaptureBridgeExportPanelProps) {
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

  const handleExport = useCallback(async () => {
    setExporting(true)
    setError(null)

    try {
      await exportBridgeContent({
        contentType,
        contentId,
        destination: 'bardo',
        retry: latestExport?.status === 'failed',
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

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Ponte v1 · Bardo
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {validating
              ? 'Validando elegibilidade da captura segura...'
              : eligibility.eligible
                ? 'Elegivel: origem em captura segura concluida e sincronizada.'
                : (eligibility.reason ?? 'Este item ainda nao esta apto para exportar.')}
          </p>
        </div>

        {validating || loadingHistory ? (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            lendo
          </span>
        ) : eligibility.eligible ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            pronto
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            bloqueado
          </span>
        )}
      </div>

      <IdeaBridgeExportButton
        destination="bardo"
        latestExport={latestExport}
        history={history}
        disabled={exporting || validating || !eligibility.eligible}
        loading={exporting}
        onExport={() => {
          void handleExport()
        }}
      />

      {!eligibility.eligible && eligibility.reason && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {eligibility.reason}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {mapCaptureQueueErrorMessage(error, 'export')}
        </div>
      )}
    </div>
  )
}
