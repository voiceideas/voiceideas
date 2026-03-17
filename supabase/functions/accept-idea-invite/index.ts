import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-auth',
}

interface AcceptInviteBody {
  token: string
}

interface ShareInviteRecord {
  id: string
  share_id: string
  invited_email: string
  role: 'viewer'
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invited_by: string
  expires_at: string
}

interface ShareRecord {
  id: string
  source_idea_id: string
  owner_user_id: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readToken(req: Request, body?: AcceptInviteBody) {
  if (req.method === 'GET') {
    const url = new URL(req.url)
    return url.searchParams.get('token')?.trim() || ''
  }

  return body?.token?.trim() || ''
}

async function loadInviteContext(serviceClient: ReturnType<typeof createClient>, tokenHash: string) {
  const { data: invite, error: inviteError } = await serviceClient
    .from('organized_idea_share_invites')
    .select('id, share_id, invited_email, role, status, invited_by, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (inviteError) {
    throw new Error(inviteError.message)
  }

  if (!invite) {
    return null
  }

  const { data: share, error: shareError } = await serviceClient
    .from('organized_idea_shares')
    .select('id, source_idea_id, owner_user_id')
    .eq('id', invite.share_id)
    .maybeSingle()

  if (shareError) {
    throw new Error(shareError.message)
  }

  if (!share) {
    throw new Error('O compartilhamento desta ideia nao existe mais.')
  }

  const { data: idea, error: ideaError } = await serviceClient
    .from('organized_ideas')
    .select('id, title')
    .eq('id', share.source_idea_id)
    .maybeSingle()

  if (ideaError) {
    throw new Error(ideaError.message)
  }

  if (!idea) {
    throw new Error('A ideia compartilhada nao existe mais.')
  }

  return {
    invite: invite as ShareInviteRecord,
    share: share as ShareRecord,
    ideaTitle: String(idea.title || 'Ideia compartilhada'),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      throw new Error('Supabase environment is not configured for invites')
    }

    const body = req.method === 'POST'
      ? await req.json() as AcceptInviteBody
      : undefined
    const token = readToken(req, body)

    if (!token) {
      return jsonResponse({ error: 'O token do convite nao foi informado.' }, 400)
    }

    const tokenHash = await sha256(token)
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
    const context = await loadInviteContext(serviceClient, tokenHash)

    if (!context) {
      return jsonResponse({ error: 'Esse convite nao existe ou ja foi removido.' }, 404)
    }

    const { invite, share, ideaTitle } = context
    const isExpired = new Date(invite.expires_at).getTime() < Date.now()

    if (isExpired && invite.status === 'pending') {
      await serviceClient
        .from('organized_idea_share_invites')
        .update({ status: 'expired' })
        .eq('id', invite.id)
    }

    if (invite.status === 'revoked') {
      return jsonResponse({ error: 'Esse convite foi revogado pelo dono da ideia.' }, 410)
    }

    if (invite.status === 'expired' || isExpired) {
      return jsonResponse({ error: 'Esse convite expirou. Peca um novo link ao dono da ideia.' }, 410)
    }

    if (req.method === 'GET') {
      return jsonResponse({
        ideaTitle,
        recipientEmail: invite.invited_email,
        status: invite.status,
        expiresAt: invite.expires_at,
      })
    }

    const authHeader = req.headers.get('x-supabase-auth')
      || req.headers.get('Authorization')
      || ''
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return jsonResponse({ error: 'Voce precisa entrar na sua conta para aceitar o convite.' }, 401)
    }

    if (!user.email || normalizeEmail(user.email) !== normalizeEmail(invite.invited_email)) {
      return jsonResponse({
        error: `Esse convite foi enviado para ${invite.invited_email}. Entre com esse mesmo email para aceitar.`,
      }, 403)
    }

    const { error: memberError } = await serviceClient
      .from('organized_idea_share_members')
      .upsert({
        share_id: share.id,
        user_id: user.id,
        role: invite.role,
        invited_by: invite.invited_by,
        invite_id: invite.id,
      }, {
        onConflict: 'share_id,user_id',
      })

    if (memberError) {
      throw new Error(memberError.message)
    }

    await serviceClient
      .from('organized_idea_share_invites')
      .update({
        status: 'accepted',
        accepted_by: user.id,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invite.id)

    return jsonResponse({
      accepted: true,
      ideaId: share.source_idea_id,
      ideaTitle,
    })
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500)
  }
})
