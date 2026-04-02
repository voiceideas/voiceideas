ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS source_capture_session_id UUID REFERENCES public.capture_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_audio_chunk_id UUID REFERENCES public.audio_chunks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notes_source_capture_session_id
  ON public.notes(source_capture_session_id)
  WHERE source_capture_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_source_audio_chunk_id_unique
  ON public.notes(source_audio_chunk_id)
  WHERE source_audio_chunk_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_note_from_capture_source(
  p_raw_text TEXT,
  p_title TEXT DEFAULT NULL,
  p_source_capture_session_id UUID DEFAULT NULL,
  p_source_audio_chunk_id UUID DEFAULT NULL
)
RETURNS public.notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_source_capture_session_id UUID := p_source_capture_session_id;
  v_existing_note public.notes%ROWTYPE;
  v_note public.notes%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_raw_text, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A nota precisa ter texto antes de ser salva.';
  END IF;

  IF p_source_audio_chunk_id IS NOT NULL THEN
    SELECT session_id
    INTO v_source_capture_session_id
    FROM public.audio_chunks
    WHERE id = p_source_audio_chunk_id
      AND user_id = v_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Trecho de origem nao encontrado.';
    END IF;

    SELECT *
    INTO v_existing_note
    FROM public.notes
    WHERE user_id = v_user_id
      AND source_audio_chunk_id = p_source_audio_chunk_id
    LIMIT 1;

    IF FOUND THEN
      RETURN v_existing_note;
    END IF;
  ELSIF v_source_capture_session_id IS NOT NULL THEN
    PERFORM 1
    FROM public.capture_sessions
    WHERE id = v_source_capture_session_id
      AND user_id = v_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sessao de origem nao encontrada.';
    END IF;
  END IF;

  SELECT *
  INTO v_note
  FROM public.create_note_with_limit(p_raw_text, p_title);

  UPDATE public.notes
  SET
    source_capture_session_id = v_source_capture_session_id,
    source_audio_chunk_id = p_source_audio_chunk_id
  WHERE id = v_note.id
  RETURNING *
  INTO v_note;

  RETURN v_note;
END;
$$;

REVOKE ALL ON FUNCTION public.create_note_from_capture_source(TEXT, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_note_from_capture_source(TEXT, TEXT, UUID, UUID) TO authenticated;
