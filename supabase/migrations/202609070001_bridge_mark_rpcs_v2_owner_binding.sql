-- CENAX-009A — autorização horizontal do mark (H1).
--
-- Contexto (diagnóstico CENAX-009, contraprova dinâmica pela cadeia real
-- `JWT Bardo → bridge-inbox → S2S → bridge-exports → RPC`): as RPCs v1
-- `bridge_mark_imported/rejected(p_bridge_export_id)` não recebem nenhuma
-- identidade. Qualquer usuário autenticado no Bardo que conheça um
-- `bridge_export.id` de OUTRA conta consegue marcá-lo — o export sai de
-- `pending`, o item vira terminal e o conteúdo desaparece da inbox da
-- vítima sem nunca ter sido importado.
--
-- Correção: RPCs v2 ADITIVAS que recebem `p_bardo_user_id` e resolvem a
-- autorização inteira DENTRO da transação que escreve. A EF deixa de ser
-- autoridade; ela apenas repassa a identidade derivada do JWT validado.
--
-- Deliberadamente `p_bardo_user_id` (e não `p_vi_user_id`): se a EF
-- resolvesse o vínculo e passasse o `vi_user_id` já escolhido, o banco
-- continuaria confiando na identidade eleita por quem detém a
-- service_role, e uma revogação de vínculo concorrente ficaria invisível.
--
-- Cadeia de autorização (fail closed em toda etapa):
--   p_bardo_user_id
--     → EXATAMENTE 1 vínculo ativo em bardo_account_links  → vi_user_id
--     → lock/load do bridge_export (destination='bardo')
--     → EXATAMENTE 1 referência de conteúdo declarada
--     → a referência resolve um owner
--     → content_type corresponde à referência declarada
--     → bridge_item, quando presente, concorda com o owner
--     → owner = vi_user_id
--     → só então escreve
--
-- Ponto de linearização: as rows de vínculo ATIVAS EXISTENTES são travadas
-- com FOR UPDATE antes da decisão, serializando revogação/mutação
-- concorrente. A autorização vale sobre o snapshot transacional em que
-- existe exatamente um vínculo ativo. Isto NÃO é predicate/gap lock: não
-- impede a inserção concorrente de uma nova row de vínculo — nesse caso o
-- mark é linearizado ANTES da criação do novo vínculo. A unicidade de
-- vínculo em si é outra frente (CENAX-009B / H5); aqui o estado
-- inconsistente apenas NEGA.
--
-- Ordem de lock: bardo_account_links → bridge_exports → bridge_items.
-- Nenhum writer trava vínculos depois de exports, então acrescentar o
-- vínculo como primeiro lock não cria inversão nova. A ordem
-- exports → items é herdada da v1 e preservada.
--
-- `outcome` distingue negação de no-op legítimo. Para caller não
-- autorizado E para export inexistente o retorno é BYTE-IDÊNTICO
-- (`0, 'forbidden', null, null, null`) — nenhum campo revela ownership.
-- Nenhuma garantia de timing idêntico é feita ou pretendida.
--
-- As v1 permanecem intactas (rollout faseado, coexistência temporária).
-- `search_path = public` — padrão do catálogo desta base (15 das 16
-- funções SECURITY DEFINER), incluindo as v1 que estas espelham.

-- ───────────────────────────────────────────────────────────────
-- helper interno: resolve o owner de um bridge_export, fail closed
-- ───────────────────────────────────────────────────────────────
--
-- Retorna o `user_id` dono do conteúdo, ou NULL quando a row não permite
-- uma conclusão inequívoca. NULL nunca autoriza.
--
-- Não depende da constraint `bridge_exports_target_reference_check` (ou
-- `bridge_exports_check`, conforme o histórico do ambiente): o nome e a
-- presença dessa constraint variam por remote, e código de autorização
-- não deve apoiar-se num invariante que outra migration pode dropar.

