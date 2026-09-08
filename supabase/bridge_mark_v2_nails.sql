-- CENAX-009A — nails SQL das RPCs v2 (autorização horizontal do mark).
--
-- Executar contra um banco de LABORATÓRIO com o schema bridge aplicado.
-- Cria e destrói suas próprias fixtures numa transação que é sempre
-- revertida no final — não deixa resíduo.
--
--   docker exec -i <db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/bridge_mark_v2_nails.sql
--
-- Cada nail imprime PASS/FAIL. Qualquer FAIL aborta com exceção.
--
-- Cobertura (numeração do PLAN CENAX-009A):
--   N1  dono marca o próprio export                       → marked
--   N2  outro usuário marca                               → forbidden, sem efeito
--   N3  outro usuário rejeita                             → forbidden, sem efeito
--   N4  export inexistente                                → forbidden idêntico a N2
--   N5  vínculo revogado                                  → forbidden
--   N6  ≠1 vínculo ativo (zero e múltiplos)               → forbidden (fail closed)
--   N8  nenhuma referência de conteúdo declarada          → forbidden
--   N9  referência declarada não resolve                  → forbidden
--   N10a duas referências, MESMO owner                    → forbidden
--   N10b duas referências, owners divergentes             → forbidden
--   N11 content_type discordante da referência            → forbidden
--   N12 bridge_items.user_id divergente do owner          → forbidden
--   N13 replay do dono em export já terminal              → already_terminal (NÃO forbidden)
--   N14 terminal oposto preservado                        → terminal_preserved

begin;

set local client_min_messages = notice;

do $nails$
declare
  -- fixtures
  vi_a  uuid := '00000000-0000-4000-8000-00000000000a';
  vi_b  uuid := '00000000-0000-4000-8000-00000000000b';
  bardo_a text := 'bardo-user-a';
  bardo_b text := 'bardo-user-b';
  bardo_sem_link text := 'bardo-user-sem-link';
  bardo_multi text := 'bardo-user-multi';

  -- Uma nota por export: o índice único parcial
  -- idx_bridge_exports_single_active_note_per_destination só admite UM
  -- export pending por (note_id, destination).
  note_a  uuid := '00000000-0000-4000-8000-0000000000a1';
  note_a2 uuid := '00000000-0000-4000-8000-0000000000a2';
  note_a3 uuid := '00000000-0000-4000-8000-0000000000a3';
  note_a4 uuid := '00000000-0000-4000-8000-0000000000a4';
  note_b  uuid := '00000000-0000-4000-8000-0000000000b1';
  oi_b    uuid := '00000000-0000-4000-8000-0000000000b2';
  oi_b2   uuid := '00000000-0000-4000-8000-0000000000b3';

  item_a uuid := '00000000-0000-4000-8000-0000000000c1';
  exp_a  uuid := '00000000-0000-4000-8000-0000000000d1';
  exp_two_same uuid := '00000000-0000-4000-8000-0000000000d2';
  exp_two_diff uuid := '00000000-0000-4000-8000-0000000000d3';
  exp_no_ref   uuid := '00000000-0000-4000-8000-0000000000d4';
  exp_broken   uuid := '00000000-0000-4000-8000-0000000000d5';
  exp_ct_bad   uuid := '00000000-0000-4000-8000-0000000000d6';
  exp_item_bad uuid := '00000000-0000-4000-8000-0000000000d7';
  item_bad uuid := '00000000-0000-4000-8000-0000000000c2';
  exp_inexistente uuid := '00000000-0000-4000-8000-0000000000ff';

  r record;
  v_status text;
  v_item   text;
  fails int := 0;

  procedure_note text;
