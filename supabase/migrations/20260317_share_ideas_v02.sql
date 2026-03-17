-- VoiceIdeas v0.2 - compartilhamento de ideias organizadas

CREATE TABLE IF NOT EXISTS public.organized_idea_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES public.organized_ideas(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS public.organized_idea_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES public.organized_ideas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_id UUID REFERENCES public.organized_idea_invites(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (idea_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organized_idea_invites_idea_id ON public.organized_idea_invites(idea_id);
CREATE INDEX IF NOT EXISTS idx_organized_idea_invites_invited_email ON public.organized_idea_invites(LOWER(invited_email));
CREATE INDEX IF NOT EXISTS idx_organized_idea_members_idea_id ON public.organized_idea_members(idea_id);
CREATE INDEX IF NOT EXISTS idx_organized_idea_members_user_id ON public.organized_idea_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organized_idea_invites_pending_per_email
  ON public.organized_idea_invites(idea_id, LOWER(invited_email))
  WHERE status = 'pending';

ALTER TABLE public.organized_idea_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organized_idea_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own organized ideas" ON public.organized_ideas;
DROP POLICY IF EXISTS "Users can view owned or shared organized ideas" ON public.organized_ideas;
CREATE POLICY "Users can view owned or shared organized ideas"
  ON public.organized_ideas FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.organized_idea_members AS member
      WHERE member.idea_id = public.organized_ideas.id
        AND member.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can manage organized idea invites" ON public.organized_idea_invites;
CREATE POLICY "Owners can manage organized idea invites"
  ON public.organized_idea_invites
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.organized_ideas AS idea
      WHERE idea.id = public.organized_idea_invites.idea_id
        AND idea.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organized_ideas AS idea
      WHERE idea.id = public.organized_idea_invites.idea_id
        AND idea.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners and members can view idea members" ON public.organized_idea_members;
CREATE POLICY "Owners and members can view idea members"
  ON public.organized_idea_members
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.organized_ideas AS idea
      WHERE idea.id = public.organized_idea_members.idea_id
        AND idea.user_id = auth.uid()
    )
  );
