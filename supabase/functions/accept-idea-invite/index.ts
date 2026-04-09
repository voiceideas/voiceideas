import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { corsHeaders } from '../_shared/http.ts'
import { loadInviteContext, markInviteAccepted, markInviteExpired, sha256Hex } from '../_shared/idea-invites.ts'
import { json, normalizeEmail, requireUser } from '../_shared/security.ts'

interface AcceptInviteBody {
  token: string
}

function readToken(body?: AcceptInviteBody) {
  return body?.token?.trim() || ''
}

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
    if (req.method !== 'POST') {
      return withCors(json({ error: 'Method not allowed' }, 405))
    }

    const { user, adminClient } = await requireUser(req)
    const body = await req.json() as AcceptInviteBody
    const token = readToken(body)

    if (!token) {
      return withCors(json({ error: 'O token do convite não foi informado.' }, 400))
    }

    const tokenHash = await sha256Hex(token)
    const context = await loadInviteContext(adminClient, tokenHash)

    if (!context) {
      return withCors(json({ error: 'Esse convite não existe ou já foi removido.' }, 404))
    }

    const isExpired = new Date(context.expiresAt).getTime() < Date.now()

    if (isExpired && context.status === 'pending') {
      await markInviteExpired(adminClient, context)
    }

    if (context.status === 'revoked') {
      return withCors(json({ error: 'Esse convite foi revogado pelo dono da ideia.' }, 410))
    }

    if (context.status === 'expired' || isExpired) {
      return withCors(json({ error: 'Esse convite expirou. Peça um novo link ao dono da ideia.' }, 410))
    }

    if (!user.email || normalizeEmail(user.email) !== normalizeEmail(context.recipientEmail)) {
      return withCors(json({
        error: 'Esse convite foi enviado para outro email. Entre com o mesmo email do convite para aceitar.',
        recipientEmailMasked: context.recipientEmailMasked,
      }, 403))
    }

    const { error: memberError } = await adminClient
      .from('organized_idea_share_members')
      .upsert({
        share_id: context.shareId,
        user_id: user.id,
        role: context.role,
        invited_by: context.invitedBy ?? context.ownerUserId,
        invite_id: context.kind === 'legacy_share_invite' ? context.inviteId : null,
      }, {
        onConflict: 'share_id,user_id',
      })

    if (memberError) {
      throw new Error(memberError.message)
    }

    await markInviteAccepted(adminClient, context, user.id)

    return withCors(json({
      accepted: true,
      ideaId: context.ideaId,
      ideaTitle: context.ideaTitle,
    }))
  } catch (error) {
    if (error instanceof Response) {
      return withCors(error)
    }

    return withCors(json({ error: (error as Error).message }, 500))
  }
})
