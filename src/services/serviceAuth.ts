import { getAccessTokenOrThrow } from '../lib/functionAuth'
import { resetLocalAuthState, supabase } from '../lib/supabase'
import { AppError, classifyAppError, createAppError, normalizeAppError } from '../lib/errors'

interface AuthRequirementOptions {
  forceRefresh?: boolean
}

// Mantido por compatibilidade com callers existentes. Internamente usa
// classifyAppError para que 401/403 + padrões de texto fiquem alinhados
// com o resto do pipeline (errors.ts).
export function isRejectedAccessTokenError(error: unknown) {
  const kind = classifyAppError(error)
  return kind === 'session_expired'
    || kind === 'not_authenticated'
    || kind === 'auth_denied'
}

function buildSessionExpiredError(cause: unknown) {
  return new AppError({
    message: 'Sua sessao expirou. Entre novamente para continuar.',
    code: 'session_expired',
    status: 401,
    details: null,
    raw: cause,
  })
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
    const kind = classifyAppError(error)
    if (kind === 'session_expired' || kind === 'not_authenticated' || kind === 'auth_denied') {
      await resetLocalAuthState()
      throw buildSessionExpiredError(error)
    }

    // Infra / rede / desconhecido — não mascarar como problema de auth.
    const normalized = normalizeAppError(error, 'Nao foi possivel validar a sua sessao.')
    throw await createAppError(error, normalized.message || 'Nao foi possivel validar a sua sessao.')
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
