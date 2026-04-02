import { Settings2 } from 'lucide-react'
import { ExternalIntegrationsSettings } from '../components/settings/ExternalIntegrationsSettings'
import { useIntegrationSettings } from '../hooks/useIntegrationSettings'

export function Settings() {
  const {
    definitions,
    areExternalIntegrationsEnabled,
    isIntegrationEnabled,
    setExternalIntegrationsEnabled,
    setIntegrationEnabled,
    resetIntegrationPreferences,
  } = useIntegrationSettings()

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
            <Settings2 className="h-5 w-5 text-slate-700" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
            <p className="mt-1 text-sm text-slate-600">
              Ajustes de produto que moldam a experiencia do app sem transformar integracoes externas no centro do VoiceIdeas.
            </p>
          </div>
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
