import { useState, useEffect, useCallback, useEffectEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { UserProfile } from '../types/database'

type EnsureUserProfileResult = UserProfile | UserProfile[] | null

function normalizeProfile(payload: EnsureUserProfileResult): UserProfile | null {
  if (!payload) return null
  return Array.isArray(payload) ? payload[0] || null : payload
}

export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [todayCount, setTodayCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setProfile(null)
      setLoading(false)
      return
    }

    // Fetch profile
    const { data: profileData, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (profileData) {
      setProfile(profileData as UserProfile)

      // Calcular uso de hoje
      const today = new Date().toISOString().slice(0, 10)
      if (profileData.usage_date === today) {
        setTodayCount(profileData.notes_used_today || 0)
      } else {
        setTodayCount(0)
      }
    } else if (profileError?.code === 'PGRST116') {
      // Create the profile through a safe server-side RPC with fixed defaults.
      const { data: ensuredProfile } = await supabase.rpc('ensure_user_profile')
      const newProfile = normalizeProfile(ensuredProfile as EnsureUserProfileResult)

      if (newProfile) {
        setProfile(newProfile)
        setTodayCount(0)
      }
    } else {
      // Some other error
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
      if (profiles && profiles.length > 0) {
        const p = profiles[0] as UserProfile
        setProfile(p)
        const today = new Date().toISOString().slice(0, 10)
        setTodayCount(p.usage_date === today ? (p.notes_used_today || 0) : 0)
      }
    }

    setLoading(false)
  }, [])

  const fetchProfileEvent = useEffectEvent(fetchProfile)

  useEffect(() => {
    void fetchProfileEvent()
  }, [])

  const dailyLimit = profile?.daily_limit ?? 10
  const remainingToday = Math.max(0, dailyLimit - todayCount)
  const canCreateNote = remainingToday > 0
  const isAdmin = profile?.role === 'admin'

  return {
    profile,
    todayCount,
    dailyLimit,
    remainingToday,
    canCreateNote,
    isAdmin,
    loading,
    refetch: fetchProfile,
  }
}
