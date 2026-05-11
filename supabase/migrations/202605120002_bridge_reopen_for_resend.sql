-- VI_BRIDGE.STATUS_AND_RESEND.1 — Reabrir um bridge_item terminal para reenvio.
--
-- Contexto:
--   Quando o Bardo importa um item, VI marca bridge_items.bridge_status='consumed'
--   (via bridge_mark_imported); quando rejeita, marca 'blocked' (via
--   bridge_mark_rejected). Esses dois estados são terminais — o Bardo
--   Inbox filtra eles via:
--     bridge_items.bridge_status NOT IN ('consumed', 'blocked')
--
--   Se o usuário quiser **reenviar** um item (porque foi apagado por engano no
--   Bardo, importação corrompida, etc.), uma nova row em bridge_exports
--   (status='pending') sozinha NÃO basta — o filtro do Inbox continua
--   excluindo o bridge_item. Precisamos reabrir o item para 'eligible' (ou
--   'published') de forma atômica e auditável.
--
-- Política desta RPC:
--   * Apenas itens em estado terminal são reabertos (consumed/blocked).
--   * draft/eligible/published não viram, são no-op.
--   * `consumed_at` / `blocked_at` são preservados como rastro histórico.
--   * `bridge_status` volta para 'eligible' (o estado "pronto para o catálogo
--     entregar nova tentativa"). 'published' seria pra um futuro lifecycle
--     de "já publicado mas ainda não consumido" — não temos esse caminho ativo.
--   * Idempotente: chamar 2x num item já 'eligible' não erra, só não faz nada.
--
-- Auth:
--   service_role apenas (caminho pelos service clients das EFs).
--
-- Auditoria:
--   Histórico em bridge_exports nunca é apagado. Cada reenvio cria nova row.
--   consumed_at/blocked_at do bridge_item ficam intactos para mostrar
--   "este item já tinha sido importado em <data>" na UI.

create or replace function public.bridge_reopen_for_resend(p_bridge_item_id uuid)
returns table (
  reopened int,
  previous_status text,
  new_status text,
  previous_consumed_at timestamptz,
  previous_blocked_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_status text;
  v_prev_consumed_at timestamptz;
  v_prev_blocked_at timestamptz;
  v_new_status text;
  v_reopened int := 0;
begin
  -- 1. Lock do item.
  select bi.bridge_status, bi.consumed_at, bi.blocked_at
    into v_prev_status, v_prev_consumed_at, v_prev_blocked_at
    from public.bridge_items bi
   where bi.id = p_bridge_item_id
   for update;

  if not found then
    return query select 0, null::text, null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- 2. Só reabre se está terminal. Para outros estados, no-op.
  if v_prev_status in ('consumed', 'blocked') then
    update public.bridge_items
       set bridge_status = 'eligible',
           updated_at = now()
     where id = p_bridge_item_id
       and bridge_status in ('consumed', 'blocked');
    v_reopened := 1;
    v_new_status := 'eligible';
  else
    -- draft / eligible / published: no-op. Ainda retorna estado atual.
    v_new_status := v_prev_status;
  end if;

  return query select v_reopened, v_prev_status, v_new_status, v_prev_consumed_at, v_prev_blocked_at;
end;
$$;

revoke all on function public.bridge_reopen_for_resend(uuid) from public;
grant execute on function public.bridge_reopen_for_resend(uuid) to service_role;

comment on function public.bridge_reopen_for_resend(uuid) is
  'VI_BRIDGE.STATUS_AND_RESEND.1 — Reabre um bridge_item terminal (consumed/blocked) '
  'para eligible, permitindo um novo ciclo de export/inbox. Preserva consumed_at e '
  'blocked_at como rastro histórico. Idempotente. service_role apenas.';
