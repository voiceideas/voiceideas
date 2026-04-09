import { Mic } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'

interface CaptureInterfaceSettingsProps {
  showCaptureFileDetails: boolean
  onToggleShowCaptureFileDetails: (enabled: boolean) => void
}

export function CaptureInterfaceSettings({
  showCaptureFileDetails,
  onToggleShowCaptureFileDetails,
}: CaptureInterfaceSettingsProps) {
  const { t } = useI18n()

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <Mic className="h-5 w-5 text-slate-700" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{t('settings.capture.title')}</p>
          <p className="mt-1 text-xs text-slate-600">
            {t('settings.capture.description')}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {t('settings.capture.showFileDetails.title')}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {t('settings.capture.showFileDetails.description')}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={showCaptureFileDetails}
          onClick={() => onToggleShowCaptureFileDetails(!showCaptureFileDetails)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
            showCaptureFileDetails ? 'bg-primary' : 'bg-slate-300'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              showCaptureFileDetails ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  )
}
