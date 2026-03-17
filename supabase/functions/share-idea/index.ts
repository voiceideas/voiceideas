import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-auth',
}

interface ShareIdeaBody {
  ideaId: string
  email: string
  role?: 'viewer'
  appBaseUrl?: string
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

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function buildInviteBaseUrl(appBaseUrl?: string) {
  if (appBaseUrl && /^https?:\/\//.test(appBaseUrl)) {
    return appBaseUrl.replace(/\/$/, '')
  }

  return 'https://voiceideas.vercel.app'
}

function generateInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      throw new Error('Supabase environment is not configured for sharing')
    }

    const authHeader = req.headers.get('x-supabase-auth')
      || req.headers.get('Authorization')
      || ''

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
    const publicClient = createClient(supabaseUrl, supabaseAnonKey)

    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return jsonResponse({ error: 'Voce precisa estar autenticado para compartilhar.' }, 401)
    }

    const body = await req.json() as ShareIdeaBody
    const ideaId = body.ideaId?.trim()
    const role = body.role === 'viewer' ? body.role : 'viewer'
    const invitedEmail = normalizeEmail(body.email || '')

    if (!ideaId) {
      return jsonResponse({ error: 'A ideia a ser compartilhada nao foi informada.' }, 400)
    }

    if (!isValidEmail(invitedEmail)) {
      return jsonResponse({ error: 'Digite um email valido para enviar o convite.' }, 400)
    }

    if (!user.email) {
      return jsonResponse({ error: 'Seu usuario precisa ter um email valido para compartilhar.' }, 400)
    }

    if (normalizeEmail(user.email) === invitedEmail) {
      return jsonResponse({ error: 'Nao faz sentido compartilhar a ideia com o mesmo email do dono.' }, 400)
    }

    const { data: idea, error: ideaError } = await serviceClient
      .from('organized_ideas')
      .select('id, user_id, title')
      .eq('id', ideaId)
      .single()

    if (ideaError || !idea) {
      return jsonResponse({ error: 'A ideia informada nao foi encontrada.' }, 404)
    }

    if (idea.user_id !== user.id) {
      return jsonResponse({ error: 'Somente o dono da ideia pode compartilhar.' }, 403)
    }

    const { data: share, error: shareError } = await serviceClient
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
      throw new Error(shareError?.message || 'Nao foi possivel preparar o compartilhamento')
    }

    await serviceClient
      .from('organized_idea_share_invites')
      .update({ status: 'revoked' })
      .eq('share_id', share.id)
      .eq('invited_email', invitedEmail)
      .eq('status', 'pending')

    const token = generateInviteToken()
    const tokenHash = await sha256(token)
    const inviteUrl = `${buildInviteBaseUrl(body.appBaseUrl)}/accept-invite?token=${encodeURIComponent(token)}`

    const { data: invite, error: inviteError } = await serviceClient
      .from('organized_idea_share_invites')
      .insert({
        share_id: share.id,
        invited_email: invitedEmail,
        role,
        token_hash: tokenHash,
        invited_by: user.id,
      })
      .select('id')
      .single()

    if (inviteError || !invite) {
      throw new Error(inviteError?.message || 'Nao foi possivel registrar o convite')
    }

    let emailSent = true
    let warning: string | null = null

    const { error: otpError } = await publicClient.auth.signInWithOtp({
      email: invitedEmail,
      options: {
        emailRedirectTo: inviteUrl,
        shouldCreateUser: true,
      },
    })

    if (otpError) {
      emailSent = false
      warning = 'O convite foi criado, mas o envio automatico falhou. Compartilhe o link manualmente.'
    }

    return jsonResponse({
      inviteId: invite.id,
      shareId: share.id,
      inviteUrl,
      emailSent,
      warning,
      ideaTitle: idea.title,
    })
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500)
  }
})
