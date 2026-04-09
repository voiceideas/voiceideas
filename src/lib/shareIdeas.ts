import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { getAuthenticatedFunctionHeaders } from './functionAuth'
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
  recipientEmailMasked: string
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

function normalizeBaseUrl(url: string | null | undefined) {
  const trimmed = url?.trim()
  if (!trimmed || !/^https?:\/\//.test(trimmed)) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, '')
  } catch {
    return null
  }
}

function getConfiguredPublicAppBaseUrl() {
  return normalizeBaseUrl(import.meta.env.VITE_PUBLIC_APP_URL)
}

function getPublicAppBaseUrl() {
  const configuredBaseUrl = getConfiguredPublicAppBaseUrl()

  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  if (typeof window === 'undefined') {
    return 'https://voiceideas.vercel.app'
  }

  const { origin, hostname } = window.location
  const isAllowedHost = hostname === 'voiceideas.vercel.app'
    || hostname.endsWith('-voiceideas-projects.vercel.app')
    || hostname === 'localhost'
    || hostname === '127.0.0.1'

  return /^https?:\/\//.test(origin) && isAllowedHost
    ? origin
    : 'https://voiceideas.vercel.app'
}

export function buildInvitePageUrl(token: string, baseUrl = getPublicAppBaseUrl()) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || getPublicAppBaseUrl()
  return `${normalizedBaseUrl}/accept-invite?token=${encodeURIComponent(token)}`
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

  if (message.includes('429')) {
    return 'Muitas tentativas de compartilhamento agora. Espere um pouco antes de tentar de novo.'
  }

  return message || 'Nao foi possivel compartilhar a ideia.'
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
    headers: await getAuthenticatedFunctionHeaders(),
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
  const response = await fetch(`${getFunctionUrl('preview-idea-invite')}?token=${encodeURIComponent(token)}`, {
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
    headers: await getAuthenticatedFunctionHeaders(),
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
    headers: await getAuthenticatedFunctionHeaders(),
  })

  if (error) {
    throw new Error(await resolveFunctionError(error, 'Nao foi possivel carregar as ideias compartilhadas.'))
  }

  return data?.ideas || []
}
