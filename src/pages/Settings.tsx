import { ArrowLeft, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { CaptureInterfaceSettings } from '../components/settings/CaptureInterfaceSettings'
import { LanguageSettings } from '../components/settings/LanguageSettings'
import { ExternalIntegrationsSettings } from '../components/settings/ExternalIntegrationsSettings'
import { useI18n } from '../hooks/useI18n'
import { useIntegrationSettings } from '../hooks/useIntegrationSettings'
import { useRecorderUiPreferences } from '../hooks/useRecorderUiPreferences'

export function Settings() {
  const navigate = useNavigate()
  const { locale, setLocale, t } = useI18n()
  const { preferences, setShowCaptureFileDetails } = useRecorderUiPreferences()
  const {
    definitions,
    areExternalIntegrationsEnabled,
    isIntegrationEnabled,
    setExternalIntegrationsEnabled,
    setIntegrationEnabled,
    resetIntegrationPreferences,
  } = useIntegrationSettings()

  const handleClose = () => {
    const historyIndex = window.history.state?.idx
    if (typeof historyIndex === 'number' && historyIndex > 0) {
      navigate(-1)
      return
    }

    navigate('/')
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
              <Settings2 className="h-5 w-5 text-slate-700" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('settings.title')}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {t('settings.description')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('settings.backToApp')}
          </button>
        </div>
      </div>

      <LanguageSettings locale={locale} onChange={setLocale} />

      <CaptureInterfaceSettings
        showCaptureFileDetails={preferences.showCaptureFileDetails}
        onToggleShowCaptureFileDetails={setShowCaptureFileDetails}
      />

      <ExternalIntegrationsSettings
        definitions={definitions}
        externalIntegrationsEnabled={areExternalIntegrationsEnabled}
        isIntegrationEnabled={isIntegrationEnabled}
        onToggleExternalIntegrations={setExternalIntegrationsEnabled}
        onToggleIntegration={setIntegrationEnabled}
        onReset={resetIntegrationPreferences}
      />
    </div>
  )
}
