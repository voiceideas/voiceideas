// VI_MOBILE.RECORDING_DEFAULTS_AND_RECENTS_CLEANUP (2026-05-14):
// `defaultRecordingMode` persiste a escolha de modo do usuário (Manual/
//   Contínuo/Safe Capture). Primeiro boot é sempre Manual — Safe Capture
//   não deve ser fallback silencioso, mesmo onde a plataforma suporta.
// `hiddenRecentNoteIds` esconde notas da lista de recentes na tela
//   Gravar. NÃO apaga do banco, fila, organizadas ou arquivo — só
//   limpeza visual da superfície de gravação.

export type RecordingMode = 'manual' | 'continuous' | 'safe-capture'

const RECORDING_MODE_VALUES: ReadonlyArray<RecordingMode> = [
  'manual',
  'continuous',
  'safe-capture',
]

function isRecordingMode(value: unknown): value is RecordingMode {
  return typeof value === 'string' && (RECORDING_MODE_VALUES as readonly string[]).includes(value)
}

function normalizeHiddenRecentNoteIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0 && item.length <= 128) {
      out.push(item)
    }
  }
  return out
}

export interface RecorderUiPreferences {
  showCaptureFileDetails: boolean
  /**
   * Modo de gravação preferido pelo usuário. `null` = nunca escolheu
   * explicitamente; usa default (Manual). VoiceRecorder lê isto na
   * inicialização e persiste a cada mudança via setDefaultRecordingMode.
   */
  defaultRecordingMode: RecordingMode | null
  /**
   * IDs de notas escondidas da lista de recentes na tela Gravar.
   * A nota continua existindo no banco, na fila, em organizadas e em
   * arquivo. Limpeza puramente visual da "mesa de trabalho".
   */
  hiddenRecentNoteIds: string[]
}

export const RECORDER_UI_PREFERENCES_STORAGE_KEY = 'voiceideas.recorder-ui-preferences.v1'

export const DEFAULT_RECORDER_UI_PREFERENCES: RecorderUiPreferences = {
  showCaptureFileDetails: false,
  defaultRecordingMode: null,
  hiddenRecentNoteIds: [],
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
    defaultRecordingMode: isRecordingMode(value.defaultRecordingMode)
      ? value.defaultRecordingMode
      : null,
    hiddenRecentNoteIds: normalizeHiddenRecentNoteIds(value.hiddenRecentNoteIds),
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
