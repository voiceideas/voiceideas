/**
 * Hook para configurações do usuário (tabela user_settings).
 * Separado de useUserProfile (quota/role) para concerns distintos.
 *
 * VI_BRIDGE.UX_STATE_AND_PREFS.1.fix1 (2026-05-12):
 *   Antes, fetchSettings era executado APENAS no mount com deps=[]. Se o
 *   `useAuth().user` ainda não tivesse hidratado nesse momento (race comum
 *   no boot — AuthProvider ainda lendo sessão persistida), o hook chamava
 *   supabase.auth.getUser() → null, settava settings=null/loading=false, e
 *   NUNCA mais re-fetchava. Quando a sessão chegava depois, a UI ficava
 *   permanentemente preso aos defaults locais (incluindo o toggle
 *   "Enable external integrations" parecendo client-side).
 *
 *   Agora reagimos ao `useAuth()` reativo: sempre que user.id muda, refetch.
 *   Logout limpa settings imediatamente.
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface UserSettings {
  id: string
  user_id: string
  bardo_bridge_enabled: boolean
  // VI_BRIDGE.UX_STATE_AND_PREFS.1: flag mestre server-side. Antes vivia
  // apenas em localStorage (`voiceideas.integration-preferences.v1`) — limpar
  // storage desligava integrações. Agora é coluna em user_settings.
  external_integrations_enabled: boolean
  created_at: string
  updated_at: string
}

export function useUserSettings() {
  const { user } = useAuth()
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [loading, setLoading] = useState(true)

  // Refetch reativo. Lê o id do user atual a cada chamada — não captura.
  const fetchSettings = useCallback(async () => {
    if (!user) {
      setSettings(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (data) {
      setSettings(data as UserSettings)
    } else if (error?.code === 'PGRST116') {
      // Row não existe — criar com defaults.
      const { data: newSettings } = await supabase
        .from('user_settings')
        .insert({
          user_id: user.id,
          bardo_bridge_enabled: false,
          external_integrations_enabled: false,
        })
        .select()
        .single()

      if (newSettings) {
        setSettings(newSettings as UserSettings)
      }
    }

    setLoading(false)
  }, [user])

  useEffect(() => {
    void fetchSettings()
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

  const setExternalIntegrationsEnabled = useCallback(async (enabled: boolean) => {
    if (!settings) return false

    const { error } = await supabase
      .from('user_settings')
      .update({ external_integrations_enabled: enabled })
      .eq('id', settings.id)

    if (!error) {
      setSettings((prev) => prev ? { ...prev, external_integrations_enabled: enabled } : prev)
    }

    return !error
  }, [settings])

  return {
    settings,
    loading,
    bardoBridgeEnabled: settings?.bardo_bridge_enabled ?? false,
    externalIntegrationsEnabled: settings?.external_integrations_enabled ?? false,
    setBardoBridgeEnabled,
    setExternalIntegrationsEnabled,
    refetch: fetchSettings,
  }
}
