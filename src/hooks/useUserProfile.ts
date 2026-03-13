import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { UserProfile } from '../types/database'

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
      // Profile doesn't exist - create with defaults
      const { data: newProfile } = await supabase
        .from('user_profiles')
        .insert({ user_id: user.id, daily_limit: 10, role: 'user', notes_used_today: 0, usage_date: new Date().toISOString().slice(0, 10) })
        .select()
        .single()
      if (newProfile) {
        setProfile(newProfile as UserProfile)
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

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

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
