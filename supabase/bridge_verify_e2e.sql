-- VERIFY end-to-end: simula o fluxo real de um usuário importando/rejeitando
-- via a RPC (o mesmo caminho que a EF VI executa ao receber chamada do Bardo).
--
-- Envolvido em BEGIN ... ROLLBACK: zero persistência real.
-- Prova os efeitos em bridge_exports e bridge_items tabulando antes/depois.

BEGIN;

-- Setup: pegar 2 organized_ideas distintos (fluxo importar + rejeitar).
CREATE TEMP TABLE verify_ctx AS
SELECT row_number() OVER (ORDER BY created_at) AS slot,
       user_id,
       id AS organized_id
  FROM public.organized_ideas
  ORDER BY created_at
  LIMIT 2;

-- Cria um bridge_item + bridge_export como se fosse o Send-to-Bardo.
-- Simulando o producer real: bridge_item em estado 'eligible' (ready to consume).
DO $setup$
DECLARE
  v_uid_1 uuid; v_org_1 uuid;
  v_uid_2 uuid; v_org_2 uuid;
  v_item_1 uuid; v_exp_1 uuid;
  v_item_2 uuid; v_exp_2 uuid;
BEGIN
  SELECT user_id, organized_id INTO v_uid_1, v_org_1 FROM verify_ctx WHERE slot = 1;
  SELECT user_id, organized_id INTO v_uid_2, v_org_2 FROM verify_ctx WHERE slot = 2;

  -- Item 1 (será importado).
  INSERT INTO public.bridge_items (
    user_id, source_type, source_id, source_session_mode,
    content_type, title, content, bridge_status
  ) VALUES (
    v_uid_1, 'note', gen_random_uuid(), 'safe_capture',
    'note', 'VERIFY_E2E_IMPORT', 'content for import flow', 'eligible'
  ) RETURNING id INTO v_item_1;

  INSERT INTO public.bridge_exports (
    payload, status, destination, content_type,
    idea_draft_id, note_id, organized_idea_id,
    validation_status, validation_issues, bridge_item_id
  ) VALUES (
    '{"magic":"BARDO_BRIDGE_V1","items":[{"title":"Verify Import"}]}'::jsonb,
    'pending', 'bardo', 'organized_idea',
    NULL, NULL, v_org_1,
    'valid', '[]'::jsonb, v_item_1
  ) RETURNING id INTO v_exp_1;

  -- Item 2 (será rejeitado).
  INSERT INTO public.bridge_items (
    user_id, source_type, source_id, source_session_mode,
    content_type, title, content, bridge_status
  ) VALUES (
    v_uid_2, 'note', gen_random_uuid(), 'safe_capture',
    'note', 'VERIFY_E2E_REJECT', 'content for reject flow', 'eligible'
  ) RETURNING id INTO v_item_2;

  INSERT INTO public.bridge_exports (
    payload, status, destination, content_type,
    idea_draft_id, note_id, organized_idea_id,
    validation_status, validation_issues, bridge_item_id
  ) VALUES (
    '{"magic":"BARDO_BRIDGE_V1","items":[{"title":"Verify Reject"}]}'::jsonb,
    'pending', 'bardo', 'organized_idea',
    NULL, NULL, v_org_2,
    'valid', '[]'::jsonb, v_item_2
  ) RETURNING id INTO v_exp_2;

  -- Salvar nas temp tables para referência.
  CREATE TEMP TABLE verify_targets AS
    SELECT 'import' AS flow, v_exp_1 AS exp_id, v_item_1 AS item_id
    UNION ALL
    SELECT 'reject', v_exp_2, v_item_2;
END $setup$;

-- ── Estado ANTES ──
SELECT 'ANTES' AS fase,
       vt.flow,
       be.status AS export_status,
       be.exported_at,
       bi.bridge_status AS item_status,
       bi.consumed_at,
       bi.blocked_at
  FROM verify_targets vt
  JOIN public.bridge_exports be ON be.id = vt.exp_id
  JOIN public.bridge_items   bi ON bi.id = vt.item_id
  ORDER BY vt.flow;

