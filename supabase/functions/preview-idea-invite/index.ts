import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-auth',
}

interface ShareInviteRecord {
  id: string
  share_id: string
  invited_email: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  expires_at: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function loadInvitePreview(serviceClient: ReturnType<typeof createClient>, tokenHash: string) {
  const { data: invite, error: inviteError } = await serviceClient
    .from('organized_idea_share_invites')
    .select('id, share_id, invited_email, status, expires_at')
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
    .select('id, source_idea_id')
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
    ideaTitle: String(idea.title || 'Ideia compartilhada'),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Supabase environment is not configured for invite previews')
    }

    const url = new URL(req.url)
    const token = url.searchParams.get('token')?.trim() || ''

    if (!token) {
      return jsonResponse({ error: 'O token do convite nao foi informado.' }, 400)
    }

    const tokenHash = await sha256(token)
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
    const preview = await loadInvitePreview(serviceClient, tokenHash)

    if (!preview) {
      return jsonResponse({ error: 'Esse convite nao existe ou ja foi removido.' }, 404)
    }

    const { invite, ideaTitle } = preview
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

    return jsonResponse({
      ideaTitle,
      recipientEmail: invite.invited_email,
      expiresAt: invite.expires_at,
    })
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500)
  }
})