begin
  -- ── helper inline: cria auth.users mínimos ──
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (vi_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'nail-a@lab.invalid', '', now(), now(), now()),
         (vi_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'nail-b@lab.invalid', '', now(), now(), now())
  on conflict (id) do nothing;

  -- ── vínculos ──
  insert into public.bardo_account_links (vi_user_id, bardo_user_id, bardo_email, link_status)
  values (vi_a, bardo_a, 'nail-a@lab.invalid', 'active'),
         (vi_b, bardo_b, 'nail-b@lab.invalid', 'active'),
         -- N6: DOIS vínculos ativos para o mesmo bardo_user_id
         (vi_a, bardo_multi, 'nail-a@lab.invalid', 'active'),
         (vi_b, bardo_multi, 'nail-b@lab.invalid', 'active');

  -- ── conteúdo ──
  insert into public.notes (id, user_id, title, raw_text)
  values (note_a,  vi_a, 'NOTA-A',  'a'),
         (note_a2, vi_a, 'NOTA-A2', 'a'),
         (note_a3, vi_a, 'NOTA-A3', 'a'),
         (note_a4, vi_a, 'NOTA-A4', 'a'),
         (note_b,  vi_b, 'NOTA-B',  'b');

  insert into public.organized_ideas (id, user_id, note_ids, type, title, content)
  values (oi_b,  vi_b, array[note_b], 'topicos', 'OI-B',  '{}'::jsonb),
         (oi_b2, vi_b, array[note_b], 'topicos', 'OI-B2', '{}'::jsonb);

  insert into public.bridge_items (id, user_id, source_type, source_id, source_session_mode,
                                   content_type, domain, scope_type, title, content, payload, bridge_status)
  values (item_a, vi_a, 'note', note_a, 'manual', 'note', 'voiceideas', 'project',
          'NOTA-A', 'a', '{}'::jsonb, 'eligible'),
         -- N12: item pertencente a B, mas anexado a um export cujo conteúdo é de A
         (item_bad, vi_b, 'note', note_b, 'manual', 'note', 'voiceideas', 'project',
          'NOTA-B', 'b', '{}'::jsonb, 'eligible');

  -- A constraint de referência exclusiva (bridge_exports_check /
  -- bridge_exports_target_reference_check, nome varia por ambiente) impede
  -- criar as fixtures inconsistentes de N8..N11. Ela é dropada AQUI, apenas
  -- dentro desta transação (revertida no rollback), para provar que a RPC é
  -- fail-closed POR SI — sem depender de uma constraint que outra migration
  -- pode ter dropado no ambiente real.
  alter table public.bridge_exports drop constraint if exists bridge_exports_check;
  alter table public.bridge_exports drop constraint if exists bridge_exports_target_reference_check;
  -- As FKs de conteúdo (ON DELETE CASCADE) tornam "referência quebrada"
  -- inalcançável enquanto existirem — o que é uma boa notícia. Dropadas aqui
  -- (só na transação de teste) para exercitar N9 mesmo assim: a RPC não pode
  -- depender de FK para negar.
  alter table public.bridge_exports drop constraint if exists bridge_exports_note_id_fkey;
  alter table public.bridge_exports drop constraint if exists bridge_exports_organized_idea_id_fkey;
  alter table public.bridge_exports drop constraint if exists bridge_exports_idea_draft_id_fkey;

  -- ── exports ──
  insert into public.bridge_exports (id, content_type, note_id, organized_idea_id, destination,
                                     payload, status, bridge_item_id)
  values
    -- normal, de A
    (exp_a, 'note', note_a, null, 'bardo', '{}'::jsonb, 'pending', item_a),
    -- N10a: duas referências, ambas de B
    (exp_two_same, 'note', note_b, oi_b, 'bardo', '{}'::jsonb, 'pending', null),
    -- N10b: duas referências, owners divergentes (A e B)
    (exp_two_diff, 'note', note_a2, oi_b2, 'bardo', '{}'::jsonb, 'pending', null),
    -- N8: nenhuma referência declarada
    (exp_no_ref, 'note', null, null, 'bardo', '{}'::jsonb, 'pending', null),
    -- N9: referência declarada que não resolve
    (exp_broken, 'note', '00000000-0000-4000-8000-0000000000e9', null, 'bardo',
     '{}'::jsonb, 'pending', null),
    -- N11: content_type diz organized_idea, mas só note_id está preenchido
    (exp_ct_bad, 'organized_idea', note_a3, null, 'bardo', '{}'::jsonb, 'pending', null),
    -- N12: conteúdo de A, mas bridge_item de B
    (exp_item_bad, 'note', note_a4, null, 'bardo', '{}'::jsonb, 'pending', item_bad);

  procedure_note := 'constraint de referência relaxada apenas dentro da transação de teste';

  ------------------------------------------------------------------
  -- N1 — dono marca o próprio export
  ------------------------------------------------------------------
  select * into r from public.bridge_mark_imported_v2(exp_a, bardo_a);
  if r.outcome = 'marked' and r.marked = 1 then
    raise notice 'N1  PASS  dono marca o próprio export -> %', r.outcome;
  else
    fails := fails + 1;
    raise warning 'N1  FAIL  esperado marked, veio % (marked=%)', r.outcome, r.marked;
  end if;

  ------------------------------------------------------------------
  -- N13 — replay do dono (export já terminal) NÃO vira forbidden
  ------------------------------------------------------------------
  select * into r from public.bridge_mark_imported_v2(exp_a, bardo_a);
  if r.outcome = 'already_terminal' and r.marked = 0 then
    raise notice 'N13 PASS  replay do dono -> % (marked=0)', r.outcome;
  else
    fails := fails + 1;
    raise warning 'N13 FAIL  esperado already_terminal, veio %', r.outcome;
  end if;

  ------------------------------------------------------------------
  -- N14 — terminal oposto preservado
  ------------------------------------------------------------------
  select * into r from public.bridge_mark_rejected_v2(exp_a, bardo_a);
  if r.outcome = 'terminal_preserved' and r.terminal_preserved = 'consumed' then
    raise notice 'N14 PASS  terminal oposto preservado -> %', r.terminal_preserved;
  else
    fails := fails + 1;
    raise warning 'N14 FAIL  esperado terminal_preserved/consumed, veio %/%',
      r.outcome, r.terminal_preserved;
  end if;

  -- restaura exp_a para pending antes dos nails de negação
  update public.bridge_exports set status = 'pending', exported_at = null where id = exp_a;
  update public.bridge_items set bridge_status = 'eligible', consumed_at = null where id = item_a;

  ------------------------------------------------------------------
  -- N2 — outro usuário marca o export de A
  ------------------------------------------------------------------
  select * into r from public.bridge_mark_imported_v2(exp_a, bardo_b);
  select status into v_status from public.bridge_exports where id = exp_a;
  select bridge_status into v_item from public.bridge_items where id = item_a;
  if r.outcome = 'forbidden' and r.marked = 0
     and v_status = 'pending' and v_item = 'eligible' then
    raise notice 'N2  PASS  cross-tenant mark negado, DB intacto (%/%)', v_status, v_item;
  else
    fails := fails + 1;
    raise warning 'N2  FAIL  outcome=% marked=% status=% item=%', r.outcome, r.marked, v_status, v_item;
  end if;

  ------------------------------------------------------------------
  -- N3 — outro usuário rejeita o export de A
  ------------------------------------------------------------------
  select * into r from public.bridge_mark_rejected_v2(exp_a, bardo_b);
  select status into v_status from public.bridge_exports where id = exp_a;
  select bridge_status into v_item from public.bridge_items where id = item_a;
  if r.outcome = 'forbidden' and v_status = 'pending' and v_item = 'eligible' then
    raise notice 'N3  PASS  cross-tenant reject negado, DB intacto';
  else
    fails := fails + 1;
    raise warning 'N3  FAIL  outcome=% status=% item=%', r.outcome, v_status, v_item;
  end if;

  ------------------------------------------------------------------
  -- N4 — export inexistente devolve EXATAMENTE o mesmo shape de N2
  ------------------------------------------------------------------
  select * into r from public.bridge_mark_imported_v2(exp_inexistente, bardo_b);
  if r.outcome = 'forbidden' and r.marked = 0
     and r.export_status is null and r.item_status is null and r.terminal_preserved is null then
    raise notice 'N4  PASS  inexistente indistinguível de alheio (todos os campos null)';
  else
    fails := fails + 1;
    raise warning 'N4  FAIL  outcome=% export_status=% item_status=%',
      r.outcome, r.export_status, r.item_status;
  end if;

  ------------------------------------------------------------------
  -- N5 — vínculo revogado
  ------------------------------------------------------------------
  update public.bardo_account_links set link_status = 'revoked', revoked_at = now()
   where bardo_user_id = bardo_a and vi_user_id = vi_a;

  select * into r from public.bridge_mark_imported_v2(exp_a, bardo_a);
  if r.outcome = 'forbidden' then
    raise notice 'N5  PASS  vínculo revogado -> forbidden';
  else
    fails := fails + 1;
    raise warning 'N5  FAIL  esperado forbidden, veio %', r.outcome;
  end if;

  update public.bardo_account_links set link_status = 'active', revoked_at = null
   where bardo_user_id = bardo_a and vi_user_id = vi_a;

  ------------------------------------------------------------------
  -- N6 — zero vínculos e múltiplos vínculos → fail closed
  ------------------------------------------------------------------
  select * into r from public.bridge_mark_imported_v2(exp_a, bardo_sem_link);
  if r.outcome = 'forbidden' then
    raise notice 'N6a PASS  zero vínculos -> forbidden';
  else
    fails := fails + 1;
    raise warning 'N6a FAIL  esperado forbidden, veio %', r.outcome;
  end if;

  select * into r from public.bridge_mark_imported_v2(exp_a, bardo_multi);
  select status into v_status from public.bridge_exports where id = exp_a;
  if r.outcome = 'forbidden' and v_status = 'pending' then
    raise notice 'N6b PASS  múltiplos vínculos ativos -> forbidden (não escolhe um)';
  else
    fails := fails + 1;
    raise warning 'N6b FAIL  outcome=% status=%', r.outcome, v_status;
  end if;

  ------------------------------------------------------------------
  -- N8..N12 — owner resolver fail-closed (sem depender de constraint)
  ------------------------------------------------------------------
  select * into r from public.bridge_mark_imported_v2(exp_no_ref, bardo_a);
  if r.outcome = 'forbidden' then
    raise notice 'N8  PASS  nenhuma referência declarada -> forbidden';
  else
    fails := fails + 1;
    raise warning 'N8  FAIL  veio %', r.outcome;
  end if;

  select * into r from public.bridge_mark_imported_v2(exp_broken, bardo_a);
  if r.outcome = 'forbidden' then
    raise notice 'N9  PASS  referência quebrada -> forbidden';
  else
    fails := fails + 1;
    raise warning 'N9  FAIL  veio %', r.outcome;
  end if;

  -- N10a: duas referências, MESMO owner (B) — ainda assim negado
  select * into r from public.bridge_mark_imported_v2(exp_two_same, bardo_b);
  if r.outcome = 'forbidden' then
    raise notice 'N10a PASS duas referências com o MESMO owner -> forbidden';
  else
    fails := fails + 1;
    raise warning 'N10a FAIL veio % (permitiu estado inconsistente)', r.outcome;
  end if;

  -- N10b: duas referências, owners divergentes
  select * into r from public.bridge_mark_imported_v2(exp_two_diff, bardo_a);
  if r.outcome = 'forbidden' then
    raise notice 'N10b PASS duas referências com owners divergentes -> forbidden';
  else
    fails := fails + 1;
    raise warning 'N10b FAIL veio %', r.outcome;
  end if;

  select * into r from public.bridge_mark_imported_v2(exp_ct_bad, bardo_a);
  if r.outcome = 'forbidden' then
    raise notice 'N11 PASS  content_type discordante -> forbidden';
  else
    fails := fails + 1;
    raise warning 'N11 FAIL  veio %', r.outcome;
  end if;

  select * into r from public.bridge_mark_imported_v2(exp_item_bad, bardo_a);
  if r.outcome = 'forbidden' then
    raise notice 'N12 PASS  bridge_items.user_id divergente -> forbidden';
  else
    fails := fails + 1;
    raise warning 'N12 FAIL  veio %', r.outcome;
  end if;

  ------------------------------------------------------------------
  if fails > 0 then
    raise exception 'CENAX-009A nails: % FAIL(s)', fails;
  end if;
  raise notice '════ CENAX-009A — TODOS OS NAILS SQL PASSARAM (% ) ════', procedure_note;
end
$nails$;

rollback;
