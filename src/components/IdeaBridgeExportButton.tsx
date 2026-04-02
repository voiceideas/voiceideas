import { AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react'
import { getBridgeDestinationLabel } from '../lib/integrations'
import type { BridgeExport, BridgeExportDestination } from '../types/bridge'
import { mapCaptureQueueErrorMessage } from '../utils/captureQueueErrorMessage'

interface IdeaBridgeExportButtonProps {
  destination: BridgeExportDestination
  latestExport: BridgeExport | null
  history: BridgeExport[]
  disabled: boolean
  loading: boolean
  onExport: () => void
}

function destinationLabel(destination: BridgeExportDestination) {
  return getBridgeDestinationLabel(destination)
}

function exportStatusLabel(status: BridgeExport['status'], destination: BridgeExportDestination) {
  const label = destinationLabel(destination)

  return ({
    failed: `Falha ao enviar para ${label}`,
    exported: `Exportado para ${label}`,
    exporting: `Enviando para ${label}`,
    pending: `Envio para ${label} registrado`,
  }[status] ?? status)
}

function statusTone(status: BridgeExport['status']) {
  if (status === 'failed') {
    return 'border-red-200 bg-red-50 text-red-700'
  }

  if (status === 'exported') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (status === 'exporting') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }

  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR')
}

export function IdeaBridgeExportButton({
  destination,
  latestExport,
  history,
  disabled,
  loading,
  onExport,
}: IdeaBridgeExportButtonProps) {
  const label = destinationLabel(destination)
  const buttonLabel = latestExport?.status === 'failed'
    ? `Tentar envio para ${label} de novo`
    : `Enviar para ${label}`

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onExport}
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Send className="h-4 w-4" />}
          {buttonLabel}
        </button>

        {latestExport && (
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusTone(latestExport.status)}`}>
            {latestExport.status === 'failed'
              ? <AlertTriangle className="h-3.5 w-3.5" />
              : <CheckCircle2 className="h-3.5 w-3.5" />}
            {exportStatusLabel(latestExport.status, destination)}
          </span>
        )}
      </div>

      <div className="text-xs text-slate-600">
        <p>Tentativas registradas: <span className="font-medium text-slate-900">{history.length}</span></p>
        {latestExport && (
          <p className="mt-1">
            Ultima tentativa: <span className="font-medium text-slate-900">{formatDateTime(latestExport.createdAt)}</span>
            {latestExport.exportedAt ? (
              <>
                {' '}· exportado em <span className="font-medium text-slate-900">{formatDateTime(latestExport.exportedAt)}</span>
              </>
            ) : null}
          </p>
        )}
      </div>

      {latestExport?.status === 'pending' && !latestExport.error && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
          {`Envio para ${label} registrado de forma auditavel. O despacho externo depende da configuracao real da bridge deste destino.`}
        </div>
      )}

      {latestExport?.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {mapCaptureQueueErrorMessage(latestExport.error, 'export')}
        </div>
      )}
    </div>
  )
}
