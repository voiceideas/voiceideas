import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey)
export const LOCAL_AUTH_RESET_EVENT = 'voiceideas:local-auth-reset'

const AUTH_STORAGE_REFRESH_BUFFER_MS = 60_000

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type ManagedStorage = {
  getItem: (key: string) => string | null | Promise<string | null>
  setItem: (key: string, value: string) => void | Promise<void>
  removeItem: (key: string) => void | Promise<void>
  isServer?: boolean
}

const pendingSessionStorageRecovery = new Map<string, Promise<string | null>>()

function getSupabaseProjectRef(url: string) {
  try {
    return new URL(url).hostname.split('.')[0] || 'auth'
  } catch {
    return 'auth'
  }
}

export const authStorageKey = `sb-${getSupabaseProjectRef(supabaseUrl)}-auth-token`

function getBrowserStorage(): BrowserStorage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function getAuthStorageKeys(storageKey = authStorageKey) {
  return [
    storageKey,
    `${storageKey}-user`,
    `${storageKey}-code-verifier`,
  ]
}

export async function clearPersistedAuthSession(storageKey = authStorageKey) {
  const storage = getBrowserStorage()
  if (!storage) {
    return
  }

  for (const key of getAuthStorageKeys(storageKey)) {
    try {
      storage.removeItem(key)
    } catch {
      // Ignore storage cleanup failures. The auth hook will still fall back to a signed-out state.
    }
  }
}

export async function resetLocalAuthState() {
  await clearPersistedAuthSession()
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOCAL_AUTH_RESET_EVENT))
  }
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null

  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function isStoredSessionCandidate(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false

  const session = value as Partial<Session>
  return typeof session.access_token === 'string' && typeof session.refresh_token === 'string'
}

export function getPersistedAuthSessionSnapshot(storageKey = authStorageKey): Session | null {
  const storage = getBrowserStorage()
  if (!storage) {
    return null
  }

  const parsedSession = safeParseJson<unknown>(storage.getItem(storageKey))
  return isStoredSessionCandidate(parsedSession) ? parsedSession : null
}

function sessionNeedsProactiveRefresh(session: Session) {
  if (!session.expires_at) {
    return false
  }

  return session.expires_at * 1000 - Date.now() <= AUTH_STORAGE_REFRESH_BUFFER_MS
}

type AuthErrorShape = {
  code?: string | number | null
  error_code?: string | number | null
  status?: number | null
  message?: string | null
  msg?: string | null
  error_description?: string | null
  details?: {
    code?: string | number | null
    message?: string | null
  } | null
}

function readAuthErrorInfo(error: unknown) {
  if (typeof error === 'string') {
    return {
      status: null,
      code: null,
      message: error.toLocaleLowerCase('pt-BR'),
    }
  }

  if (!error || typeof error !== 'object') {
    return {
      status: null,
      code: null,
      message: '',
    }
  }

  const authError = error as AuthErrorShape
  const code = authError.code ?? authError.error_code ?? authError.details?.code ?? null
  const message = [
    authError.message,
    authError.msg,
    authError.error_description,
    authError.details?.message,
  ]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.toLocaleLowerCase('pt-BR') || ''

  return {
    status: typeof authError.status === 'number' ? authError.status : null,
    code: code == null ? null : String(code).toLocaleLowerCase('pt-BR'),
    message,
  }
}

export function isInvalidPersistedSessionError(error: unknown) {
  const { status, code, message } = readAuthErrorInfo(error)
  const hasRefreshTokenSignal = (
    message.includes('refresh_token_not_found')
    || message.includes('refresh token not found')
    || message.includes('refresh token is not valid')
    || message.includes('invalid refresh token')
    || message.includes('refresh token')
  )

  if (code === 'refresh_token_not_found' || code === 'session_not_found') {
    return true
  }

  if (status === 400 && code === 'validation_failed' && hasRefreshTokenSignal) {
    return true
  }

  return hasRefreshTokenSignal && (status === 400 || status === 401 || status == null)
}

