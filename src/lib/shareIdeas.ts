import { supabase, supabaseAnonKey, supabaseUrl } from './supabase'
import type { ShareRole } from '../types/database'

export interface ShareIdeaResult {
  inviteId: string
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

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  return {
    Authorization: `Bearer ${token || supabaseAnonKey}`,
    apikey: supabaseAnonKey,
  }
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

export async function shareIdeaByEmail(ideaId: string, email: string, role: ShareRole = 'viewer') {
  const response = await fetch(getFunctionUrl('share-idea'), {
    method: 'POST',
    headers: {
      ...(await getAuthHeaders()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ideaId,
      email,
      role,
      appBaseUrl: getPublicAppBaseUrl(),
    }),
  })

  const data = await parseJsonResponse<ShareIdeaResult>(response)
  if (!response.ok) {
    throw new Error(mapShareError(data.error || `Falha HTTP ${response.status}.`))
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
  const response = await fetch(getFunctionUrl('accept-idea-invite'), {
    method: 'POST',
    headers: {
      ...(await getAuthHeaders()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  })

  const data = await parseJsonResponse<AcceptedIdeaInvite>(response)
  if (!response.ok) {
    throw new Error(data.error || `Falha HTTP ${response.status}.`)
  }

  return data
}
