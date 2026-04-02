import type { VoiceSegmentationSettings } from '../../types/segmentation'

interface VoiceSegmentationSettingsProps {
  settings: VoiceSegmentationSettings
  disabled?: boolean
  onChange: <Key extends keyof VoiceSegmentationSettings>(
    key: Key,
    value: VoiceSegmentationSettings[Key],
  ) => void
  onReset: () => void
}

function formatSeconds(valueMs: number) {
  return String((valueMs / 1000).toFixed(1))
}

function parseSecondsInput(value: string, fallbackMs: number) {
  const numericValue = Number(value.replace(',', '.'))
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallbackMs
  }

  return Math.round(numericValue * 1000)
}

function parseIntegerInput(value: string, fallbackValue: number) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallbackValue
  }

  return Math.round(numericValue)
}

export function VoiceSegmentationSettings({
  settings,
  disabled = false,
  onChange,
  onReset,
}: VoiceSegmentationSettingsProps) {
  return (
    <div className="w-full rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">Ajustes para separar ideias</p>
          <p className="mt-1 text-xs text-slate-600">
            O audio bruto continua inteiro. Esses limites so ajudam a dividir a sessao em ideias separadas de um jeito explicavel.
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={disabled}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Restaurar padrao
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Silencio medio (segundos)</span>
          <input
            type="number"
            min="4"
            max="8"
            step="0.5"
            value={formatSeconds(settings.mediumSilenceMs)}
            disabled={disabled}
            onChange={(event) => onChange('mediumSilenceMs', parseSecondsInput(event.target.value, settings.mediumSilenceMs))}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Silencio longo (segundos)</span>
          <input
            type="number"
            min="20"
            max="30"
            step="1"
            value={formatSeconds(settings.longSilenceMs)}
            disabled={disabled}
            onChange={(event) => onChange('longSilenceMs', parseSecondsInput(event.target.value, settings.longSilenceMs))}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Trecho minimo (segundos)</span>
          <input
            type="number"
            min="3"
            max="15"
            step="0.5"
            value={formatSeconds(settings.minChunkMs)}
            disabled={disabled}
            onChange={(event) => onChange('minChunkMs', parseSecondsInput(event.target.value, settings.minChunkMs))}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Janela de analise (ms)</span>
          <input
            type="number"
            min="100"
            max="500"
            step="50"
            value={settings.analysisWindowMs}
            disabled={disabled}
            onChange={(event) => onChange('analysisWindowMs', parseIntegerInput(event.target.value, settings.analysisWindowMs))}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Expressao de corte preparada</span>
        <input
          type="text"
          value={settings.strongDelimiterPhrase}
          disabled={disabled}
          onChange={(event) => onChange('strongDelimiterPhrase', event.target.value)}
          placeholder="ex.: encerrar ideia"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <p className="mt-1 text-xs text-slate-500">
          Nesta primeira versao, a expressao fica preparada e persistida, mas a separacao real ainda usa silencio medio e longo como fronteira principal.
        </p>
      </label>
    </div>
  )
}