create or replace function public.bridge_export_owner_strict(p_bridge_export_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_content_type   text;
  v_note_id        uuid;
  v_organized_id   uuid;
  v_draft_id       uuid;
  v_bridge_item_id uuid;
  v_refs_declared  int;
  v_owner          uuid;
  v_item_owner     uuid;
begin
  select be.content_type, be.note_id, be.organized_idea_id, be.idea_draft_id, be.bridge_item_id
    into v_content_type, v_note_id, v_organized_id, v_draft_id, v_bridge_item_id
    from public.bridge_exports be
   where be.id = p_bridge_export_id;

  if not found then
    return null;
  end if;

  -- EXATAMENTE uma referência declarada. Duas referências são estado
  -- inconsistente e negam, mesmo que apontem para o MESMO owner.
  v_refs_declared := (v_note_id is not null)::int
                   + (v_organized_id is not null)::int
                   + (v_draft_id is not null)::int;

  if v_refs_declared <> 1 then
    return null;
  end if;

  -- content_type precisa corresponder exatamente à referência declarada.
  if v_content_type = 'note' then
    if v_note_id is null then return null; end if;
    select n.user_id into v_owner from public.notes n where n.id = v_note_id;
  elsif v_content_type = 'organized_idea' then
    if v_organized_id is null then return null; end if;
    select o.user_id into v_owner from public.organized_ideas o where o.id = v_organized_id;
  elsif v_content_type = 'idea_draft' then
    if v_draft_id is null then return null; end if;
    select d.user_id into v_owner from public.idea_drafts d where d.id = v_draft_id;
  else
    return null;
  end if;

  -- referência quebrada (row ausente) ou owner nulo → nega.
  if v_owner is null then
    return null;
  end if;

  -- cross-check com o bridge_item quando o vínculo existe. A coluna
  -- `bridge_item_id` é nullable e sem backfill (exports legados), por isso
  -- é cross-check e não fonte primária.
  if v_bridge_item_id is not null then
    select bi.user_id into v_item_owner
      from public.bridge_items bi where bi.id = v_bridge_item_id;
    if v_item_owner is distinct from v_owner then
      return null;
    end if;
  end if;

  return v_owner;
end;
$$;

-- Helper interno: NÃO é uma RPC. Só as v2 (SECURITY DEFINER, executadas como
-- owner) o invocam, e o owner tem EXECUTE por ser dono. `service_role` chama a
-- v2, nunca o helper — por isso ele fica owner-only (least privilege).
revoke all on function public.bridge_export_owner_strict(uuid)
  from public, anon, authenticated, service_role;

comment on function public.bridge_export_owner_strict(uuid) is
  'CENAX-009A — resolve o owner (vi_user_id) de um bridge_export de forma fail-closed. '
  'Exige exatamente uma referência de conteúdo declarada, coerente com content_type, que '
  'resolva uma row existente, e concordância com bridge_items.user_id quando houver vínculo. '
  'Devolve NULL em qualquer ambiguidade; NULL nunca autoriza.';

-- ───────────────────────────────────────────────────────────────
-- helper interno: resolve o vi_user_id vinculado, sob lock
-- ───────────────────────────────────────────────────────────────
--
-- Trava as rows de vínculo ATIVAS existentes (FOR UPDATE) antes de contar,
-- serializando revogação concorrente. FOR UPDATE não é combinável com
-- agregação, por isso o lock vem primeiro e a contagem depois, já sob lock.
-- Zero vínculos OU mais de um → NULL (fail closed; nunca escolher um).

create or replace function public.bardo_link_vi_user_locked(p_bardo_user_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link_count int;
  v_vi_user_id uuid;
begin
  -- `bardo_user_id` é TEXT em bardo_account_links (identificador opaco do
  -- Bardo, não um uuid tipado). Normaliza como o resolver TS já fazia.
  if p_bardo_user_id is null or btrim(p_bardo_user_id) = '' then
    return null;
  end if;

  perform 1
     from public.bardo_account_links l
    where l.bardo_user_id = btrim(p_bardo_user_id)
      and l.link_status = 'active'
    for update;

  -- Conta primeiro (agregação não combina com FOR UPDATE; o lock acima já
  -- serializou as rows). `min(uuid)` não existe em Postgres, então a leitura
  -- do valor vem numa segunda query — determinística porque só chega aqui
  -- quando existe exatamente uma row.
  select count(*)
    into v_link_count
    from public.bardo_account_links l
   where l.bardo_user_id = btrim(p_bardo_user_id)
     and l.link_status = 'active';

  if v_link_count <> 1 then
    return null;
  end if;

  select l.vi_user_id
    into v_vi_user_id
    from public.bardo_account_links l
   where l.bardo_user_id = btrim(p_bardo_user_id)
     and l.link_status = 'active'
   limit 1;

  if v_vi_user_id is null then
    return null;
  end if;

  return v_vi_user_id;
end;
$$;

-- Idem: helper interno das v2, owner-only.
revoke all on function public.bardo_link_vi_user_locked(text)
  from public, anon, authenticated, service_role;

comment on function public.bardo_link_vi_user_locked(text) is
  'CENAX-009A — resolve o vi_user_id de um bardo_user_id travando as rows de vínculo ativo '
  'existentes (FOR UPDATE) para serializar revogação concorrente. Exige exatamente um vínculo '
  'ativo; zero ou múltiplos devolvem NULL (fail closed). Não é predicate lock: inserções '
  'concorrentes de novos vínculos não são impedidas, e o mark linearize-se antes delas.';

-- ───────────────────────────────────────────────────────────────
-- bridge_mark_imported_v2
-- ───────────────────────────────────────────────────────────────

create or replace function public.bridge_mark_imported_v2(
  p_bridge_export_id uuid,
  p_bardo_user_id text
)
returns table (
  marked int,
  outcome text,
  export_status text,
  item_status text,
  terminal_preserved text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vi_user_id     uuid;
  v_owner          uuid;
  v_export_status  text;
  v_bridge_item_id uuid;
  v_item_status    text;
  v_result_marked  int := 0;
  v_terminal_preserved text := null;
  v_outcome        text;
begin
  -- 1. vínculo (primeiro lock; ponto de linearização)
  v_vi_user_id := public.bardo_link_vi_user_locked(p_bardo_user_id);
  if v_vi_user_id is null then
    return query select 0, 'forbidden'::text, null::text, null::text, null::text;
    return;
  end if;

  -- 2. export: lock + guard de destino
  select be.status, be.bridge_item_id
    into v_export_status, v_bridge_item_id
    from public.bridge_exports be
   where be.id = p_bridge_export_id
     and be.destination = 'bardo'
   for update;

  if not found then
    -- export inexistente: MESMO retorno de 'não é seu'. Sem oracle.
    return query select 0, 'forbidden'::text, null::text, null::text, null::text;
    return;
  end if;

  -- 3. ownership, antes de qualquer ramo de estado
  v_owner := public.bridge_export_owner_strict(p_bridge_export_id);
  if v_owner is null or v_owner <> v_vi_user_id then
    return query select 0, 'forbidden'::text, null::text, null::text, null::text;
    return;
  end if;

  -- ── daqui para baixo o caller é o dono comprovado; semântica da v1 ──

  -- 4. estado operacional inesperado → não processa
  if v_export_status not in ('pending', 'exported') then
    if v_bridge_item_id is not null then
      select bridge_status into v_item_status
        from public.bridge_items where id = v_bridge_item_id;
    end if;
    return query select 0, 'unexpected_state'::text, v_export_status, v_item_status, null::text;
    return;
  end if;

  -- 5. lock do item (se houver)
  if v_bridge_item_id is not null then
    select bridge_status into v_item_status
      from public.bridge_items where id = v_bridge_item_id
     for update;
  end if;

  -- 6. reconciliar export pending → exported
  if v_export_status = 'pending' then
    update public.bridge_exports
       set status = 'exported',
           exported_at = coalesce(exported_at, now())
     where id = p_bridge_export_id
       and status = 'pending';
    v_result_marked := 1;
    v_export_status := 'exported';
  end if;

  -- 7. atualizar bridge_item respeitando terminais
  if v_bridge_item_id is not null then
    if v_item_status = 'blocked' then
      v_terminal_preserved := 'blocked';
    elsif v_item_status = 'consumed' then
      null;
    else
      update public.bridge_items
         set bridge_status = 'consumed',
             consumed_at = coalesce(consumed_at, now())
       where id = v_bridge_item_id
         and bridge_status in ('draft', 'eligible', 'published');
      if found then
        v_result_marked := 1;
        v_item_status := 'consumed';
      end if;
    end if;
  end if;

  -- 8. outcome: replay legítimo do dono NUNCA vira 'forbidden'
  if v_terminal_preserved is not null then
    v_outcome := 'terminal_preserved';
  elsif v_result_marked > 0 then
    v_outcome := 'marked';
  else
    v_outcome := 'already_terminal';
  end if;

  return query select v_result_marked, v_outcome, v_export_status, v_item_status, v_terminal_preserved;
end;
$$;

revoke all on function public.bridge_mark_imported_v2(uuid, text) from public, anon, authenticated;
grant execute on function public.bridge_mark_imported_v2(uuid, text) to service_role;

comment on function public.bridge_mark_imported_v2(uuid, text) is
  'CENAX-009A — v2 de bridge_mark_imported com autorização horizontal. Resolve o vínculo ativo '
  'do p_bardo_user_id (sob lock) e o owner do export, e só marca quando coincidem. Fail closed. '
  'Caller não autorizado e export inexistente devolvem o mesmo shape (marked=0, forbidden).';

-- ───────────────────────────────────────────────────────────────
-- bridge_mark_rejected_v2
-- ───────────────────────────────────────────────────────────────

create or replace function public.bridge_mark_rejected_v2(
  p_bridge_export_id uuid,
  p_bardo_user_id text
)
returns table (
  marked int,
  outcome text,
  export_status text,
  item_status text,
  terminal_preserved text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vi_user_id     uuid;
  v_owner          uuid;
  v_export_status  text;
  v_bridge_item_id uuid;
  v_item_status    text;
  v_result_marked  int := 0;
  v_terminal_preserved text := null;
  v_outcome        text;
begin
  v_vi_user_id := public.bardo_link_vi_user_locked(p_bardo_user_id);
  if v_vi_user_id is null then
    return query select 0, 'forbidden'::text, null::text, null::text, null::text;
    return;
  end if;

  select be.status, be.bridge_item_id
    into v_export_status, v_bridge_item_id
    from public.bridge_exports be
   where be.id = p_bridge_export_id
     and be.destination = 'bardo'
   for update;

  if not found then
    return query select 0, 'forbidden'::text, null::text, null::text, null::text;
    return;
  end if;

  v_owner := public.bridge_export_owner_strict(p_bridge_export_id);
  if v_owner is null or v_owner <> v_vi_user_id then
    return query select 0, 'forbidden'::text, null::text, null::text, null::text;
    return;
  end if;

  if v_export_status not in ('pending', 'exported') then
    if v_bridge_item_id is not null then
      select bridge_status into v_item_status
        from public.bridge_items where id = v_bridge_item_id;
    end if;
    return query select 0, 'unexpected_state'::text, v_export_status, v_item_status, null::text;
    return;
  end if;

  if v_bridge_item_id is not null then
    select bridge_status into v_item_status
      from public.bridge_items where id = v_bridge_item_id
     for update;
  end if;

  if v_export_status = 'pending' then
    update public.bridge_exports
       set status = 'exported',
           exported_at = coalesce(exported_at, now())
     where id = p_bridge_export_id
       and status = 'pending';
    v_result_marked := 1;
    v_export_status := 'exported';
  end if;

  if v_bridge_item_id is not null then
    if v_item_status = 'consumed' then
      v_terminal_preserved := 'consumed';
    elsif v_item_status = 'blocked' then
      null;
    else
      update public.bridge_items
         set bridge_status = 'blocked',
             blocked_at = coalesce(blocked_at, now())
       where id = v_bridge_item_id
         and bridge_status in ('draft', 'eligible', 'published');
      if found then
        v_result_marked := 1;
        v_item_status := 'blocked';
      end if;
    end if;
  end if;

  if v_terminal_preserved is not null then
    v_outcome := 'terminal_preserved';
  elsif v_result_marked > 0 then
    v_outcome := 'marked';
  else
    v_outcome := 'already_terminal';
  end if;

  return query select v_result_marked, v_outcome, v_export_status, v_item_status, v_terminal_preserved;
end;
$$;

revoke all on function public.bridge_mark_rejected_v2(uuid, text) from public, anon, authenticated;
grant execute on function public.bridge_mark_rejected_v2(uuid, text) to service_role;

comment on function public.bridge_mark_rejected_v2(uuid, text) is
  'CENAX-009A — v2 de bridge_mark_rejected com autorização horizontal. Mesma cadeia de prova da '
  'v2 de imported. Fail closed. As v1 permanecem para o rollout faseado.';
