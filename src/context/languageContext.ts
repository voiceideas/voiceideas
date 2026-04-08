import { createContext } from 'react'
import { LANGUAGE_OPTIONS, type AppLocale, type TranslationKey, type TranslationParams } from '../lib/i18n'

export interface LanguageContextValue {
  locale: AppLocale
  languageOptions: typeof LANGUAGE_OPTIONS
  setLocale: (locale: AppLocale) => void
  t: (key: TranslationKey, params?: TranslationParams) => string
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string
}

export const LanguageContext = createContext<LanguageContextValue | null>(null)
