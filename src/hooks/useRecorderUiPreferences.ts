import { useEffect, useMemo, useState } from 'react'
import {
  loadRecorderUiPreferences,
  normalizeRecorderUiPreferences,
  RECORDER_UI_PREFERENCES_STORAGE_KEY,
  type RecorderUiPreferences,
} from '../lib/recorderUiPreferences'

export function useRecorderUiPreferences() {
  const [preferences, setPreferences] = useState<RecorderUiPreferences>(loadRecorderUiPreferences)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      RECORDER_UI_PREFERENCES_STORAGE_KEY,
      JSON.stringify(preferences),
    )
  }, [preferences])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== RECORDER_UI_PREFERENCES_STORAGE_KEY) {
        return
      }

      try {
        setPreferences(normalizeRecorderUiPreferences(
          event.newValue ? JSON.parse(event.newValue) : null,
        ))
      } catch {
        setPreferences(loadRecorderUiPreferences())
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  return useMemo(() => ({
    preferences,
    setShowCaptureFileDetails: (enabled: boolean) => {
      setPreferences((current) => ({
        ...current,
        showCaptureFileDetails: enabled,
      }))
    },
  }), [preferences])
}
