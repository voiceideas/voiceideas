import { Languages } from 'lucide-react'
import type { AppLocale } from '../../lib/i18n'
import { useI18n } from '../../hooks/useI18n'

interface LanguageSettingsProps {
  locale: AppLocale
  onChange: (locale: AppLocale) => void
}

export function LanguageSettings({ locale, onChange }: LanguageSettingsProps) {
  const { t, languageOptions } = useI18n()

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <Languages className="h-5 w-5 text-slate-700" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{t('language.title')}</p>
          <p className="mt-1 text-xs text-slate-600">
            {t('language.description')}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {languageOptions.map((option) => {
          const active = locale === option.value

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                active
                  ? 'border-primary bg-white text-primary shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className="block font-medium">{t(option.labelKey)}</span>
              <span className="mt-1 block text-[11px] uppercase tracking-[0.16em] text-slate-400">
                {option.value}
              </span>
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {t('language.help')}
      </p>
    </div>
  )
}
