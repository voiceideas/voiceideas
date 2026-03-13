-- =============================================
-- VoiceIdeas - Setup do Banco de Dados
-- Execute no Supabase SQL Editor (Dashboard)
-- =============================================

-- Tabela de notas de voz
CREATE TABLE IF NOT EXISTS public.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de ideias organizadas pela IA
CREATE TABLE IF NOT EXISTS public.organized_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_ids UUID[] NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('topicos', 'plano', 'roteiro', 'mapa')),
  title TEXT NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON public.notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON public.notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_organized_ideas_user_id ON public.organized_ideas(user_id);
CREATE INDEX IF NOT EXISTS idx_organized_ideas_created_at ON public.organized_ideas(created_at DESC);

-- Row Level Security (RLS)
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organized_ideas ENABLE ROW LEVEL SECURITY;

-- Policies: cada usuario so ve/edita seus proprios dados
CREATE POLICY "Users can view own notes"
  ON public.notes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notes"
  ON public.notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notes"
  ON public.notes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notes"
  ON public.notes FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own organized ideas"
  ON public.organized_ideas FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own organized ideas"
  ON public.organized_ideas FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own organized ideas"
  ON public.organized_ideas FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own organized ideas"
  ON public.organized_ideas FOR DELETE
  USING (auth.uid() = user_id);