export function hasOrphanedPersistedAuthSession(storageKey = authStorageKey) {
  const storedSession = getPersistedAuthSessionSnapshot(storageKey)
  if (!storedSession) {
    return false
  }

  return !storedSession.user || sessionNeedsProactiveRefresh(storedSession)
}

function buildSessionFromRefreshPayload(payload: unknown, previousSession: Session): Session | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const next = payload as Partial<Session> & { expires_in?: number | null }
  const accessToken = typeof next.access_token === 'string' ? next.access_token : previousSession.access_token
  const refreshToken = typeof next.refresh_token === 'string' ? next.refresh_token : previousSession.refresh_token
  const expiresAt = typeof next.expires_at === 'number'
    ? next.expires_at
    : typeof next.expires_in === 'number'
      ? Math.floor(Date.now() / 1000) + next.expires_in
      : previousSession.expires_at

  if (!accessToken || !refreshToken) {
    return null
  }

  return {
    ...previousSession,
    ...next,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    user: next.user ?? previousSession.user,
  } as Session
}

async function recoverStoredSession(rawValue: string, storageKey: string) {
  const storage = getBrowserStorage()
  if (!storage) {
    return rawValue
  }

  const parsedSession = safeParseJson<unknown>(rawValue)
  if (!isStoredSessionCandidate(parsedSession)) {
    await clearPersistedAuthSession(storageKey)
    return null
  }

  if (!sessionNeedsProactiveRefresh(parsedSession)) {
    return rawValue
  }

  if (!parsedSession.refresh_token) {
    await clearPersistedAuthSession(storageKey)
    return null
  }

  const currentStoredValue = storage.getItem(storageKey)
  if (currentStoredValue !== rawValue) {
    return currentStoredValue
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refresh_token: parsedSession.refresh_token,
      }),
    })

    const responseText = await response.text()
    const responsePayload = safeParseJson<unknown>(responseText)

    if (!response.ok) {
      if (isInvalidPersistedSessionError({
        status: response.status,
        ...(responsePayload && typeof responsePayload === 'object' ? responsePayload : {}),
        message: typeof responseText === 'string' ? responseText : undefined,
      })) {
        await clearPersistedAuthSession(storageKey)
        return null
      }

      return rawValue
    }

    const refreshedSession = buildSessionFromRefreshPayload(responsePayload, parsedSession)
    if (!refreshedSession) {
      return rawValue
    }

    const nextRawValue = JSON.stringify(refreshedSession)
    storage.setItem(storageKey, nextRawValue)
    return nextRawValue
  } catch {
    return rawValue
  }
}

export async function normalizePersistedAuthSession(storageKey = authStorageKey) {
  const storage = getBrowserStorage()
  if (!storage) {
    return null
  }

  const rawValue = storage.getItem(storageKey)
  if (!rawValue) {
    return null
  }

  const normalizedRawValue = await recoverStoredSession(rawValue, storageKey)
  if (!normalizedRawValue) {
    return null
  }

  const normalizedSession = safeParseJson<unknown>(normalizedRawValue)
  return isStoredSessionCandidate(normalizedSession) ? normalizedSession : null
}

function createManagedAuthStorage(storageKey = authStorageKey): ManagedStorage | undefined {
  const storage = getBrowserStorage()
  if (!storage || !isSupabaseConfigured) {
    return undefined
  }

  return {
    getItem: async (key: string) => {
      const rawValue = storage.getItem(key)
      if (!rawValue || key !== storageKey) {
        return rawValue
      }

      const pendingRecovery = pendingSessionStorageRecovery.get(key)
      if (pendingRecovery) {
        return pendingRecovery
      }

      const recovery = recoverStoredSession(rawValue, key).finally(() => {
        pendingSessionStorageRecovery.delete(key)
      })

      pendingSessionStorageRecovery.set(key, recovery)
      return recovery
    },
    setItem: (key: string, value: string) => {
      storage.setItem(key, value)
    },
    removeItem: (key: string) => {
      storage.removeItem(key)
    },
  }
}

const managedAuthStorage = createManagedAuthStorage()

export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storageKey: authStorageKey,
        storage: managedAuthStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : (null as unknown as SupabaseClient)
