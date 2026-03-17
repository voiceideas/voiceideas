import { useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) return

    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          setSession(null)
          setUser(null)
          return
        }

        const { data: { user } } = await supabase.auth.getUser()
        setSession(session)
        setUser(user ?? null)
      } catch {
        setSession(null)
        setUser(null)
      } finally {
        setLoading(false)
      }
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signInWithEmail = async (email: string, redirectTo = window.location.origin) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
      },
    })
    if (error) throw error
  }

  const signInWithGoogle = async (redirectTo = window.location.origin) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) throw error
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return { user, session, loading, signInWithEmail, signInWithGoogle, signOut }
}
