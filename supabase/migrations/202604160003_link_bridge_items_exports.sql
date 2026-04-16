ALTER TABLE public.bridge_exports
  ADD COLUMN IF NOT EXISTS bridge_item_id UUID REFERENCES public.bridge_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bridge_exports_bridge_item_created_at
  ON public.bridge_exports(bridge_item_id, created_at DESC)
  WHERE bridge_item_id IS NOT NULL;
