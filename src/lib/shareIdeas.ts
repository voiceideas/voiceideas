import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase'
import type { ShareRole, SharedOrganizedIdea } from '../types/database'

export interface ShareIdeaResult {
  inviteId: string
  shareId: string
  inviteUrl: string
  emailSent: boolean
  warning?: string | null
  ideaTitle?: string
}

export interface IdeaInvitePreview {
  ideaTitle: string
  recipientEmail: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  expiresAt: string
}

export interface AcceptedIdeaInvite {
  accepted: boolean
  ideaId: string
  ideaTitle: string
}

export interface ListSharedIdeasResult {
  ideas: SharedOrganizedIdea[]
}

function getFunctionUrl(name: string) {
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/${name}`
}

function getPublicAppBaseUrl() {
  if (typeof window === 'undefined') {
    return 'https://voiceideas.vercel.app'
  }

  const { origin } = window.location
  return /^https?:\/\//.test(origin) ? origin : 'https://voiceideas.vercel.app'
}

async function parseJsonResponse<T>(response: Response): Promise<T & { error?: string }> {
  try {
    return await response.json() as T & { error?: string }
  } catch {
    return { error: 'Resposta invalida do servidor.' } as T & { error?: string }
  }
}

function mapShareError(message: string) {
  if (message.includes('401')) {
    return 'Voce precisa entrar na sua conta novamente para compartilhar.'
  }

  if (message.includes('403')) {
    return 'Essa conta nao tem permissao para compartilhar essa ideia.'
  }

  return message || 'Nao foi possivel compartilhar a ideia.'
}

async function getFunctionAuthHeaders() {
  const initialSession = await supabase.auth.getSession()
  let session = initialSession.data.session

  if (session?.refresh_token) {
    const refreshResult = await supabase.auth.refreshSession({
      refresh_token: session.refresh_token,
    })

    if (refreshResult.data.session) {
      session = refreshResult.data.session
    }
  }

  const accessToken = session?.access_token

  if (!session?.user || !accessToken) {
    throw new Error('Sua sessao de login nao foi encontrada. Entre novamente e tente compartilhar de novo.')
  }

  return {
    'x-supabase-auth': accessToken,
  }
}

async function resolveFunctionError(error: unknown, fallback: string) {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response | undefined

    if (response) {
      try {
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const data = await response.clone().json() as { error?: string; message?: string }
          return mapShareError(data.error || data.message || `Falha HTTP ${response.status}.`)
        }

        const text = (await response.clone().text()).trim()
        if (text) {
          return mapShareError(text)
        }
      } catch {
        return mapShareError(`Falha HTTP ${response.status}.`)
      }

      return mapShareError(`Falha HTTP ${response.status}.`)
    }
  }

  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return 'Nao foi possivel falar com a funcao de compartilhamento agora.'
  }

  return error instanceof Error ? mapShareError(error.message) : fallback
}

export async function shareIdeaByEmail(ideaId: string, email: string, role: ShareRole = 'viewer') {
  const { data, error } = await supabase.functions.invoke<ShareIdeaResult>('share-idea', {
    headers: await getFunctionAuthHeaders(),
    body: {
      ideaId,
      email,
      role,
      appBaseUrl: getPublicAppBaseUrl(),
    },
  })

  if (error) {
    throw new Error(await resolveFunctionError(error, 'Nao foi possivel compartilhar a ideia.'))
  }

  if (!data) {
    throw new Error('A funcao de compartilhamento nao retornou dados.')
  }

  return data
}

export async function getIdeaInvitePreview(token: string) {
  const response = await fetch(`${getFunctionUrl('accept-idea-invite')}?token=${encodeURIComponent(token)}`, {
    method: 'GET',
    headers: {
      apikey: supabaseAnonKey,
    },
  })

  const data = await parseJsonResponse<IdeaInvitePreview>(response)
  if (!response.ok) {
    throw new Error(data.error || `Falha HTTP ${response.status}.`)
  }

  return data
}

export async function acceptIdeaInvite(token: string) {
  const { data, error } = await supabase.functions.invoke<AcceptedIdeaInvite>('accept-idea-invite', {
    headers: await getFunctionAuthHeaders(),
    body: { token },
  })

  if (error) {
    throw new Error(await resolveFunctionError(error, 'Nao foi possivel aceitar o convite.'))
  }

  if (!data) {
    throw new Error('A funcao de aceite nao retornou dados.')
  }

  return data
}

export async function listSharedIdeas() {
  const { data, error } = await supabase.functions.invoke<ListSharedIdeasResult>('list-shared-ideas', {
    method: 'GET',
    headers: await getFunctionAuthHeaders(),
  })

  if (error) {
    throw new Error(await resolveFunctionError(error, 'Nao foi possivel carregar as ideias compartilhadas.'))
  }

  return data?.ideas || []
}
