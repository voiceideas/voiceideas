import type { ExternalIntegrationDefinition, ExternalIntegrationId } from '../../types/integrations'
import { useI18n } from '../../hooks/useI18n'

interface ExternalIntegrationsSettingsProps {
  definitions: readonly ExternalIntegrationDefinition[]
  externalIntegrationsEnabled: boolean
  isIntegrationEnabled: (integrationId: ExternalIntegrationId) => boolean
  onToggleExternalIntegrations: (enabled: boolean) => void
  onToggleIntegration: (integrationId: ExternalIntegrationId, enabled: boolean) => void
  onReset: () => void
}

interface ToggleRowProps {
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

function ToggleRow({
  title,
  description,
  checked,
  disabled = false,
  onChange,
}: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="mt-1 text-xs text-slate-600">{description}</p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-slate-300'
        } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

export function ExternalIntegrationsSettings({
  definitions,
  externalIntegrationsEnabled,
  isIntegrationEnabled,
  onToggleExternalIntegrations,
  onToggleIntegration,
  onReset,
}: ExternalIntegrationsSettingsProps) {
  const { t } = useI18n()
  const getIntegrationDescription = (integration: ExternalIntegrationDefinition) => {
    if (integration.id === 'bardo') {
      return t('integrations.destination.bardo.description')
    }

    return integration.description
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">{t('integrations.title')}</p>
          <p className="mt-1 text-xs text-slate-600">
            {t('integrations.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          {t('integrations.reset')}
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <ToggleRow
          title={t('integrations.external.title')}
          description={t('integrations.external.description')}
          checked={externalIntegrationsEnabled}
          onChange={onToggleExternalIntegrations}
        />

        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-100 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            {t('integrations.destinations')}
          </p>

          {definitions.map((integration) => (
            <ToggleRow
              key={integration.id}
              title={integration.label}
              description={
                externalIntegrationsEnabled
                  ? getIntegrationDescription(integration)
                  : t('integrations.enableToConfigure')
              }
              checked={isIntegrationEnabled(integration.id)}
              disabled={!externalIntegrationsEnabled}
              onChange={(checked) => onToggleIntegration(integration.id, checked)}
            />
          ))}

          <p className="text-xs text-slate-500">
            {t('integrations.future')}
          </p>
        </div>
      </div>
    </div>
  )
}
