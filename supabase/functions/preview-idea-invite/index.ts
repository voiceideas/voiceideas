import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/http.ts'
import { loadInviteContext, markInviteExpired, sha256Hex } from '../_shared/idea-invites.ts'
import { json } from '../_shared/security.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

function withCors(response: Response) {
  const headers = new Headers(response.headers)
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'GET') {
      return withCors(json({ error: 'Method not allowed' }, 405))
    }

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Supabase environment is not configured for invite previews')
    }

    const url = new URL(req.url)
    const token = url.searchParams.get('token')?.trim() || ''

    if (!token) {
      return withCors(json({ error: 'O token do convite não foi informado.' }, 400))
    }

    const tokenHash = await sha256Hex(token)
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)
    const preview = await loadInviteContext(serviceClient, tokenHash)

    if (!preview) {
      return withCors(json({ error: 'Esse convite não existe ou já foi removido.' }, 404))
    }

    const isExpired = new Date(preview.expiresAt).getTime() < Date.now()

    if (isExpired && preview.status === 'pending') {
      await markInviteExpired(serviceClient, preview)
    }

    if (preview.status === 'revoked') {
      return withCors(json({ error: 'Esse convite foi revogado pelo dono da ideia.' }, 410))
    }

    if (preview.status === 'expired' || isExpired) {
      return withCors(json({ error: 'Esse convite expirou. Peça um novo link ao dono da ideia.' }, 410))
    }

    return withCors(json({
      ideaTitle: preview.ideaTitle,
      recipientEmailMasked: preview.recipientEmailMasked,
      expiresAt: preview.expiresAt,
    }))
  } catch (error) {
    return withCors(json({ error: (error as Error).message }, 500))
  }
})
