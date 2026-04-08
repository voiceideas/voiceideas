import { enMessages, esMessages, ptBrMessages, type TranslationKey, type TranslationMessage, type TranslationParams } from './i18nMessages'

export type AppLocale = 'pt-BR' | 'en' | 'es'

export const DEFAULT_LOCALE: AppLocale = 'pt-BR'
export const I18N_STORAGE_KEY = 'voiceideas.language.v1'
export const SUPPORTED_LOCALES: readonly AppLocale[] = ['pt-BR', 'en', 'es']

export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: AppLocale; labelKey: TranslationKey }> = [
  { value: 'pt-BR', labelKey: 'language.option.pt-BR' },
  { value: 'en', labelKey: 'language.option.en' },
  { value: 'es', labelKey: 'language.option.es' },
]

const MESSAGES: Record<AppLocale, Record<TranslationKey, TranslationMessage>> = {
  'pt-BR': ptBrMessages,
  en: enMessages,
  es: esMessages,
}

export function normalizeLocale(rawLocale: string | null | undefined): AppLocale {
  if (!rawLocale) {
    return DEFAULT_LOCALE
  }

  const normalized = rawLocale.trim().toLowerCase()

  if (normalized.startsWith('pt')) {
    return 'pt-BR'
  }

  if (normalized.startsWith('en')) {
    return 'en'
  }

  if (normalized.startsWith('es')) {
    return 'es'
  }

  return DEFAULT_LOCALE
}

export function detectPreferredLocale(): AppLocale {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE
  }

  try {
    const persisted = window.localStorage.getItem(I18N_STORAGE_KEY)
    if (persisted) {
      return normalizeLocale(persisted)
    }
  } catch {
    // Ignore broken local storage and fall back to browser language.
  }

  return normalizeLocale(window.navigator.language)
}

function interpolateMessage(template: string, params: TranslationParams = {}) {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, token) => {
    const value = params[token]
    return value === undefined || value === null ? '' : String(value)
  })
}

export function translate(
  locale: AppLocale,
  key: TranslationKey,
  params: TranslationParams = {},
): string {
  const message = MESSAGES[locale][key] ?? MESSAGES[DEFAULT_LOCALE][key]

  if (typeof message === 'function') {
    return message(params)
  }

  return interpolateMessage(message, params)
}

export function formatWithLocale(
  locale: AppLocale,
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
) {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(locale, options).format(date)
}

export type { TranslationKey, TranslationParams }
