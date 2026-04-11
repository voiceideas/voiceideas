import { getAccessTokenOrThrow } from '../lib/functionAuth'
import { clearPersistedAuthSession, supabase } from '../lib/supabase'
import { AppError, createAppError, normalizeAppError } from '../lib/errors'

interface AuthRequirementOptions {
  forceRefresh?: boolean
}

export function isRejectedAccessTokenError(error: unknown) {
  const normalized = normalizeAppError(error, '')
  const status = normalized.status
  const message = `${normalized.message} ${normalized.details ?? ''}`.toLowerCase()

  if (status === 401 || status === 403) {
    return true
  }

  return [
    'invalid jwt',
    'jwt expired',
    'jwt malformed',
    'token has expired',
    'unauthorized',
    'not authenticated',
    'auth session missing',
  ].some((pattern) => message.includes(pattern))
}

export async function requireAuthenticatedUser(options: AuthRequirementOptions = {}) {
  const resolveUser = async (forceRefresh = false) => {
    const accessToken = await getAccessTokenOrThrow({
      forceRefresh: options.forceRefresh || forceRefresh,
    })

    return supabase.auth.getUser(accessToken)
  }

  let result = await resolveUser(false)

  if (result.error && isRejectedAccessTokenError(result.error) && !options.forceRefresh) {
    result = await resolveUser(true)
  }

  const { data: { user }, error } = result

  if (error) {
    if (isRejectedAccessTokenError(error)) {
      await clearPersistedAuthSession()
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    }

    throw await createAppError(error, 'Nao foi possivel validar a sua sessao.')
  }

  if (!user) {
    throw new AppError({
      message: 'Nao autenticado',
      code: 'not_authenticated',
      status: 401,
      details: null,
      raw: null,
    })
  }

  return user
}

export async function requireAuthenticatedUserId() {
  const user = await requireAuthenticatedUser()
  return user.id
}
