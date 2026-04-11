import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js'
import {
  hasOrphanedPersistedAuthSession,
  isInvalidPersistedSessionError,
  normalizePersistedAuthSession,
  resetLocalAuthState,
  supabase,
  supabaseAnonKey,
  supabaseUrl,
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
          await resetLocalAuthState()
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
        await resetLocalAuthState()
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
  requireFreshSession?: boolean
}

export async function getAccessTokenOrThrow(options: AccessTokenOptions = {}) {
  await normalizePersistedAuthSession()
  const initialSessionResult = await supabase.auth.getSession()
  if (initialSessionResult.error && isInvalidPersistedSessionError(initialSessionResult.error)) {
    await resetLocalAuthState()
  } else if (!initialSessionResult.data.session && hasOrphanedPersistedAuthSession()) {
    await resetLocalAuthState()
  }

  let session = initialSessionResult.data.session
  let refreshAttempted = false
  let refreshFailed = false
  const shouldRefresh = options.forceRefresh
    || !session?.user
    || !session?.access_token
    || isSessionExpiringSoon(session.expires_at)

  if (shouldRefresh) {
    refreshAttempted = true
    const refreshedSession = await tryRefreshSession(session?.refresh_token)
    if (refreshedSession) {
      session = refreshedSession
    } else {
      refreshFailed = true
    }
  }

  if (options.requireFreshSession && refreshAttempted && refreshFailed) {
    await resetLocalAuthState()
    throw new Error('Sua sessao expirou. Entre novamente para continuar.')
  }

  if (!session?.user || !session?.access_token) {
    const latestSessionResult = await supabase.auth.getSession()
    if (latestSessionResult.error && isInvalidPersistedSessionError(latestSessionResult.error)) {
      await resetLocalAuthState()
    } else if (!latestSessionResult.data.session && hasOrphanedPersistedAuthSession()) {
      await resetLocalAuthState()
    }

    const latestSession = latestSessionResult.data.session
    if (latestSession?.user && latestSession.access_token) {
      session = latestSession
    }
  }

  const accessToken = session?.access_token

  if (!session?.user || !accessToken) {
    await resetLocalAuthState()
    throw new Error('Sua sessao expirou. Entre novamente para continuar.')
  }

  return accessToken
}

export async function getAuthenticatedFunctionHeaders(
  extraHeaders: Record<string, string> = {},
  options: AccessTokenOptions = {},
) {
  const accessToken = await getAccessTokenOrThrow(options)
  const bearerToken = `Bearer ${accessToken}`

  return {
    Authorization: bearerToken,
    apikey: supabaseAnonKey,
    ...extraHeaders,
  }
}

type FunctionInvokeOptions<T> = NonNullable<Parameters<typeof supabase.functions.invoke<T>>[1]>

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

function getFunctionUrl(functionName: string) {
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/${functionName}`
}

function prepareFunctionBody(
  body: FunctionInvokeOptions<unknown>['body'],
): BodyInit | undefined {
  if (!body) {
    return undefined
  }

  if (
    body instanceof Blob
    || body instanceof ArrayBuffer
    || body instanceof FormData
    || typeof body === 'string'
    || body instanceof URLSearchParams
    || body instanceof ReadableStream
  ) {
    return body
  }

  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.byteLength)
    bytes.set(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
    return bytes
  }

  return JSON.stringify(body)
}

async function parseFunctionResponse<T>(response: Response): Promise<T> {
  const responseType = (response.headers.get('Content-Type') ?? 'text/plain')
    .split(';')[0]
    .trim()

  if (responseType === 'application/json') {
    return await response.json() as T
  }

  if (responseType === 'application/octet-stream' || responseType === 'application/pdf') {
    return await response.blob() as T
  }

  if (responseType === 'text/event-stream') {
    return response as T
  }

  if (responseType === 'multipart/form-data') {
    return await response.formData() as T
  }

  return await response.text() as T
}

export async function invokeAuthenticatedFunction<T>(
  functionName: string,
  options: FunctionInvokeOptions<T> = {},
) {
  const invokeOnce = async (forceRefresh = false, requireFreshSession = false) => {
    const providedHeaders = normalizeFunctionHeaders(options.headers)
    const defaultHeaders = inferDefaultFunctionHeaders(options.body, providedHeaders)
    const authHeaders = await getAuthenticatedFunctionHeaders(defaultHeaders, {
      forceRefresh,
      requireFreshSession,
    })
    const requestHeaders = {
      ...providedHeaders,
      ...authHeaders,
    }

    try {
      const response = await fetch(getFunctionUrl(functionName), {
        method: options.method ?? 'POST',
        headers: requestHeaders,
        body: prepareFunctionBody(options.body),
        signal: options.signal,
      })

      const isRelayError = response.headers.get('x-relay-error')
      if (isRelayError === 'true') {
        throw new FunctionsRelayError(response)
      }

      if (!response.ok) {
        throw new FunctionsHttpError(response)
      }

      const data = await parseFunctionResponse<T>(response)

      return {
        data,
        error: null,
        response,
      }
    } catch (error) {
      if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
        return {
          data: null,
          error,
          response: error.context as Response | undefined,
        }
      }

      return {
        data: null,
        error: new FunctionsFetchError(error),
        response: undefined,
      }
    }
  }

  let result = await invokeOnce(false)

  if (result.error instanceof FunctionsHttpError) {
    const response = result.error.context as Response | undefined
    if (response?.status === 401) {
      result = await invokeOnce(true, true)
    }
  }

  return result
}
