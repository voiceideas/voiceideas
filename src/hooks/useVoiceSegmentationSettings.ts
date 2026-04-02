import { useEffect, useState } from 'react'
import type { VoiceSegmentationSettings } from '../types/segmentation'

const STORAGE_KEY = 'voiceideas.voice-segmentation-settings.v2'
const ADVANCED_MODE_KEY = 'voiceideas.segmentation-advanced-enabled'

export const DEFAULT_VOICE_SEGMENTATION_SETTINGS: VoiceSegmentationSettings = {
  mediumSilenceMs: 800,
  longSilenceMs: 1800,
  minChunkMs: 4000,
  analysisWindowMs: 150,
  strongDelimiterPhrase: '',
}

function clampSettings(input: Partial<VoiceSegmentationSettings>): VoiceSegmentationSettings {
  const mediumSilenceMs = Math.min(2500, Math.max(600, Math.floor(input.mediumSilenceMs ?? DEFAULT_VOICE_SEGMENTATION_SETTINGS.mediumSilenceMs)))
  const longSilenceMs = Math.min(8000, Math.max(1400, Math.floor(input.longSilenceMs ?? DEFAULT_VOICE_SEGMENTATION_SETTINGS.longSilenceMs)))
  const minChunkMs = Math.min(12000, Math.max(2500, Math.floor(input.minChunkMs ?? DEFAULT_VOICE_SEGMENTATION_SETTINGS.minChunkMs)))
  const analysisWindowMs = Math.min(400, Math.max(80, Math.floor(input.analysisWindowMs ?? DEFAULT_VOICE_SEGMENTATION_SETTINGS.analysisWindowMs)))

  return {
    mediumSilenceMs,
    longSilenceMs: Math.max(longSilenceMs, mediumSilenceMs + 600),
    minChunkMs,
    analysisWindowMs,
    strongDelimiterPhrase: input.strongDelimiterPhrase?.trim() || '',
  }
}

function readPersistedSettings() {
  if (typeof window === 'undefined') {
    return DEFAULT_VOICE_SEGMENTATION_SETTINGS
  }

  if (!isAdvancedSegmentationModeEnabled()) {
    return DEFAULT_VOICE_SEGMENTATION_SETTINGS
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_VOICE_SEGMENTATION_SETTINGS
    }

    return clampSettings(JSON.parse(raw) as Partial<VoiceSegmentationSettings>)
  } catch {
    return DEFAULT_VOICE_SEGMENTATION_SETTINGS
  }
}

function isAdvancedSegmentationModeEnabled() {
  if (typeof window === 'undefined') {
    return false
  }

  const searchParams = new URLSearchParams(window.location.search)
  if (searchParams.get('segmentation') === 'advanced') {
    return true
  }

  return window.localStorage.getItem(ADVANCED_MODE_KEY) === '1'
}

export function useVoiceSegmentationSettings() {
  const [settings, setSettings] = useState<VoiceSegmentationSettings>(readPersistedSettings)
  const [advancedModeEnabled] = useState(isAdvancedSegmentationModeEnabled)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (!advancedModeEnabled) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [advancedModeEnabled, settings])

  const updateSetting = <Key extends keyof VoiceSegmentationSettings>(
    key: Key,
    value: VoiceSegmentationSettings[Key],
  ) => {
    setSettings((current) => clampSettings({
      ...current,
      [key]: value,
    }))
  }

  const replaceSettings = (nextSettings: Partial<VoiceSegmentationSettings>) => {
    setSettings(clampSettings(nextSettings))
  }

  const resetSettings = () => {
    setSettings(DEFAULT_VOICE_SEGMENTATION_SETTINGS)
  }

  return {
    settings,
    advancedModeEnabled,
    updateSetting,
    replaceSettings,
    resetSettings,
  }
}
