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
