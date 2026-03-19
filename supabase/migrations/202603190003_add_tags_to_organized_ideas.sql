ALTER TABLE public.organized_ideas
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_organized_ideas_tags
  ON public.organized_ideas
  USING GIN(tags);
