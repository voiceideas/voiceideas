/**
 * Hook para configurações do usuário (tabela user_settings).
 * Separado de useUserProfile (quota/role) para concerns distintos.
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface UserSettings {
  id: string
  user_id: string
  bardo_bridge_enabled: boolean
  created_at: string
  updated_at: string
}

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSettings = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setSettings(null)
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (data) {
      setSettings(data as UserSettings)
    } else if (error?.code === 'PGRST116') {
      // Row não existe — criar com defaults
      const { data: newSettings } = await supabase
        .from('user_settings')
        .insert({ user_id: user.id, bardo_bridge_enabled: false })
        .select()
        .single()

      if (newSettings) {
        setSettings(newSettings as UserSettings)
      }
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void Promise.resolve().then(fetchSettings)
  }, [fetchSettings])

  const setBardoBridgeEnabled = useCallback(async (enabled: boolean) => {
    if (!settings) return

    const { error } = await supabase
      .from('user_settings')
      .update({ bardo_bridge_enabled: enabled })
      .eq('id', settings.id)

    if (!error) {
      setSettings((prev) => prev ? { ...prev, bardo_bridge_enabled: enabled } : prev)
    }

    return !error
  }, [settings])

  return {
    settings,
    loading,
    bardoBridgeEnabled: settings?.bardo_bridge_enabled ?? false,
    setBardoBridgeEnabled,
    refetch: fetchSettings,
  }
}
