export interface RecorderUiPreferences {
  showCaptureFileDetails: boolean
}

export const RECORDER_UI_PREFERENCES_STORAGE_KEY = 'voiceideas.recorder-ui-preferences.v1'

export const DEFAULT_RECORDER_UI_PREFERENCES: RecorderUiPreferences = {
  showCaptureFileDetails: false,
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeRecorderUiPreferences(value: unknown): RecorderUiPreferences {
  if (!isObject(value)) {
    return DEFAULT_RECORDER_UI_PREFERENCES
  }

  return {
    showCaptureFileDetails: value.showCaptureFileDetails === true,
  }
}

export function loadRecorderUiPreferences(): RecorderUiPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_RECORDER_UI_PREFERENCES
  }

  try {
    const storedValue = window.localStorage.getItem(RECORDER_UI_PREFERENCES_STORAGE_KEY)
    return storedValue
      ? normalizeRecorderUiPreferences(JSON.parse(storedValue))
      : DEFAULT_RECORDER_UI_PREFERENCES
  } catch {
    return DEFAULT_RECORDER_UI_PREFERENCES
  }
}
