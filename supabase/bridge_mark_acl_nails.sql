-- CENAX-009A-H9 — nails de ACL das RPCs de mark.
--
-- Requisito de segurança travado aqui:
--   anon/authenticated NÃO executam v1 nem v2;
--   service_role continua executando v1 (fases F1–F3 do rollout) e v2;
--   os helpers internos das v2 são owner-only.
--
-- Duas camadas, deliberadas
-- -------------------------
--   camada 1 — PRIVILÉGIO (este arquivo): `has_function_privilege()`, a forma
--              canônica do Postgres para perguntar "este role pode executar?".
--              Determinística, não executa a função, não depende de exposição
--              REST nem de schema-cache do PostgREST.
--   camada 2 — EXECUÇÃO REAL: vive em `bridge_mark_acl_exec_nails.sh`, com
--              uma sessão psql por role. Exige apenas "a chamada não teve
--              sucesso" + "o DB não mudou" — nunca um código de erro
--              específico (o PostgREST já devolveu 401, 403 e 404 para o mesmo
--              defeito de permissão, dependendo de role e cache).
--
-- Por que a checagem de execução NÃO está aqui
-- --------------------------------------------
-- A primeira versão deste arquivo usava `SET LOCAL ROLE` dentro de blocos
-- `BEGIN … EXCEPTION` do PL/pgSQL para capturar `insufficient_privilege`.
-- Esse padrão fez o Postgres 17.6 **segfaultar** (signal 11, servidor
-- reiniciado com recuperação automática) de forma reproduzível. Trocar de role
-- dentro de uma subtransação com handler de exceção não é seguro nesta versão.
-- A verificação de execução foi movida para sessões psql separadas, onde a
-- troca de role é feita no nível da sessão e o erro é tratado pelo cliente.
--
-- Executar contra banco de LABORATÓRIO. Somente leitura de catálogo.
--
--   docker exec -i <db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/bridge_mark_acl_nails.sql

\set ON_ERROR_STOP on

do $nails$
declare
  fails int := 0;
  r record;
begin
  ------------------------------------------------------------------
  -- RPCs públicas de mark: sem anon, sem authenticated, com service_role
  ------------------------------------------------------------------
  for r in
    select f,
           has_function_privilege('anon',          f, 'EXECUTE') as anon_x,
           has_function_privilege('authenticated', f, 'EXECUTE') as auth_x,
           has_function_privilege('service_role',  f, 'EXECUTE') as svc_x
      from (values
        ('public.bridge_mark_imported(uuid)'),
        ('public.bridge_mark_rejected(uuid)'),
        ('public.bridge_mark_imported_v2(uuid,text)'),
        ('public.bridge_mark_rejected_v2(uuid,text)')
      ) t(f)
  loop
    if (not r.anon_x) and (not r.auth_x) and r.svc_x then
      raise notice 'ACL-1 PASS  %  anon=f authenticated=f service_role=t', rpad(r.f, 42);
    else
      fails := fails + 1;
      raise warning 'ACL-1 FAIL  %  anon=% authenticated=% service_role=%',
        r.f, r.anon_x, r.auth_x, r.svc_x;
    end if;
  end loop;

  ------------------------------------------------------------------
  -- Helpers internos das v2: owner-only (nem service_role).
  --
  -- As v2 são SECURITY DEFINER e rodam como o owner, que tem EXECUTE por ser
  -- dono — então não é preciso conceder os helpers a ninguém. Provado em
  -- laboratório: service_role chama a v2 normalmente com os helpers fechados.
  ------------------------------------------------------------------
  for r in
    select f,
           has_function_privilege('anon',          f, 'EXECUTE') as anon_x,
           has_function_privilege('authenticated', f, 'EXECUTE') as auth_x,
           has_function_privilege('service_role',  f, 'EXECUTE') as svc_x
      from (values
        ('public.bardo_link_vi_user_locked(text)'),
        ('public.bridge_export_owner_strict(uuid)')
      ) t(f)
  loop
    if (not r.anon_x) and (not r.auth_x) and (not r.svc_x) then
      raise notice 'ACL-2 PASS  %  owner-only (least privilege)', rpad(r.f, 42);
    else
      fails := fails + 1;
      raise warning 'ACL-2 FAIL  %  anon=% authenticated=% service_role=%',
        r.f, r.anon_x, r.auth_x, r.svc_x;
    end if;
  end loop;

  ------------------------------------------------------------------
  -- Guard adicional: PUBLIC não pode ter EXECUTE em nenhuma das seis.
  ------------------------------------------------------------------
  for r in
    select p.proname as f,
           coalesce(array_to_string(p.proacl, ' | '), 'DEFAULT') as acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('bridge_mark_imported','bridge_mark_rejected',
                         'bridge_mark_imported_v2','bridge_mark_rejected_v2',
                         'bardo_link_vi_user_locked','bridge_export_owner_strict')
     order by p.proname
  loop
    -- ACL nulo significa "default": todo mundo herda EXECUTE. Nenhuma destas
    -- funções pode estar nesse estado.
    if r.acl <> 'DEFAULT' and r.acl not like '=X%' and r.acl not like '%|=X%' then
      raise notice 'ACL-3 PASS  %  sem EXECUTE para PUBLIC', rpad(r.f, 42);
    else
      fails := fails + 1;
      raise warning 'ACL-3 FAIL  %  acl=%', r.f, r.acl;
    end if;
  end loop;

  if fails > 0 then
    raise exception 'CENAX-009A-H9 ACL nails: % FAIL(s)', fails;
  end if;
  raise notice '════ CENAX-009A-H9 — NAILS DE PRIVILÉGIO OK (camada 1) ════';
end
$nails$;
