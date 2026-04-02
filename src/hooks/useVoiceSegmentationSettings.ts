import { useEffect, useState } from 'react'
import type { VoiceSegmentationSettings } from '../types/segmentation'

const STORAGE_KEY = 'voiceideas.voice-segmentation-settings.v1'

export const DEFAULT_VOICE_SEGMENTATION_SETTINGS: VoiceSegmentationSettings = {
  mediumSilenceMs: 6000,
  longSilenceMs: 25000,
  minChunkMs: 5000,
  analysisWindowMs: 200,
  strongDelimiterPhrase: '',
}

function clampSettings(input: Partial<VoiceSegmentationSettings>): VoiceSegmentationSettings {
  const mediumSilenceMs = Math.min(8000, Math.max(4000, Math.floor(input.mediumSilenceMs ?? DEFAULT_VOICE_SEGMENTATION_SETTINGS.mediumSilenceMs)))
  const longSilenceMs = Math.min(30000, Math.max(20000, Math.floor(input.longSilenceMs ?? DEFAULT_VOICE_SEGMENTATION_SETTINGS.longSilenceMs)))
  const minChunkMs = Math.min(15000, Math.max(3000, Math.floor(input.minChunkMs ?? DEFAULT_VOICE_SEGMENTATION_SETTINGS.minChunkMs)))
  const analysisWindowMs = Math.min(500, Math.max(100, Math.floor(input.analysisWindowMs ?? DEFAULT_VOICE_SEGMENTATION_SETTINGS.analysisWindowMs)))

  return {
    mediumSilenceMs,
    longSilenceMs: Math.max(longSilenceMs, mediumSilenceMs + 5000),
    minChunkMs,
    analysisWindowMs,
    strongDelimiterPhrase: input.strongDelimiterPhrase?.trim() || '',
  }
}

function readPersistedSettings() {
  if (typeof window === 'undefined') {
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

export function useVoiceSegmentationSettings() {
  const [settings, setSettings] = useState<VoiceSegmentationSettings>(readPersistedSettings)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

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
    updateSetting,
    replaceSettings,
    resetSettings,
  }
}
