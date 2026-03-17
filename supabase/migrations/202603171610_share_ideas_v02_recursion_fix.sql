-- Corrige recursao entre as policies de organized_ideas e organized_idea_members

CREATE OR REPLACE FUNCTION public.is_organized_idea_owner(target_idea_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organized_ideas
    WHERE id = target_idea_id
      AND user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_organized_idea_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_organized_idea_owner(UUID) TO authenticated;
DROP POLICY IF EXISTS "Owners can manage organized idea invites" ON public.organized_idea_invites;
CREATE POLICY "Owners can manage organized idea invites"
  ON public.organized_idea_invites
  FOR ALL
  USING (public.is_organized_idea_owner(idea_id))
  WITH CHECK (public.is_organized_idea_owner(idea_id));
DROP POLICY IF EXISTS "Owners and members can view idea members" ON public.organized_idea_members;
CREATE POLICY "Owners and members can view idea members"
  ON public.organized_idea_members
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.is_organized_idea_owner(idea_id)
  );
