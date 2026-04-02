import { supabase } from '../lib/supabase'
import { AppError, createAppError } from '../lib/errors'

export async function requireAuthenticatedUserId() {
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error) {
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

  return user.id
}
