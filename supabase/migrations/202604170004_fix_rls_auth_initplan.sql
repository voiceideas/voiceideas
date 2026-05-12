-- Fix WARN: auth_rls_initplan
--   Substitui bare auth.uid() por (SELECT auth.uid()) em todas as policies
--   afetadas. O subselect permite ao Postgres materializar o valor uma vez
--   por statement (init plan) em vez de reavaliar por linha.
--
-- Fix WARN: multiple_permissive_policies
--   Consolida policies SELECT duplicadas em notes, organized_ideas e
--   user_profiles. Policies admin e user são fundidas numa única USING.
--
-- Tabelas corrigidas:
--   notes, organized_ideas, user_profiles, capture_sessions, audio_chunks,
--   idea_drafts, bridge_items, folders, user_settings, idea_invites,
--   organized_idea_shares, organized_idea_share_members,
--   ai_usage_ledger, ai_usage_limits

-- ─── notes ──────────────────────────────────────────────────────────────────
-- DROP inclui policies órfãs criadas fora das migrations locais
DROP POLICY IF EXISTS "Users can view own notes"    ON public.notes;
DROP POLICY IF EXISTS "Users can read own notes"    ON public.notes;
DROP POLICY IF EXISTS "Admins can view all notes"   ON public.notes;
DROP POLICY IF EXISTS "Users can insert own notes"  ON public.notes;
DROP POLICY IF EXISTS "Users can update own notes"  ON public.notes;
DROP POLICY IF EXISTS "Users can delete own notes"  ON public.notes;

-- Policy única SELECT: usuário vê as próprias + admin vê todas
CREATE POLICY "Users can view own notes"
  ON public.notes FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY "Users can insert own notes"
  ON public.notes FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update own notes"
  ON public.notes FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete own notes"
  ON public.notes FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- ─── organized_ideas ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own organized ideas"              ON public.organized_ideas;
DROP POLICY IF EXISTS "Users can view owned or shared organized ideas"  ON public.organized_ideas;
DROP POLICY IF EXISTS "Users can read own organized"                    ON public.organized_ideas;
DROP POLICY IF EXISTS "Users can insert own organized ideas"            ON public.organized_ideas;
DROP POLICY IF EXISTS "Users can insert own organized"                  ON public.organized_ideas;
DROP POLICY IF EXISTS "Users can update own organized ideas"            ON public.organized_ideas;
DROP POLICY IF EXISTS "Users can delete own organized ideas"            ON public.organized_ideas;
DROP POLICY IF EXISTS "Users can delete own organized"                  ON public.organized_ideas;

CREATE POLICY "Users can view own organized ideas"
  ON public.organized_ideas FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert own organized ideas"
  ON public.organized_ideas FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update own organized ideas"
  ON public.organized_ideas FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete own organized ideas"
  ON public.organized_ideas FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- ─── user_profiles ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own profile"   ON public.user_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.user_profiles;

-- Policy única SELECT: usuário vê o próprio + admin vê todos
CREATE POLICY "Users can view own profile"
  ON public.user_profiles FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

-- ─── capture_sessions ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own capture sessions" ON public.capture_sessions;

CREATE POLICY "Users manage own capture sessions"
  ON public.capture_sessions FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ─── audio_chunks ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own audio chunks" ON public.audio_chunks;

CREATE POLICY "Users manage own audio chunks"
  ON public.audio_chunks FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ─── idea_drafts ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own idea drafts" ON public.idea_drafts;

CREATE POLICY "Users manage own idea drafts"
  ON public.idea_drafts FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ─── bridge_items ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own bridge items" ON public.bridge_items;

CREATE POLICY "Users manage own bridge items"
  ON public.bridge_items FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ─── folders ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own folders" ON public.folders;

CREATE POLICY "Users manage own folders"
  ON public.folders FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ─── user_settings ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own settings"   ON public.user_settings;
DROP POLICY IF EXISTS "Users can insert own settings" ON public.user_settings;
DROP POLICY IF EXISTS "Users can update own settings" ON public.user_settings;

CREATE POLICY "Users can view own settings"
  ON public.user_settings FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert own settings"
  ON public.user_settings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update own settings"
  ON public.user_settings FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ─── idea_invites ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "owners can manage idea invites" ON public.idea_invites;

CREATE POLICY "owners can manage idea invites"
  ON public.idea_invites FOR ALL
  TO authenticated
  USING (owner_user_id = (SELECT auth.uid()))
  WITH CHECK (owner_user_id = (SELECT auth.uid()));

-- ─── organized_idea_shares ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Owners can view own idea shares"   ON public.organized_idea_shares;
DROP POLICY IF EXISTS "Owners can create own idea shares" ON public.organized_idea_shares;
DROP POLICY IF EXISTS "Owners can update own idea shares" ON public.organized_idea_shares;
DROP POLICY IF EXISTS "Owners can delete own idea shares" ON public.organized_idea_shares;

CREATE POLICY "Owners can view own idea shares"
  ON public.organized_idea_shares FOR SELECT
  USING (owner_user_id = (SELECT auth.uid()));

CREATE POLICY "Owners can create own idea shares"
  ON public.organized_idea_shares FOR INSERT
  WITH CHECK (owner_user_id = (SELECT auth.uid()));

CREATE POLICY "Owners can update own idea shares"
  ON public.organized_idea_shares FOR UPDATE
  USING (owner_user_id = (SELECT auth.uid()));

CREATE POLICY "Owners can delete own idea shares"
  ON public.organized_idea_shares FOR DELETE
  USING (owner_user_id = (SELECT auth.uid()));

-- ─── organized_idea_share_members ───────────────────────────────────────────
DROP POLICY IF EXISTS "Owners and recipients can view share members" ON public.organized_idea_share_members;

CREATE POLICY "Owners and recipients can view share members"
  ON public.organized_idea_share_members FOR SELECT
  USING ((SELECT auth.uid()) = user_id OR public.is_idea_share_owner(share_id));

-- ─── ai_usage_ledger ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "users can read own ai ledger" ON public.ai_usage_ledger;

CREATE POLICY "users can read own ai ledger"
  ON public.ai_usage_ledger FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ─── ai_usage_limits ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "users can read own ai limits" ON public.ai_usage_limits;

CREATE POLICY "users can read own ai limits"
  ON public.ai_usage_limits FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));
