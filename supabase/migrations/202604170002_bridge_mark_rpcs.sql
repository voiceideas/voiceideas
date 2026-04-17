-- RPCs transacionais para o consumidor Bardo marcar exports da bridge.
--
-- Garantias (mini-PLAN v5):
--   1. Atomicidade: cada RPC roda em uma única transação PL/pgSQL.
--      `FOR UPDATE` em bridge_exports e bridge_items garante consistência
--      sob concorrência.
--   2. Preservação de terminal: 'consumed' nunca vira 'blocked' e vice-versa.
--   3. Estado operacional inesperado (exporting/failed) → não processa,
--      marked=0, sem efeito.
--   4. Guard de destino: destination != 'bardo' → marked=0, sem efeito.
--   5. Idempotência: repetir mark em row já terminal → marked=0, sem erro.
--   6. Reconciliação: se export já 'exported' mas item não terminal válido,
--      atualiza só o item (caso raro de drift).
--
-- Permissões: service_role apenas. A EF VI (service client) chama via rpc().

-- ───────────────────────────────────────────────────────────────
-- bridge_mark_imported
-- ───────────────────────────────────────────────────────────────

create or replace function public.bridge_mark_imported(p_bridge_export_id uuid)
returns table (
  marked int,
  export_status text,
  item_status text,
  terminal_preserved text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_export_status text;
  v_bridge_item_id uuid;
  v_item_status text;
  v_result_marked int := 0;
  v_terminal_preserved text := null;
begin
  -- 1. Lock do export; guard destination.
  select be.status, be.bridge_item_id
    into v_export_status, v_bridge_item_id
    from public.bridge_exports be
   where be.id = p_bridge_export_id
     and be.destination = 'bardo'
   for update;

  if not found then
    return query select 0, null::text, null::text, null::text;
    return;
  end if;

  -- 2. Estado operacional inesperado → não processa.
  if v_export_status not in ('pending', 'exported') then
    if v_bridge_item_id is not null then
      select bridge_status into v_item_status
        from public.bridge_items where id = v_bridge_item_id;
    end if;
    return query select 0, v_export_status, v_item_status, null::text;
    return;
  end if;

  -- 3. Lock do item (se houver).
  if v_bridge_item_id is not null then
    select bridge_status into v_item_status
      from public.bridge_items where id = v_bridge_item_id
     for update;
  end if;

  -- 4. Reconciliar export pending → exported.
  if v_export_status = 'pending' then
    update public.bridge_exports
       set status = 'exported'
     where id = p_bridge_export_id
       and status = 'pending';
    v_result_marked := 1;
    v_export_status := 'exported';
  end if;

  -- 5. Atualizar bridge_item respeitando terminais.
  if v_bridge_item_id is not null then
    if v_item_status = 'blocked' then
      -- TERMINAL OPOSTO: preservar. NÃO sobrescrever.
      v_terminal_preserved := 'blocked';
    elsif v_item_status = 'consumed' then
      -- TERMINAL CORRETO: idempotência pura; não mexe em consumed_at.
      null;
    else
      -- Transição válida: draft/eligible/published → consumed.
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

  return query select v_result_marked, v_export_status, v_item_status, v_terminal_preserved;
end;
$$;

revoke all on function public.bridge_mark_imported(uuid) from public;
grant execute on function public.bridge_mark_imported(uuid) to service_role;

comment on function public.bridge_mark_imported(uuid) is
  'RPC transacional: marca um bridge_export como exported + seu bridge_item como consumed. Preserva terminal oposto (blocked). Idempotente. Guard destination=bardo.';

-- ───────────────────────────────────────────────────────────────
-- bridge_mark_rejected
-- ───────────────────────────────────────────────────────────────

create or replace function public.bridge_mark_rejected(p_bridge_export_id uuid)
returns table (
  marked int,
  export_status text,
  item_status text,
  terminal_preserved text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_export_status text;
  v_bridge_item_id uuid;
  v_item_status text;
  v_result_marked int := 0;
  v_terminal_preserved text := null;
begin
  -- 1. Lock do export; guard destination.
  select be.status, be.bridge_item_id
    into v_export_status, v_bridge_item_id
    from public.bridge_exports be
   where be.id = p_bridge_export_id
     and be.destination = 'bardo'
   for update;

  if not found then
    return query select 0, null::text, null::text, null::text;
    return;
  end if;

  -- 2. Estado operacional inesperado → não processa.
  if v_export_status not in ('pending', 'exported') then
    if v_bridge_item_id is not null then
      select bridge_status into v_item_status
        from public.bridge_items where id = v_bridge_item_id;
    end if;
    return query select 0, v_export_status, v_item_status, null::text;
    return;
  end if;

  -- 3. Lock do item (se houver).
  if v_bridge_item_id is not null then
    select bridge_status into v_item_status
      from public.bridge_items where id = v_bridge_item_id
     for update;
  end if;

  -- 4. Reconciliar export pending → exported.
  if v_export_status = 'pending' then
    update public.bridge_exports
       set status = 'exported'
     where id = p_bridge_export_id
       and status = 'pending';
    v_result_marked := 1;
    v_export_status := 'exported';
  end if;

  -- 5. Atualizar bridge_item respeitando terminais.
  if v_bridge_item_id is not null then
    if v_item_status = 'consumed' then
      -- TERMINAL OPOSTO: preservar.
      v_terminal_preserved := 'consumed';
    elsif v_item_status = 'blocked' then
      -- TERMINAL CORRETO: idempotência pura; não mexe em blocked_at.
      null;
    else
      -- Transição válida: draft/eligible/published → blocked.
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

  return query select v_result_marked, v_export_status, v_item_status, v_terminal_preserved;
end;
$$;

revoke all on function public.bridge_mark_rejected(uuid) from public;
grant execute on function public.bridge_mark_rejected(uuid) to service_role;

comment on function public.bridge_mark_rejected(uuid) is
  'RPC transacional: marca um bridge_export como exported + seu bridge_item como blocked. Preserva terminal oposto (consumed). Idempotente. Guard destination=bardo.';
