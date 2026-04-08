import { ArrowLeft, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ExternalIntegrationsSettings } from '../components/settings/ExternalIntegrationsSettings'
import { useIntegrationSettings } from '../hooks/useIntegrationSettings'

export function Settings() {
  const navigate = useNavigate()
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
              <h2 className="text-lg font-semibold text-slate-900">Ajustes</h2>
              <p className="mt-1 text-sm text-slate-600">
                Deixe o app do seu jeito sem tirar o foco do que importa: capturar, salvar e organizar ideias.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao app
          </button>
        </div>
      </div>

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
