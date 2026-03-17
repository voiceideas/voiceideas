-- Refatora o compartilhamento para links dedicados, sem expor organized_ideas via RLS cruzado

DROP POLICY IF EXISTS "Users can view owned or shared organized ideas" ON public.organized_ideas;
DROP POLICY IF EXISTS "Users can view own organized ideas" ON public.organized_ideas;
CREATE POLICY "Users can view own organized ideas"
  ON public.organized_ideas FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owners can manage organized idea invites" ON public.organized_idea_invites;
DROP POLICY IF EXISTS "Owners and members can view idea members" ON public.organized_idea_members;

CREATE TABLE IF NOT EXISTS public.organized_idea_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_idea_id UUID NOT NULL REFERENCES public.organized_ideas(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_idea_id, owner_user_id)
);

CREATE TABLE IF NOT EXISTS public.organized_idea_share_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES public.organized_idea_shares(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organized_idea_share_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES public.organized_idea_shares(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_id UUID REFERENCES public.organized_idea_share_invites(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (share_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organized_idea_shares_source_idea_id ON public.organized_idea_shares(source_idea_id);
CREATE INDEX IF NOT EXISTS idx_organized_idea_shares_owner_user_id ON public.organized_idea_shares(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_organized_idea_share_invites_share_id ON public.organized_idea_share_invites(share_id);
CREATE INDEX IF NOT EXISTS idx_organized_idea_share_invites_invited_email ON public.organized_idea_share_invites(LOWER(invited_email));
CREATE INDEX IF NOT EXISTS idx_organized_idea_share_members_share_id ON public.organized_idea_share_members(share_id);
CREATE INDEX IF NOT EXISTS idx_organized_idea_share_members_user_id ON public.organized_idea_share_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organized_idea_share_invites_pending_per_email
  ON public.organized_idea_share_invites(share_id, LOWER(invited_email))
  WHERE status = 'pending';

ALTER TABLE public.organized_idea_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organized_idea_share_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organized_idea_share_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_idea_share_owner(target_share_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organized_idea_shares
    WHERE id = target_share_id
      AND owner_user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_idea_share_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_idea_share_owner(UUID) TO authenticated;

DROP POLICY IF EXISTS "Owners can view own idea shares" ON public.organized_idea_shares;
DROP POLICY IF EXISTS "Owners can create own idea shares" ON public.organized_idea_shares;
DROP POLICY IF EXISTS "Owners can update own idea shares" ON public.organized_idea_shares;
DROP POLICY IF EXISTS "Owners can delete own idea shares" ON public.organized_idea_shares;
CREATE POLICY "Owners can view own idea shares"
  ON public.organized_idea_shares FOR SELECT
  USING (auth.uid() = owner_user_id);
CREATE POLICY "Owners can create own idea shares"
  ON public.organized_idea_shares FOR INSERT
  WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owners can update own idea shares"
  ON public.organized_idea_shares FOR UPDATE
  USING (auth.uid() = owner_user_id);
CREATE POLICY "Owners can delete own idea shares"
  ON public.organized_idea_shares FOR DELETE
  USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Owners can manage share invites" ON public.organized_idea_share_invites;
CREATE POLICY "Owners can manage share invites"
  ON public.organized_idea_share_invites
  FOR ALL
  USING (public.is_idea_share_owner(share_id))
  WITH CHECK (public.is_idea_share_owner(share_id));

DROP POLICY IF EXISTS "Owners and recipients can view share members" ON public.organized_idea_share_members;
CREATE POLICY "Owners and recipients can view share members"
  ON public.organized_idea_share_members
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.is_idea_share_owner(share_id)
  );
