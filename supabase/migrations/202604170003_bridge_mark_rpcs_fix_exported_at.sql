-- Correção: RPCs bridge_mark_imported/rejected precisam setar exported_at
-- junto com status='exported' para satisfazer a constraint:
--   bridge_exports_exported_at_required_when_exported
--   CHECK ((status <> 'exported') OR (exported_at IS NOT NULL))
--
-- Mudança: adiciona `exported_at = now()` em TODOS os UPDATE de
-- bridge_exports.status que transicionam para 'exported'.
--
-- CREATE OR REPLACE — idempotente.

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

  if v_export_status not in ('pending', 'exported') then
    if v_bridge_item_id is not null then
      select bridge_status into v_item_status
        from public.bridge_items where id = v_bridge_item_id;
    end if;
    return query select 0, v_export_status, v_item_status, null::text;
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

  return query select v_result_marked, v_export_status, v_item_status, v_terminal_preserved;
end;
$$;

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

  if v_export_status not in ('pending', 'exported') then
    if v_bridge_item_id is not null then
      select bridge_status into v_item_status
        from public.bridge_items where id = v_bridge_item_id;
    end if;
    return query select 0, v_export_status, v_item_status, null::text;
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

  return query select v_result_marked, v_export_status, v_item_status, v_terminal_preserved;
end;
$$;
