-- Smoke tests para bridge_mark_imported / bridge_mark_rejected + listagem.
-- 14 casos do mini-PLAN v5, adaptados ao schema real do VI remoto:
--   bridge_exports NÃO tem owner_email nem content_hash.
--   Usa content_type='organized_idea' com UUIDs distintos do pool existente.
-- Rodar via `supabase db query --linked --file supabase/bridge_smoke_v5.sql`.
-- Envolvido em BEGIN ... ROLLBACK: zero side effect em produção.

BEGIN;

-- Limpeza preventiva (títulos smoke sobreviveriam caso sem rollback).
DELETE FROM public.bridge_items WHERE title = 'SMOKE_TEST_V5';

-- ───────────────────────────────────────────────────────────────
-- Setup: pool de user + organized_ideas distintos para todos os testes.
-- ───────────────────────────────────────────────────────────────
CREATE TEMP TABLE smoke_ctx (
  slot int PRIMARY KEY,
  user_id uuid,
  organized_id uuid
);

INSERT INTO smoke_ctx(slot, user_id, organized_id)
SELECT row_number() OVER (ORDER BY created_at) AS slot,
       user_id,
       id
  FROM public.organized_ideas
  ORDER BY created_at
  LIMIT 15;

-- Helpers
CREATE OR REPLACE FUNCTION pg_temp.slot_org(p_slot int) RETURNS uuid AS $$
  SELECT organized_id FROM smoke_ctx WHERE slot = p_slot
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION pg_temp.slot_user(p_slot int) RETURNS uuid AS $$
  SELECT user_id FROM smoke_ctx WHERE slot = p_slot
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION pg_temp.make_item(p_user_id uuid, p_status text) RETURNS uuid AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.bridge_items (
    user_id, source_type, source_id, source_session_mode,
    content_type, title, content, bridge_status,
    consumed_at, blocked_at
  ) VALUES (
    p_user_id,
    'note', gen_random_uuid(), 'safe_capture',
    'note', 'SMOKE_TEST_V5', 'content', p_status,
    CASE WHEN p_status = 'consumed' THEN now() ELSE NULL END,
    CASE WHEN p_status = 'blocked'  THEN now() ELSE NULL END
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.make_export(
  p_organized_id uuid,
  p_status text,
  p_destination text,
  p_bridge_item_id uuid
) RETURNS uuid AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.bridge_exports (
    payload, status, destination, content_type,
    idea_draft_id, note_id, organized_idea_id,
    validation_status, validation_issues, bridge_item_id
  ) VALUES (
    '{"magic":"BARDO_BRIDGE_V1","items":[]}'::jsonb,
    p_status, p_destination, 'organized_idea',
    NULL, NULL, p_organized_id,
    'valid', '[]'::jsonb, p_bridge_item_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$ LANGUAGE plpgsql;

CREATE TEMP TABLE smoke_results (
  test_no  int,
  label    text,
  expected text,
  actual   text,
  pass     boolean
);

-- ─── 1. mark_imported fresh (pending + draft) ────────────
DO $t$
DECLARE
  v_item uuid := pg_temp.make_item(pg_temp.slot_user(1), 'draft');
  v_exp  uuid := pg_temp.make_export(pg_temp.slot_org(1), 'pending', 'bardo', v_item);
  r RECORD;
BEGIN
  SELECT * INTO r FROM public.bridge_mark_imported(v_exp);
  INSERT INTO smoke_results VALUES (
    1, 'mark_imported fresh (pending+draft)',
    'marked=1 export=exported item=consumed',
    format('marked=%s export=%s item=%s', r.marked, r.export_status, r.item_status),
    (r.marked = 1 AND r.export_status = 'exported' AND r.item_status = 'consumed')
  );
END $t$;

-- ─── 2. mark_rejected fresh (pending + draft) ────────────
DO $t$
DECLARE
  v_item uuid := pg_temp.make_item(pg_temp.slot_user(2), 'draft');
  v_exp  uuid := pg_temp.make_export(pg_temp.slot_org(2), 'pending', 'bardo', v_item);
  r RECORD;
BEGIN
  SELECT * INTO r FROM public.bridge_mark_rejected(v_exp);
  INSERT INTO smoke_results VALUES (
    2, 'mark_rejected fresh (pending+draft)',
    'marked=1 export=exported item=blocked',
    format('marked=%s export=%s item=%s', r.marked, r.export_status, r.item_status),
    (r.marked = 1 AND r.export_status = 'exported' AND r.item_status = 'blocked')
  );
END $t$;

-- ─── 3. mark_imported com bridge_item_id = NULL ──────────
DO $t$
DECLARE
  v_exp uuid := pg_temp.make_export(pg_temp.slot_org(3), 'pending', 'bardo', NULL);
  r RECORD;
BEGIN
  SELECT * INTO r FROM public.bridge_mark_imported(v_exp);
  INSERT INTO smoke_results VALUES (
    3, 'mark_imported bridge_item_id=NULL',
    'marked=1 export=exported item=NULL',
    format('marked=%s export=%s item=%s', r.marked, r.export_status, COALESCE(r.item_status,'NULL')),
    (r.marked = 1 AND r.export_status = 'exported' AND r.item_status IS NULL)
  );
END $t$;

-- ─── 4. Idempotência mark_imported (2× consecutivas) ─────
DO $t$
DECLARE
  v_item uuid := pg_temp.make_item(pg_temp.slot_user(4), 'draft');
  v_exp  uuid := pg_temp.make_export(pg_temp.slot_org(4), 'pending', 'bardo', v_item);
  r RECORD;
BEGIN
  PERFORM * FROM public.bridge_mark_imported(v_exp);
  SELECT * INTO r FROM public.bridge_mark_imported(v_exp);
  INSERT INTO smoke_results VALUES (
    4, 'mark_imported idempotente (2a chamada)',
    'marked=0 export=exported item=consumed',
    format('marked=%s export=%s item=%s', r.marked, r.export_status, r.item_status),
    (r.marked = 0 AND r.export_status = 'exported' AND r.item_status = 'consumed')
  );
END $t$;

-- ─── 5. Idempotência mark_rejected (2× consecutivas) ─────
DO $t$
DECLARE
  v_item uuid := pg_temp.make_item(pg_temp.slot_user(5), 'draft');
  v_exp  uuid := pg_temp.make_export(pg_temp.slot_org(5), 'pending', 'bardo', v_item);
  r RECORD;
BEGIN
  PERFORM * FROM public.bridge_mark_rejected(v_exp);
  SELECT * INTO r FROM public.bridge_mark_rejected(v_exp);
  INSERT INTO smoke_results VALUES (
    5, 'mark_rejected idempotente (2a chamada)',
    'marked=0 export=exported item=blocked',
    format('marked=%s export=%s item=%s', r.marked, r.export_status, r.item_status),
    (r.marked = 0 AND r.export_status = 'exported' AND r.item_status = 'blocked')
  );
END $t$;

-- ─── 6. Preservação terminal: mark_imported sobre item blocked ───
DO $t$
DECLARE
  v_item uuid := pg_temp.make_item(pg_temp.slot_user(6), 'blocked');
  v_exp  uuid := pg_temp.make_export(pg_temp.slot_org(6), 'pending', 'bardo', v_item);
  r RECORD;
  v_item_status text;
BEGIN
  SELECT * INTO r FROM public.bridge_mark_imported(v_exp);
  SELECT bridge_status INTO v_item_status FROM public.bridge_items WHERE id = v_item;
  INSERT INTO smoke_results VALUES (
    6, 'mark_imported sobre item blocked (preservar terminal oposto)',
    'terminal_preserved=blocked item permanece blocked',
    format('preserved=%s item=%s', COALESCE(r.terminal_preserved,'NULL'), v_item_status),
    (r.terminal_preserved = 'blocked' AND v_item_status = 'blocked')
  );
END $t$;

-- ─── 7. Preservação terminal: mark_rejected sobre item consumed ──
DO $t$
DECLARE
  v_item uuid := pg_temp.make_item(pg_temp.slot_user(7), 'consumed');
  v_exp  uuid := pg_temp.make_export(pg_temp.slot_org(7), 'pending', 'bardo', v_item);
  r RECORD;
  v_item_status text;
BEGIN
  SELECT * INTO r FROM public.bridge_mark_rejected(v_exp);
  SELECT bridge_status INTO v_item_status FROM public.bridge_items WHERE id = v_item;
  INSERT INTO smoke_results VALUES (
    7, 'mark_rejected sobre item consumed (preservar terminal oposto)',
    'terminal_preserved=consumed item permanece consumed',
    format('preserved=%s item=%s', COALESCE(r.terminal_preserved,'NULL'), v_item_status),
    (r.terminal_preserved = 'consumed' AND v_item_status = 'consumed')
  );
END $t$;

-- ─── 8. mark_imported em export exporting ─────────────────
DO $t$
DECLARE
  v_item uuid := pg_temp.make_item(pg_temp.slot_user(8), 'draft');
  v_exp  uuid := pg_temp.make_export(pg_temp.slot_org(8), 'exporting', 'bardo', v_item);
  r RECORD;
  v_exp_status text;
  v_item_status text;
BEGIN
  SELECT * INTO r FROM public.bridge_mark_imported(v_exp);
  SELECT status        INTO v_exp_status  FROM public.bridge_exports WHERE id = v_exp;
  SELECT bridge_status INTO v_item_status FROM public.bridge_items   WHERE id = v_item;
  INSERT INTO smoke_results VALUES (
    8, 'mark_imported sobre export=exporting',
    'marked=0 export=exporting item=draft',
    format('marked=%s export=%s item=%s', r.marked, v_exp_status, v_item_status),
    (r.marked = 0 AND v_exp_status = 'exporting' AND v_item_status = 'draft')
  );
END $t$;

-- ─── 9. mark_imported em export failed ────────────────────
DO $t$
DECLARE
  v_item uuid := pg_temp.make_item(pg_temp.slot_user(9), 'draft');
  v_exp  uuid := pg_temp.make_export(pg_temp.slot_org(9), 'failed', 'bardo', v_item);
  r RECORD;
  v_exp_status text;
  v_item_status text;
BEGIN
  SELECT * INTO r FROM public.bridge_mark_imported(v_exp);
  SELECT status        INTO v_exp_status  FROM public.bridge_exports WHERE id = v_exp;
  SELECT bridge_status INTO v_item_status FROM public.bridge_items   WHERE id = v_item;
  INSERT INTO smoke_results VALUES (
    9, 'mark_imported sobre export=failed',
    'marked=0 export=failed item=draft',
    format('marked=%s export=%s item=%s', r.marked, v_exp_status, v_item_status),
    (r.marked = 0 AND v_exp_status = 'failed' AND v_item_status = 'draft')
  );
END $t$;

-- ─── 10. mark_rejected em export exporting/failed ─────────
DO $t$
DECLARE
  v_item1 uuid := pg_temp.make_item(pg_temp.slot_user(10), 'draft');
  v_exp1  uuid := pg_temp.make_export(pg_temp.slot_org(10), 'exporting', 'bardo', v_item1);
  v_item2 uuid := pg_temp.make_item(pg_temp.slot_user(11), 'draft');
  v_exp2  uuid := pg_temp.make_export(pg_temp.slot_org(11), 'failed', 'bardo', v_item2);
  r1 RECORD; r2 RECORD;
BEGIN
  SELECT * INTO r1 FROM public.bridge_mark_rejected(v_exp1);
  SELECT * INTO r2 FROM public.bridge_mark_rejected(v_exp2);
  INSERT INTO smoke_results VALUES (
    10, 'mark_rejected sobre export=exporting|failed',
    'ambas marked=0',
    format('exporting_marked=%s failed_marked=%s', r1.marked, r2.marked),
    (r1.marked = 0 AND r2.marked = 0)
  );
END $t$;

-- ─── 11. mark_imported em export destination=cenax ────────
DO $t$
DECLARE
  v_item uuid := pg_temp.make_item(pg_temp.slot_user(12), 'draft');
  v_exp  uuid := pg_temp.make_export(pg_temp.slot_org(12), 'pending', 'cenax', v_item);
  r RECORD;
  v_exp_status text;
  v_item_status text;
BEGIN
  SELECT * INTO r FROM public.bridge_mark_imported(v_exp);
  SELECT status        INTO v_exp_status  FROM public.bridge_exports WHERE id = v_exp;
  SELECT bridge_status INTO v_item_status FROM public.bridge_items   WHERE id = v_item;
  INSERT INTO smoke_results VALUES (
    11, 'mark_imported sobre destination=cenax (guard)',
    'marked=0 export=pending item=draft',
    format('marked=%s export=%s item=%s', r.marked, v_exp_status, v_item_status),
    (r.marked = 0 AND v_exp_status = 'pending' AND v_item_status = 'draft')
  );
END $t$;

-- ─── 12. Listagem blindada: pending + item consumed → não aparece ───
DO $t$
DECLARE
  v_item uuid := pg_temp.make_item(pg_temp.slot_user(13), 'consumed');
  v_exp  uuid := pg_temp.make_export(pg_temp.slot_org(13), 'pending', 'bardo', v_item);
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.bridge_exports be
    LEFT JOIN public.bridge_items bi ON bi.id = be.bridge_item_id
   WHERE be.id = v_exp
     AND be.status = 'pending'
     AND be.destination = 'bardo'
     AND (bi.id IS NULL OR bi.bridge_status NOT IN ('consumed', 'blocked'));
  INSERT INTO smoke_results VALUES (
    12, 'listagem blindada: pending + item consumed -> exclui',
    'count=0',
    format('count=%s', v_count),
    (v_count = 0)
  );
END $t$;

-- ─── 13. Listagem: destination=cenax → não aparece ────────
DO $t$
DECLARE
  v_exp uuid := pg_temp.make_export(pg_temp.slot_org(14), 'pending', 'cenax', NULL);
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.bridge_exports be
    LEFT JOIN public.bridge_items bi ON bi.id = be.bridge_item_id
   WHERE be.id = v_exp
     AND be.status = 'pending'
     AND be.destination = 'bardo';
  INSERT INTO smoke_results VALUES (
    13, 'listagem: destination=cenax -> exclui',
    'count=0',
    format('count=%s', v_count),
    (v_count = 0)
  );
END $t$;

-- ─── 14. Listagem: pending + bridge_item_id=NULL → retorna ──
DO $t$
DECLARE
  v_exp uuid := pg_temp.make_export(pg_temp.slot_org(15), 'pending', 'bardo', NULL);
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.bridge_exports be
    LEFT JOIN public.bridge_items bi ON bi.id = be.bridge_item_id
   WHERE be.id = v_exp
     AND be.status = 'pending'
     AND be.destination = 'bardo'
     AND (bi.id IS NULL OR bi.bridge_status NOT IN ('consumed', 'blocked'));
  INSERT INTO smoke_results VALUES (
    14, 'listagem: pending + bridge_item_id=NULL -> retorna',
    'count=1',
    format('count=%s', v_count),
    (v_count = 1)
  );
END $t$;

-- ─── Relatório: uma tabela única com detalhe + totais ──
WITH summary AS (
  SELECT NULL::int AS test_no,
         format('TOTAL: %s / %s',
                count(*) FILTER (WHERE pass),
                count(*)) AS label,
         ''::text AS actual,
         (count(*) FILTER (WHERE NOT pass) = 0) AS pass
    FROM smoke_results
)
SELECT COALESCE(test_no::text, '--') AS "#",
       label,
       actual,
       CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result
  FROM (
    SELECT test_no, label, actual, pass FROM smoke_results
    UNION ALL
    SELECT test_no, label, actual, pass FROM summary
  ) x
  ORDER BY test_no NULLS LAST;

ROLLBACK;
