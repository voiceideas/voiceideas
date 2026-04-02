import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearPersistedAuthSession,
  hasOrphanedPersistedAuthSession,
  isInvalidPersistedSessionError,
  normalizePersistedAuthSession,
  supabase,
  isSupabaseConfigured,
} from '../lib/supabase'
import {
  getAuthRedirectUrl,
  isCapacitorApp,
  isNativeShellApp,
  isSupportedAuthRedirectUrl,
  isTauriApp,
} from '../lib/platform'
import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import type { EmailOtpType, Session, User } from '@supabase/supabase-js'

interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  nativeAuthPending: boolean
  signInWithEmail: (email: string, redirectTo?: string) => Promise<void>
  signInWithGoogle: (redirectTo?: string) => Promise<void>
  resumePendingAuth: () => Promise<boolean>
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

const PENDING_NATIVE_AUTH_KEY = 'voiceideas.pending-native-auth.v1'
const PENDING_NATIVE_AUTH_MAX_AGE_MS = 10 * 60 * 1000

type PendingNativeAuthProvider = 'email' | 'google'

interface PendingNativeAuthState {
  provider: PendingNativeAuthProvider
  redirectTo: string
  createdAt: number
}

function readPendingNativeAuthState(): PendingNativeAuthState | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(PENDING_NATIVE_AUTH_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<PendingNativeAuthState>
    if (
      (parsed.provider !== 'email' && parsed.provider !== 'google')
      || typeof parsed.redirectTo !== 'string'
      || typeof parsed.createdAt !== 'number'
    ) {
      return null
    }

    return {
      provider: parsed.provider,
      redirectTo: parsed.redirectTo,
      createdAt: parsed.createdAt,
    }
  } catch {
    return null
  }
}

function isPendingNativeAuthFresh(state: PendingNativeAuthState | null) {
  if (!state) return false
  return Date.now() - state.createdAt < PENDING_NATIVE_AUTH_MAX_AGE_MS
}

function persistPendingNativeAuthState(provider: PendingNativeAuthProvider, redirectTo: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(PENDING_NATIVE_AUTH_KEY, JSON.stringify({
    provider,
    redirectTo,
    createdAt: Date.now(),
  } satisfies PendingNativeAuthState))
}

function clearPendingNativeAuthState() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(PENDING_NATIVE_AUTH_KEY)
}

