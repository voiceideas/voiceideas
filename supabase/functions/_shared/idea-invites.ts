import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export type ShareInviteRole = 'viewer'
export type ShareInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface InviteContext {
  kind: 'idea_invite' | 'legacy_share_invite'
  inviteId: string
  shareId: string
  ideaId: string
  ownerUserId: string
  recipientEmail: string
  recipientEmailMasked: string
  role: ShareInviteRole
  status: ShareInviteStatus
  invitedBy: string | null
  acceptedBy: string | null
  acceptedAt: string | null
  expiresAt: string
  ideaTitle: string
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function generateInviteToken() {
  return crypto.randomUUID() + crypto.randomUUID()
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2)
  return `${visible}***@${domain}`
}

export async function loadInviteContext(
  adminClient: SupabaseClient,
  tokenHash: string,
): Promise<InviteContext | null> {
  const { data: invite } = await adminClient
    .from('idea_invites')
    .select('id, share_id, idea_id, owner_user_id, recipient_email, role, status, invited_by, accepted_by, accepted_at, expires_at')
    .eq('invite_token_hash', tokenHash)
    .maybeSingle()

  if (invite) {
    const { data: idea, error: ideaError } = await adminClient
      .from('organized_ideas')
      .select('id, title')
      .eq('id', invite.idea_id)
      .maybeSingle()

    if (ideaError) {
      throw new Error(ideaError.message)
    }

    if (!idea) {
      throw new Error('A ideia compartilhada não existe mais.')
    }

    return {
      kind: 'idea_invite',
      inviteId: invite.id,
      shareId: invite.share_id,
      ideaId: invite.idea_id,
      ownerUserId: invite.owner_user_id,
      recipientEmail: invite.recipient_email,
      recipientEmailMasked: maskEmail(invite.recipient_email),
      role: invite.role,
      status: invite.status,
      invitedBy: invite.invited_by,
      acceptedBy: invite.accepted_by,
      acceptedAt: invite.accepted_at,
      expiresAt: invite.expires_at,
      ideaTitle: String(idea.title || 'Ideia compartilhada'),
    }
  }

  const { data: legacyInvite, error: legacyInviteError } = await adminClient
    .from('organized_idea_share_invites')
    .select('id, share_id, invited_email, role, status, invited_by, accepted_by, accepted_at, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (legacyInviteError) {
    throw new Error(legacyInviteError.message)
  }

  if (!legacyInvite) {
    return null
  }

  const { data: share, error: shareError } = await adminClient
    .from('organized_idea_shares')
    .select('id, source_idea_id, owner_user_id')
    .eq('id', legacyInvite.share_id)
    .maybeSingle()

  if (shareError) {
    throw new Error(shareError.message)
  }

  if (!share) {
    throw new Error('O compartilhamento desta ideia não existe mais.')
  }

  const { data: idea, error: ideaError } = await adminClient
    .from('organized_ideas')
    .select('id, title')
    .eq('id', share.source_idea_id)
    .maybeSingle()

  if (ideaError) {
    throw new Error(ideaError.message)
  }

  if (!idea) {
    throw new Error('A ideia compartilhada não existe mais.')
  }

  return {
    kind: 'legacy_share_invite',
    inviteId: legacyInvite.id,
    shareId: share.id,
    ideaId: share.source_idea_id,
    ownerUserId: share.owner_user_id,
    recipientEmail: legacyInvite.invited_email,
    recipientEmailMasked: maskEmail(legacyInvite.invited_email),
    role: legacyInvite.role,
    status: legacyInvite.status,
    invitedBy: legacyInvite.invited_by,
    acceptedBy: legacyInvite.accepted_by,
    acceptedAt: legacyInvite.accepted_at,
    expiresAt: legacyInvite.expires_at,
    ideaTitle: String(idea.title || 'Ideia compartilhada'),
  }
}

export async function markInviteExpired(adminClient: SupabaseClient, context: InviteContext) {
  if (context.kind === 'idea_invite') {
    await adminClient
      .from('idea_invites')
      .update({ status: 'expired' })
      .eq('id', context.inviteId)
    return
  }

  await adminClient
    .from('organized_idea_share_invites')
    .update({ status: 'expired' })
    .eq('id', context.inviteId)
}

export async function markInviteAccepted(adminClient: SupabaseClient, context: InviteContext, userId: string) {
  const payload = {
    status: 'accepted',
    accepted_by: userId,
    accepted_at: new Date().toISOString(),
  }

  if (context.kind === 'idea_invite') {
    await adminClient
      .from('idea_invites')
      .update(payload)
      .eq('id', context.inviteId)
    return
  }

  await adminClient
    .from('organized_idea_share_invites')
    .update(payload)
    .eq('id', context.inviteId)
}
