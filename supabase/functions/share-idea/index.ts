import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { assertBusinessRateLimit, logSecurityEvent } from '../_shared/quotas.ts'
import { corsHeaders } from '../_shared/http.ts'
import { generateInviteToken, sha256Hex } from '../_shared/idea-invites.ts'
import { getClientIp, json, normalizeEmail, requireUser } from '../_shared/security.ts'

const configuredPublicAppUrl = Deno.env.get('VOICEIDEAS_PUBLIC_APP_URL')
  || Deno.env.get('PUBLIC_APP_URL')
  || Deno.env.get('SITE_URL')
  || ''

interface ShareIdeaBody {
  ideaId: string
  email: string
  role?: 'viewer'
  appBaseUrl?: string
}

function withCors(response: Response) {
  const headers = new Headers(response.headers)
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isAllowedInviteHost(hostname: string) {
  return (
    hostname === 'voiceideas.vercel.app' ||
    hostname.endsWith('-voiceideas-projects.vercel.app') ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1'
  )
}

function normalizeBaseUrl(url: string | null | undefined) {
  const trimmed = url?.trim()
  if (!trimmed || !/^https?:\/\//.test(trimmed)) {
    return null
  }

  try {
    const parsedUrl = new URL(trimmed)
    return `${parsedUrl.protocol}//${parsedUrl.host}`.replace(/\/$/, '')
  } catch {
    return null
  }
}

function buildInviteBaseUrl(appBaseUrl?: string) {
  const configuredBaseUrl = normalizeBaseUrl(configuredPublicAppUrl)
  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  if (appBaseUrl && /^https?:\/\//.test(appBaseUrl)) {
    try {
      const parsedUrl = new URL(appBaseUrl)
      if (isAllowedInviteHost(parsedUrl.hostname)) {
        return `${parsedUrl.protocol}//${parsedUrl.host}`.replace(/\/$/, '')
      }
    } catch {
      // Fall back to the canonical web app URL below.
    }
  }

  return 'https://voiceideas.vercel.app'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return withCors(json({ error: 'Method not allowed' }, 405))
    }

    const { user, adminClient } = await requireUser(req)
    const ip = getClientIp(req)

    await assertBusinessRateLimit(adminClient, user.id, 'share_idea_attempt', 5)

    const body = await req.json() as ShareIdeaBody
    const ideaId = body.ideaId?.trim()
    const role = body.role === 'viewer' ? body.role : 'viewer'
    const invitedEmail = normalizeEmail(body.email || '')

    if (!ideaId) {
      return withCors(json({ error: 'A ideia a ser compartilhada não foi informada.' }, 400))
    }

    if (!isValidEmail(invitedEmail)) {
      return withCors(json({ error: 'Digite um email válido para enviar o convite.' }, 400))
    }

    if (!user.email) {
      return withCors(json({ error: 'Seu usuário precisa ter um email válido para compartilhar.' }, 400))
    }

    if (normalizeEmail(user.email) === invitedEmail) {
      return withCors(json({ error: 'Não faz sentido compartilhar a ideia com o mesmo email do dono.' }, 400))
    }

    const { data: idea, error: ideaError } = await adminClient
      .from('organized_ideas')
      .select('id, user_id, title')
      .eq('id', ideaId)
      .single()

    if (ideaError || !idea) {
      return withCors(json({ error: 'A ideia informada não foi encontrada.' }, 404))
    }

    if (idea.user_id !== user.id) {
      return withCors(json({ error: 'Somente o dono da ideia pode compartilhar.' }, 403))
    }

    const { count, error: recentError } = await adminClient
      .from('idea_invites')
      .select('*', { head: true, count: 'exact' })
      .eq('owner_user_id', user.id)
      .eq('recipient_email', invitedEmail)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

    if (recentError) {
      return withCors(json({ error: 'Não foi possível verificar convites recentes.' }, 500))
    }

    if ((count ?? 0) >= 2) {
      return withCors(json({ error: 'Muitos convites recentes já foram enviados para este email.' }, 429))
    }

    const { data: share, error: shareError } = await adminClient
      .from('organized_idea_shares')
      .upsert({
        source_idea_id: ideaId,
        owner_user_id: user.id,
      }, {
        onConflict: 'source_idea_id,owner_user_id',
      })
      .select('id')
      .single()

    if (shareError || !share) {
      throw new Error(shareError?.message || 'Não foi possível preparar o compartilhamento')
    }

    await adminClient
      .from('idea_invites')
      .update({ status: 'revoked' })
      .eq('idea_id', ideaId)
      .eq('recipient_email', invitedEmail)
      .eq('status', 'pending')

    const token = generateInviteToken()
    const tokenHash = await sha256Hex(token)
    const inviteUrl = `${buildInviteBaseUrl(body.appBaseUrl)}/accept-invite?token=${encodeURIComponent(token)}`
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: invite, error: inviteError } = await adminClient
      .from('idea_invites')
      .insert({
        share_id: share.id,
        idea_id: ideaId,
        owner_user_id: user.id,
        recipient_email: invitedEmail,
        invite_token_hash: tokenHash,
        role,
        invited_by: user.id,
        expires_at: expiresAt,
      })
      .select('id')
      .single()

    if (inviteError || !invite) {
      throw new Error(inviteError?.message || 'Não foi possível registrar o convite')
    }

    await logSecurityEvent(adminClient, {
      user_id: user.id,
      event_type: 'share_idea_attempt',
      target: invitedEmail,
      ip,
      metadata: { ideaId: idea.id, shareId: share.id },
    })

    return withCors(json({
      inviteId: invite.id,
      shareId: share.id,
      inviteUrl,
      emailSent: false,
      warning: 'O convite foi criado. Compartilhe o link manualmente por enquanto.',
      ideaTitle: idea.title,
    }))
  } catch (error) {
    if (error instanceof Response) {
      return withCors(error)
    }

    console.error(error)
    return withCors(json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500))
  }
})
