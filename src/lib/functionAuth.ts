import { FunctionsHttpError } from '@supabase/supabase-js'
import {
  clearPersistedAuthSession,
  hasOrphanedPersistedAuthSession,
  isInvalidPersistedSessionError,
  normalizePersistedAuthSession,
  supabase,
  supabaseAnonKey,
} from './supabase'

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000

function isSessionExpiringSoon(expiresAt?: number) {
  if (!expiresAt) return true
  return expiresAt * 1000 - Date.now() <= ACCESS_TOKEN_REFRESH_BUFFER_MS
}

async function tryRefreshSession(refreshToken?: string | null) {
  try {
    if (refreshToken) {
      const refreshedWithToken = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      })

      if (refreshedWithToken.error) {
        if (isInvalidPersistedSessionError(refreshedWithToken.error)) {
          await clearPersistedAuthSession()
          await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
        }
        return null
      }

      if (refreshedWithToken.data.session) {
        return refreshedWithToken.data.session
      }
    }

    const refreshed = await supabase.auth.refreshSession()
    if (refreshed.error) {
      if (isInvalidPersistedSessionError(refreshed.error)) {
        await clearPersistedAuthSession()
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
      }
      return null
    }

    return refreshed.data.session ?? null
  } catch {
    return null
  }
}

interface AccessTokenOptions {
  forceRefresh?: boolean
}

export async function getAccessTokenOrThrow(options: AccessTokenOptions = {}) {
  await normalizePersistedAuthSession()
  const initialSessionResult = await supabase.auth.getSession()
  if (initialSessionResult.error && isInvalidPersistedSessionError(initialSessionResult.error)) {
    await clearPersistedAuthSession()
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  } else if (!initialSessionResult.data.session && hasOrphanedPersistedAuthSession()) {
    await clearPersistedAuthSession()
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  }

  let session = initialSessionResult.data.session
  const shouldRefresh = options.forceRefresh
    || !session?.user
    || !session?.access_token
    || isSessionExpiringSoon(session.expires_at)

  if (shouldRefresh) {
    const refreshedSession = await tryRefreshSession(session?.refresh_token)
    if (refreshedSession) {
      session = refreshedSession
    }
  }

  if (!session?.user || !session?.access_token) {
    const latestSessionResult = await supabase.auth.getSession()
    if (latestSessionResult.error && isInvalidPersistedSessionError(latestSessionResult.error)) {
      await clearPersistedAuthSession()
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    } else if (!latestSessionResult.data.session && hasOrphanedPersistedAuthSession()) {
      await clearPersistedAuthSession()
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    }

    const latestSession = latestSessionResult.data.session
    if (latestSession?.user && latestSession.access_token) {
      session = latestSession
    }
  }

  const accessToken = session?.access_token

  if (!session?.user || !accessToken) {
    await clearPersistedAuthSession()
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    throw new Error('Sua sessao expirou. Entre novamente para continuar.')
  }

  return accessToken
}

export async function getAuthenticatedFunctionHeaders(
  extraHeaders: Record<string, string> = {},
  options: AccessTokenOptions = {},
) {
  const accessToken = await getAccessTokenOrThrow(options)

  return {
    Authorization: `Bearer ${accessToken}`,
    'x-supabase-auth': accessToken,
    apikey: supabaseAnonKey,
    ...extraHeaders,
  }
}

type FunctionInvokeOptions<T> = Parameters<typeof supabase.functions.invoke<T>>[1]

function normalizeFunctionHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {}
  }

  if (headers instanceof Headers) {
    const normalized: Record<string, string> = {}
    headers.forEach((value, key) => {
      normalized[key] = value
    })
    return normalized
  }

  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((result, [key, value]) => {
      result[key] = value
      return result
    }, {})
  }

  return Object.entries(headers).reduce<Record<string, string>>((result, [key, value]) => {
    if (typeof value === 'string') {
      result[key] = value
    }
    return result
  }, {})
}

function hasHeader(headers: Record<string, string>, headerName: string) {
  const normalizedHeaderName = headerName.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === normalizedHeaderName)
}

function inferDefaultFunctionHeaders(
  body: unknown,
  existingHeaders: Record<string, string>,
): Record<string, string> {
  const sendsJsonBody = body != null
    && !(body instanceof FormData)
    && !(body instanceof Blob)
    && !(body instanceof ArrayBuffer)
    && !ArrayBuffer.isView(body)
    && !(body instanceof URLSearchParams)

  if (!sendsJsonBody || hasHeader(existingHeaders, 'Content-Type')) {
    return {}
  }

  return {
    'Content-Type': 'application/json',
  }
}

export async function invokeAuthenticatedFunction<T>(
  functionName: string,
  options: FunctionInvokeOptions<T> = {},
) {
  const invokeOnce = async (forceRefresh = false) => {
    const providedHeaders = normalizeFunctionHeaders(options.headers)
    const defaultHeaders = inferDefaultFunctionHeaders(options.body, providedHeaders)
    const authHeaders = await getAuthenticatedFunctionHeaders(defaultHeaders, { forceRefresh })

    return supabase.functions.invoke<T>(functionName, {
      ...options,
      headers: {
        ...providedHeaders,
        ...authHeaders,
      },
    })
  }

  let result = await invokeOnce(false)

  if (result.error instanceof FunctionsHttpError) {
    const response = result.error.context as Response | undefined
    if (response?.status === 401) {
      result = await invokeOnce(true)
    }
  }

  return result
}
