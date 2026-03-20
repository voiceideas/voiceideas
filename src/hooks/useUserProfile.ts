import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { UserProfile } from '../types/database'

type EnsureUserProfileResult = UserProfile | UserProfile[] | null

interface ProfileSnapshot {
  profile: UserProfile | null
  todayCount: number
  loading: boolean
  hydrated: boolean
  userId: string | null
}

const defaultSnapshot: ProfileSnapshot = {
  profile: null,
  todayCount: 0,
  loading: true,
  hydrated: false,
  userId: null,
}

let profileSnapshot: ProfileSnapshot = defaultSnapshot
let profileRequest: Promise<void> | null = null
const profileListeners = new Set<(snapshot: ProfileSnapshot) => void>()
let authListenerReady = false

function normalizeProfile(payload: EnsureUserProfileResult): UserProfile | null {
  if (!payload) return null
  return Array.isArray(payload) ? payload[0] || null : payload
}

function getTodayCount(profile: UserProfile | null) {
  if (!profile) return 0

  const today = new Date().toISOString().slice(0, 10)
  return profile.usage_date === today ? (profile.notes_used_today || 0) : 0
}

function emitProfileSnapshot() {
  profileListeners.forEach((listener) => listener(profileSnapshot))
}

function setProfileSnapshot(next: Partial<ProfileSnapshot>) {
  profileSnapshot = { ...profileSnapshot, ...next }
  emitProfileSnapshot()
}

async function readProfileFromDatabase(userId: string) {
  const { data: profileData, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (profileData) {
    return profileData as UserProfile
  }

  if (profileError?.code === 'PGRST116') {
    const { data: ensuredProfile } = await supabase.rpc('ensure_user_profile')
    return normalizeProfile(ensuredProfile as EnsureUserProfileResult)
  }

  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)

  return profiles?.[0] ? profiles[0] as UserProfile : null
}

async function loadUserProfile(force = false) {
  if (profileRequest && !force) return profileRequest

  profileRequest = (async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user ?? null

    if (!user) {
      setProfileSnapshot({
        ...defaultSnapshot,
        loading: false,
        hydrated: true,
      })
      return
    }

    if (!force && profileSnapshot.hydrated && profileSnapshot.userId === user.id) {
      setProfileSnapshot({ loading: false })
      return
    }

    setProfileSnapshot({
      loading: true,
      userId: user.id,
    })

    const profile = await readProfileFromDatabase(user.id)

    setProfileSnapshot({
      profile,
      todayCount: getTodayCount(profile),
      loading: false,
      hydrated: true,
      userId: user.id,
    })
  })().finally(() => {
    profileRequest = null
  })

  return profileRequest
}

function ensureAuthListener() {
  if (authListenerReady) return
  authListenerReady = true

  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user ?? null

    if (!user) {
      setProfileSnapshot({
        ...defaultSnapshot,
        loading: false,
        hydrated: true,
      })
      return
    }

    if (profileSnapshot.userId !== user.id) {
      setProfileSnapshot({
        ...defaultSnapshot,
        userId: user.id,
      })
      void loadUserProfile(true)
    }
  })
}

export function prefetchUserProfile() {
  ensureAuthListener()
  return loadUserProfile()
}

export function useUserProfile() {
  const [snapshot, setSnapshot] = useState<ProfileSnapshot>(profileSnapshot)

  useEffect(() => {
    ensureAuthListener()

    const listener = (nextSnapshot: ProfileSnapshot) => {
      setSnapshot(nextSnapshot)
    }

    profileListeners.add(listener)
    listener(profileSnapshot)

    if (!profileSnapshot.hydrated && !profileRequest) {
      void loadUserProfile()
    }

    return () => {
      profileListeners.delete(listener)
    }
  }, [])

  const dailyLimit = snapshot.profile?.daily_limit ?? 10
  const remainingToday = Math.max(0, dailyLimit - snapshot.todayCount)
  const canCreateNote = remainingToday > 0
  const isAdmin = snapshot.profile?.role === 'admin'
  const loading = !snapshot.hydrated && snapshot.loading

  return {
    profile: snapshot.profile,
    todayCount: snapshot.todayCount,
    dailyLimit,
    remainingToday,
    canCreateNote,
    isAdmin,
    loading,
    refetch: () => loadUserProfile(true),
  }
}
