import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { getDefaultAuthRedirectUrl, isAndroidTauriApp, isTauriApp } from '../lib/platform'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getCurrent as getCurrentDeepLinks, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import type { EmailOtpType, Session, User } from '@supabase/supabase-js'

interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  signInWithEmail: (email: string, redirectTo?: string) => Promise<void>
  signInWithGoogle: (redirectTo?: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const EMAIL_OTP_TYPES: EmailOtpType[] = ['signup', 'magiclink', 'recovery', 'invite', 'email_change', 'email']

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return !!value && EMAIL_OTP_TYPES.includes(value as EmailOtpType)
}

function readHashParams(url: URL) {
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  return new URLSearchParams(hash)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const handledUrlsRef = useRef(new Set<string>())

  const consumeAuthRedirect = useCallback(async (incomingUrl: string) => {
    if (!isSupabaseConfigured || !incomingUrl.startsWith('voiceideas://')) {
      return false
    }

    if (handledUrlsRef.current.has(incomingUrl)) {
      return true
    }

    handledUrlsRef.current.add(incomingUrl)

    try {
      const url = new URL(incomingUrl)
      const hashParams = readHashParams(url)
      const code = url.searchParams.get('code')

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) throw error
        return true
      }

      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (error) throw error
        return true
      }

      const tokenHash = url.searchParams.get('token_hash') ?? hashParams.get('token_hash')
      const otpType = url.searchParams.get('type') ?? hashParams.get('type')

      if (tokenHash && isEmailOtpType(otpType)) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType,
        })
        if (error) throw error
        return true
      }

      handledUrlsRef.current.delete(incomingUrl)
      return false
    } catch (error) {
      handledUrlsRef.current.delete(incomingUrl)
      console.error('Falha ao consumir redirect de autenticacao.', error)
      return false
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    let isMounted = true

    void (async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession()

        if (!isMounted) return

        setSession(currentSession ?? null)
        setUser(currentSession?.user ?? null)
      } catch {
        if (!isMounted) return
        setSession(null)
        setUser(null)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return
      setSession(nextSession ?? null)
      setUser(nextSession?.user ?? null)
      setLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !isTauriApp()) {
      return
    }

    let isMounted = true
    let unlisten: (() => void) | null = null

    void (async () => {
      try {
        const urls = await getCurrentDeepLinks()
        if (isMounted && urls?.length) {
          for (const url of urls) {
            await consumeAuthRedirect(url)
          }
        }
      } catch (error) {
        console.error('Falha ao ler deep links iniciais.', error)
      }

      try {
        unlisten = await onOpenUrl((urls) => {
          for (const url of urls) {
            void consumeAuthRedirect(url)
          }
        })
      } catch (error) {
        console.error('Falha ao escutar deep links.', error)
      }
    })()

    return () => {
      isMounted = false
      unlisten?.()
    }
  }, [consumeAuthRedirect])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    session,
    loading,
    signInWithEmail: async (email: string, redirectTo = getDefaultAuthRedirectUrl()) => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
        },
      })

      if (error) throw error
    },
    signInWithGoogle: async (redirectTo = getDefaultAuthRedirectUrl()) => {
      if (isAndroidTauriApp()) {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            skipBrowserRedirect: true,
          },
        })

        if (error) throw error
        if (!data?.url) {
          throw new Error('Nao foi possivel abrir o login com Google.')
        }

        await openUrl(data.url)
        return
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      })

      if (error) throw error
    },
    signOut: async () => {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
  }), [loading, session, user])

  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth precisa ser usado dentro de AuthProvider.')
  }

  return context
}
