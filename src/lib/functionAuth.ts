import { supabase, supabaseAnonKey } from './supabase'

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000

function isSessionExpiringSoon(expiresAt?: number) {
  if (!expiresAt) return true
  return expiresAt * 1000 - Date.now() <= ACCESS_TOKEN_REFRESH_BUFFER_MS
}

export async function getAccessTokenOrThrow() {
  const initialSessionResult = await supabase.auth.getSession()
  let session = initialSessionResult.data.session

  if (session?.refresh_token && isSessionExpiringSoon(session.expires_at)) {
    const refreshed = await supabase.auth.refreshSession({
      refresh_token: session.refresh_token,
    })

    if (refreshed.data.session) {
      session = refreshed.data.session
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
) {
  const accessToken = await getAccessTokenOrThrow()

  return {
    Authorization: `Bearer ${accessToken}`,
    apikey: supabaseAnonKey,
    ...extraHeaders,
  }
}
