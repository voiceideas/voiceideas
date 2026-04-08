import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { LanguageContext, type LanguageContextValue } from '../../context/languageContext'
import {
  DEFAULT_LOCALE,
  detectPreferredLocale,
  formatWithLocale,
  I18N_STORAGE_KEY,
  LANGUAGE_OPTIONS,
  normalizeLocale,
  translate,
  type AppLocale,
  type TranslationKey,
  type TranslationParams,
} from '../../lib/i18n'

function readPersistedLocale() {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE
  }

  return detectPreferredLocale()
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(readPersistedLocale)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(I18N_STORAGE_KEY, locale)
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== I18N_STORAGE_KEY) {
        return
      }

      setLocale(normalizeLocale(event.newValue))
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const value = useMemo<LanguageContextValue>(() => ({
    locale,
    languageOptions: LANGUAGE_OPTIONS,
    setLocale,
    t: (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params),
    formatDate: (value, options) => formatWithLocale(locale, value, options),
  }), [locale])

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}