function cleanupAuthParamsFromUrl(incomingUrl: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const currentUrl = new URL(window.location.href)
    const handledUrl = new URL(incomingUrl)

    if (currentUrl.origin !== handledUrl.origin || currentUrl.pathname !== handledUrl.pathname) {
      return
    }

    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.delete('code')
    nextUrl.searchParams.delete('token_hash')
    nextUrl.searchParams.delete('type')
    nextUrl.searchParams.delete('error')
    nextUrl.searchParams.delete('error_code')
    nextUrl.searchParams.delete('error_description')
    nextUrl.hash = ''

    const nextHref = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`

    if (nextHref !== currentHref) {
      window.history.replaceState({}, document.title, nextHref)
    }
  } catch {
    // Ignore URL cleanup failures after auth; they should not break sign-in.
  }
}

async function openTauriExternalUrl(url: string) {
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}

async function getTauriCurrentDeepLinks() {
  const { getCurrent } = await import('@tauri-apps/plugin-deep-link')
  return getCurrent()
}

async function listenForTauriDeepLinks(handler: (urls: string[]) => void) {
  const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link')
  return onOpenUrl(handler)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [nativeAuthPending, setNativeAuthPending] = useState(() =>
    isPendingNativeAuthFresh(readPendingNativeAuthState()),
  )
  const handledUrlsRef = useRef(new Set<string>())

  const resetInvalidPersistedSession = useCallback(async () => {
    clearPendingNativeAuthState()
    setNativeAuthPending(false)
    await clearPersistedAuthSession()
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  }, [])

  const markNativeAuthPending = useCallback((provider: PendingNativeAuthProvider, redirectTo: string) => {
    persistPendingNativeAuthState(provider, redirectTo)
    setNativeAuthPending(true)
  }, [])

  const clearNativeAuthPending = useCallback(() => {
    clearPendingNativeAuthState()
    setNativeAuthPending(false)
  }, [])

  const consumeAuthRedirect = useCallback(async (incomingUrl: string) => {
    if (!isSupabaseConfigured || !isSupportedAuthRedirectUrl(incomingUrl)) {
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
        clearNativeAuthPending()
        cleanupAuthParamsFromUrl(incomingUrl)
        if (isCapacitorApp()) {
          await Browser.close().catch(() => undefined)
        }
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
        clearNativeAuthPending()
        cleanupAuthParamsFromUrl(incomingUrl)
        if (isCapacitorApp()) {
          await Browser.close().catch(() => undefined)
        }
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
        clearNativeAuthPending()
        cleanupAuthParamsFromUrl(incomingUrl)
        if (isCapacitorApp()) {
          await Browser.close().catch(() => undefined)
        }
        return true
      }

      handledUrlsRef.current.delete(incomingUrl)
      return false
    } catch (error) {
      handledUrlsRef.current.delete(incomingUrl)
      console.error('Falha ao consumir redirect de autenticacao.', error)
      return false
    }
  }, [clearNativeAuthPending])

  const recoverPendingNativeAuth = useCallback(async () => {
    if (!isSupabaseConfigured || !isCapacitorApp()) {
      return false
    }

    const pendingState = readPendingNativeAuthState()

    if (!isPendingNativeAuthFresh(pendingState)) {
      clearNativeAuthPending()
      return false
    }

    setNativeAuthPending(true)

    try {
      const launch = await CapacitorApp.getLaunchUrl().catch(() => null)
      if (launch?.url) {
        const consumed = await consumeAuthRedirect(launch.url)
        if (consumed) {
          return true
        }
      }

      const sessionResult = await supabase.auth.getSession()

      if (sessionResult.error && isInvalidPersistedSessionError(sessionResult.error)) {
        await resetInvalidPersistedSession()
        return false
      }

      const recoveredSession = sessionResult.data.session ?? null
      if (recoveredSession) {
        setSession(recoveredSession)
        setUser(recoveredSession.user)
        clearNativeAuthPending()
        await Browser.close().catch(() => undefined)
        return true
      }

      return false
    } catch (error) {
      if (isInvalidPersistedSessionError(error)) {
        await resetInvalidPersistedSession()
      }

      return false
    }
  }, [clearNativeAuthPending, consumeAuthRedirect, resetInvalidPersistedSession])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    let isMounted = true

    void (async () => {
      try {
        await normalizePersistedAuthSession()
        const sessionResult = await supabase.auth.getSession()

        if (sessionResult.error && isInvalidPersistedSessionError(sessionResult.error)) {
          await resetInvalidPersistedSession()
        }

        const currentSession = sessionResult.data.session ?? null

        if (!currentSession && hasOrphanedPersistedAuthSession()) {
          await resetInvalidPersistedSession()
        }

        if (currentSession) {
          clearNativeAuthPending()
        }

        if (!isMounted) return

        setSession(currentSession ?? null)
        setUser(currentSession?.user ?? null)
      } catch (error) {
        if (isInvalidPersistedSessionError(error)) {
          await resetInvalidPersistedSession()
        }

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
      if (nextSession) {
        clearNativeAuthPending()
      }

      if (!nextSession && hasOrphanedPersistedAuthSession()) {
        void resetInvalidPersistedSession()
      }

      if (!isMounted) return
      setSession(nextSession ?? null)
      setUser(nextSession?.user ?? null)
      setLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [clearNativeAuthPending, resetInvalidPersistedSession])

  useEffect(() => {
    if (!isSupabaseConfigured || !isNativeShellApp()) {
      return
    }

    let isMounted = true
    const cleanups: Array<() => void> = []

    void (async () => {
      if (isTauriApp()) {
        try {
          const urls = await getTauriCurrentDeepLinks()
          if (isMounted && urls?.length) {
            for (const url of urls) {
              await consumeAuthRedirect(url)
            }
          }
        } catch (error) {
          console.error('Falha ao ler deep links iniciais.', error)
        }

        try {
          const cleanup = await listenForTauriDeepLinks((urls) => {
            for (const url of urls) {
              void consumeAuthRedirect(url)
            }
          })
          cleanups.push(cleanup)
        } catch (error) {
          console.error('Falha ao escutar deep links.', error)
        }

        return
      }

      if (isCapacitorApp()) {
        try {
          const launch = await CapacitorApp.getLaunchUrl()
          if (isMounted && launch?.url) {
            await consumeAuthRedirect(launch.url)
          }
        } catch (error) {
          console.error('Falha ao ler deep link inicial do Capacitor.', error)
        }

        try {
          const listener = await CapacitorApp.addListener('appUrlOpen', (event) => {
            if (event.url) {
              void consumeAuthRedirect(event.url)
            }
          })
          cleanups.push(() => {
            void listener.remove()
          })
        } catch (error) {
          console.error('Falha ao escutar deep links do Capacitor.', error)
        }

        try {
          const listener = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
            if (isActive) {
              void recoverPendingNativeAuth()
            }
          })
          cleanups.push(() => {
            void listener.remove()
          })
        } catch (error) {
          console.error('Falha ao escutar retomada do app.', error)
        }

        await recoverPendingNativeAuth()
      }
    })()

    return () => {
      isMounted = false
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [consumeAuthRedirect, recoverPendingNativeAuth])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    session,
    loading,
    nativeAuthPending,
    signInWithEmail: async (email: string, redirectTo = getAuthRedirectUrl()) => {
      try {
        if (isNativeShellApp()) {
          markNativeAuthPending('email', redirectTo)
        }

        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: redirectTo,
          },
        })

        if (error) throw error
      } catch (error) {
        clearNativeAuthPending()
        throw error
      }
    },
    signInWithGoogle: async (redirectTo = getAuthRedirectUrl()) => {
      if (isNativeShellApp()) {
        try {
          markNativeAuthPending('google', redirectTo)
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

          if (isTauriApp()) {
            await openTauriExternalUrl(data.url)
          } else {
            await Browser.open({ url: data.url })
          }
          return
        } catch (error) {
          clearNativeAuthPending()
          throw error
        }
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      })

      if (error) throw error
    },
    resumePendingAuth: recoverPendingNativeAuth,
    signOut: async () => {
      clearNativeAuthPending()
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
  }), [
    clearNativeAuthPending,
    loading,
    markNativeAuthPending,
    nativeAuthPending,
    recoverPendingNativeAuth,
    session,
    user,
  ])

  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth precisa ser usado dentro de AuthProvider.')
  }

  return context
}
