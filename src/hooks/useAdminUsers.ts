import { useState, useEffect, useCallback, useEffectEvent } from 'react'
import { supabase } from '../lib/supabase'

interface AdminUser {
  user_id: string
  email: string
  daily_limit: number
  role: string
  created_at: string
  notes_today: number
}

export function useAdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('get_admin_user_list')

    if (rpcError) {
      setError(rpcError.message)
    } else {
      setUsers((data as AdminUser[]) || [])
    }
    setLoading(false)
  }, [])

  const fetchUsersEvent = useEffectEvent(fetchUsers)

  useEffect(() => {
    void fetchUsersEvent()
  }, [])

  const updateUserLimit = async (userId: string, newLimit: number) => {
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ daily_limit: newLimit })
      .eq('user_id', userId)

    if (updateError) throw new Error(updateError.message)
    setUsers((prev) =>
      prev.map((u) => (u.user_id === userId ? { ...u, daily_limit: newLimit } : u)),
    )
  }

  const updateUserRole = async (userId: string, newRole: string) => {
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ role: newRole })
      .eq('user_id', userId)

    if (updateError) throw new Error(updateError.message)
    setUsers((prev) =>
      prev.map((u) => (u.user_id === userId ? { ...u, role: newRole } : u)),
    )
  }

  return { users, loading, error, updateUserLimit, updateUserRole, refetch: fetchUsers }
}