-- ── Listagem: ambos devem aparecer (pending + destination=bardo + item eligible) ──
SELECT 'LISTA_ANTES' AS fase,
       count(*) AS rows_visiveis
  FROM verify_targets vt
  JOIN public.bridge_exports be ON be.id = vt.exp_id
  LEFT JOIN public.bridge_items bi ON bi.id = be.bridge_item_id
 WHERE be.status = 'pending'
   AND be.destination = 'bardo'
   AND (bi.id IS NULL OR bi.bridge_status NOT IN ('consumed', 'blocked'));

-- ── Executar RPCs (caminho real que a EF VI usa) ──
DO $act$
DECLARE
  v_exp_import uuid; v_exp_reject uuid;
  r_imp RECORD; r_rej RECORD;
BEGIN
  SELECT exp_id INTO v_exp_import FROM verify_targets WHERE flow = 'import';
  SELECT exp_id INTO v_exp_reject FROM verify_targets WHERE flow = 'reject';

  SELECT * INTO r_imp FROM public.bridge_mark_imported(v_exp_import);
  SELECT * INTO r_rej FROM public.bridge_mark_rejected(v_exp_reject);

  RAISE NOTICE 'import rpc: marked=% export=% item=% preserved=%',
    r_imp.marked, r_imp.export_status, r_imp.item_status, r_imp.terminal_preserved;
  RAISE NOTICE 'reject rpc: marked=% export=% item=% preserved=%',
    r_rej.marked, r_rej.export_status, r_rej.item_status, r_rej.terminal_preserved;
END $act$;

-- ── Estado DEPOIS ──
SELECT 'DEPOIS' AS fase,
       vt.flow,
       be.status AS export_status,
       be.exported_at IS NOT NULL AS has_exported_at,
       bi.bridge_status AS item_status,
       bi.consumed_at IS NOT NULL AS has_consumed_at,
       bi.blocked_at  IS NOT NULL AS has_blocked_at
  FROM verify_targets vt
  JOIN public.bridge_exports be ON be.id = vt.exp_id
  JOIN public.bridge_items   bi ON bi.id = vt.item_id
  ORDER BY vt.flow;

-- ── Listagem: ambos devem SUMIR (status='exported' + item terminal) ──
SELECT 'LISTA_DEPOIS' AS fase,
       count(*) AS rows_visiveis
  FROM verify_targets vt
  JOIN public.bridge_exports be ON be.id = vt.exp_id
  LEFT JOIN public.bridge_items bi ON bi.id = be.bridge_item_id
 WHERE be.status = 'pending'
   AND be.destination = 'bardo'
   AND (bi.id IS NULL OR bi.bridge_status NOT IN ('consumed', 'blocked'));

-- ── Asserts finais: PASS/FAIL por check do VERIFY ──
SELECT 'ASSERT_V3' AS check_name,
       'importar -> export=exported + item=consumed + has timestamps' AS criterio,
       CASE
         WHEN be.status = 'exported'
          AND be.exported_at IS NOT NULL
          AND bi.bridge_status = 'consumed'
          AND bi.consumed_at IS NOT NULL
         THEN 'PASS' ELSE 'FAIL'
       END AS resultado
  FROM verify_targets vt
  JOIN public.bridge_exports be ON be.id = vt.exp_id
  JOIN public.bridge_items   bi ON bi.id = vt.item_id
 WHERE vt.flow = 'import'
UNION ALL
SELECT 'ASSERT_V4',
       'rejeitar -> export=exported + item=blocked + has timestamps',
       CASE
         WHEN be.status = 'exported'
          AND be.exported_at IS NOT NULL
          AND bi.bridge_status = 'blocked'
          AND bi.blocked_at IS NOT NULL
         THEN 'PASS' ELSE 'FAIL'
       END
  FROM verify_targets vt
  JOIN public.bridge_exports be ON be.id = vt.exp_id
  JOIN public.bridge_items   bi ON bi.id = vt.item_id
 WHERE vt.flow = 'reject';

ROLLBACK;
