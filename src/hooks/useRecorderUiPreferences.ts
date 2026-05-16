import { useEffect, useMemo, useState } from 'react'
import {
  loadRecorderUiPreferences,
  normalizeRecorderUiPreferences,
  RECORDER_UI_PREFERENCES_STORAGE_KEY,
  type RecorderUiPreferences,
  type RecordingMode,
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
    // VI_MOBILE.RECORDING_DEFAULTS_AND_RECENTS_CLEANUP:
    setDefaultRecordingMode: (mode: RecordingMode) => {
      setPreferences((current) => ({
        ...current,
        defaultRecordingMode: mode,
      }))
    },
    hideRecentNoteIds: (ids: ReadonlyArray<string>) => {
      setPreferences((current) => {
        const merged = new Set(current.hiddenRecentNoteIds)
        for (const id of ids) {
          if (typeof id === 'string' && id.length > 0) merged.add(id)
        }
        return { ...current, hiddenRecentNoteIds: Array.from(merged) }
      })
    },
    /**
     * Sweep periódico: remove IDs do hiddenRecentNoteIds que não
     * existem mais (notas deletadas). Mantém a lista enxuta sem
     * vazar IDs órfãos. Idempotente.
     */
    pruneHiddenRecentNoteIds: (validIds: ReadonlyArray<string>) => {
      setPreferences((current) => {
        if (current.hiddenRecentNoteIds.length === 0) return current
        const validSet = new Set(validIds)
        const filtered = current.hiddenRecentNoteIds.filter((id) => validSet.has(id))
        if (filtered.length === current.hiddenRecentNoteIds.length) return current
        return { ...current, hiddenRecentNoteIds: filtered }
      })
    },
    clearHiddenRecentNoteIds: () => {
      setPreferences((current) => ({ ...current, hiddenRecentNoteIds: [] }))
    },
    // VI_CAPTURE_ENGINE_UNIFICATION.E2:
    setManualRetainAudio: (enabled: boolean) => {
      setPreferences((current) => ({ ...current, manualRetainAudio: enabled }))
    },
  }), [preferences])
}
