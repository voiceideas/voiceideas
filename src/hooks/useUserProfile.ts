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
    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (profileData) {
      setProfile(profileData as UserProfile)
    } else {
      // Auto-create profile if missing (for users before trigger existed)
      const { data: newProfile } = await supabase
        .from('user_profiles')
        .upsert({ user_id: user.id, daily_limit: 10, role: 'user' })
        .select()
        .single()
      if (newProfile) setProfile(newProfile as UserProfile)
    }

    // Count today's notes
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { count } = await supabase
      .from('notes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', todayStart.toISOString())

    setTodayCount(count || 0)
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
