import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface AdminUser {
  user_id: string
  email: string
  daily_limit: number
  role: string
  created_at: string
  notes_today: number
}

interface AdminUsersSnapshot {
  users: AdminUser[]
  loading: boolean
  hydrated: boolean
  error: string | null
}

const defaultSnapshot: AdminUsersSnapshot = {
  users: [],
  loading: true,
  hydrated: false,
  error: null,
}

let adminUsersSnapshot: AdminUsersSnapshot = defaultSnapshot
let adminUsersRequest: Promise<void> | null = null
const adminUsersListeners = new Set<(snapshot: AdminUsersSnapshot) => void>()

function emitAdminUsersSnapshot() {
  adminUsersListeners.forEach((listener) => listener(adminUsersSnapshot))
}

function setAdminUsersSnapshot(next: Partial<AdminUsersSnapshot>) {
  adminUsersSnapshot = { ...adminUsersSnapshot, ...next }
  emitAdminUsersSnapshot()
}

async function loadAdminUsers(force = false) {
  if (adminUsersRequest && !force) return adminUsersRequest

  adminUsersRequest = (async () => {
    setAdminUsersSnapshot({
      loading: true,
      error: null,
    })

    const { data, error: rpcError } = await supabase.rpc('get_admin_user_list')

    if (rpcError) {
      setAdminUsersSnapshot({
        loading: false,
        hydrated: true,
        error: rpcError.message,
      })
      return
    }

    setAdminUsersSnapshot({
      users: (data as AdminUser[]) || [],
      loading: false,
      hydrated: true,
      error: null,
    })
  })().finally(() => {
    adminUsersRequest = null
  })

  return adminUsersRequest
}

export function prefetchAdminUsers() {
  return loadAdminUsers()
}

export function useAdminUsers() {
  const [snapshot, setSnapshot] = useState<AdminUsersSnapshot>(adminUsersSnapshot)

  useEffect(() => {
    const listener = (nextSnapshot: AdminUsersSnapshot) => {
      setSnapshot(nextSnapshot)
    }

    adminUsersListeners.add(listener)
    listener(adminUsersSnapshot)

    if (!adminUsersSnapshot.hydrated && !adminUsersRequest) {
      void loadAdminUsers()
    }

    return () => {
      adminUsersListeners.delete(listener)
    }
  }, [])

  const updateUserLimit = async (userId: string, newLimit: number) => {
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ daily_limit: newLimit })
      .eq('user_id', userId)

    if (updateError) throw new Error(updateError.message)

    setAdminUsersSnapshot({
      users: adminUsersSnapshot.users.map((user) => (
        user.user_id === userId ? { ...user, daily_limit: newLimit } : user
      )),
    })
  }

  const updateUserRole = async (userId: string, newRole: string) => {
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ role: newRole })
      .eq('user_id', userId)

    if (updateError) throw new Error(updateError.message)

    setAdminUsersSnapshot({
      users: adminUsersSnapshot.users.map((user) => (
        user.user_id === userId ? { ...user, role: newRole } : user
      )),
    })
  }

  return {
    users: snapshot.users,
    loading: !snapshot.hydrated && snapshot.loading,
    refreshing: snapshot.loading,
    error: snapshot.error,
    updateUserLimit,
    updateUserRole,
    refetch: () => loadAdminUsers(true),
  }
}
