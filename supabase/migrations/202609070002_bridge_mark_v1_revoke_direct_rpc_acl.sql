-- CENAX-009A-H9 — fecha o acesso DIRETO de anon/authenticated às RPCs v1 de mark.
--
-- Finding (provado em laboratório, pela API real)
-- -----------------------------------------------
--   authenticated (VoiceIdeas)
--     → POST /rest/v1/rpc/bridge_mark_imported
--     → export de OUTRA conta
--     → 200 {"marked":1,"export_status":"exported","item_status":"consumed"}
--
-- É o mesmo defeito de autorização horizontal de CENAX-009A (H1), por um
-- caminho que NÃO passa pelo Bardo: o usuário fala direto com o PostgREST do
-- VoiceIdeas. Corrigir apenas a Edge Function `bridge-exports` deixaria esta
-- porta aberta. A hipótese H9 ("RPCs de mark inalcançáveis via PostgREST")
-- estava, portanto, ERRADA.
--
-- Causa
-- -----
-- `202604170002_bridge_mark_rpcs.sql` fez:
--
--     revoke all on function ... from public;
--     grant execute on function ... to service_role;
--
-- `REVOKE ... FROM PUBLIC` remove o pseudo-role PUBLIC, mas NÃO remove grants
-- explícitos concedidos a roles nomeados. E toda função criada por `postgres`
-- no schema `public` nasce com EXECUTE para `anon` e `authenticated`, por
-- conta da default privilege padrão da plataforma Supabase:
--
--     pg_default_acl: owner=postgres schema=public
--                     acl = postgres=X , anon=X , authenticated=X , service_role=X
--
-- Resultado: o ACL efetivo das v1 ficou
--     postgres=X | anon=X | authenticated=X | service_role=X
--
-- Escopo desta migration
-- ----------------------
-- APENAS as duas RPCs v1. As funções criadas em
-- `202609070001_bridge_mark_rpcs_v2_owner_binding.sql` já nascem fechadas na
-- própria declaração — não são tocadas aqui.
--
-- Deliberadamente SEPARADA da migration de owner-binding v2: um eventual
-- rollback do rollout v2 não pode reabrir a v1 para `anon`/`authenticated`.
-- Cada migration corresponde a uma decisão aprovada.
--
-- Quem continua podendo executar
-- ------------------------------
--   owner/postgres  — dono das funções; necessário para smokes SQL e operação
--   service_role    — único chamador de produção (a EF `bridge-exports` usa
--                     `createClient(url, SERVICE_ROLE_KEY)`), e o caminho do
--                     cliente antigo durante as fases F1–F3 do rollout
--
-- Nenhum caller legítimo depende de `anon` ou `authenticated`: o Bardo não
-- invoca estas RPCs em lugar nenhum, e os arquivos `bridge_smoke_v5.sql` /
-- `bridge_verify_e2e.sql` rodam no psql como `postgres`.
--
-- Idempotência
-- ------------
-- `REVOKE` de um privilégio que já não existe é no-op silencioso. Se o
-- ambiente de destino já estiver fechado, esta migration não altera nada.
--
-- NÃO faz parte desta migration (registrado, deliberadamente fora de escopo):
--   `bridge_reopen_for_resend` e outras funções SECURITY DEFINER com ACL
--   aberto. Grant aberto não é, por si, vulnerabilidade — o que importa é o
--   que um chamador direto consegue alterar. Investigação própria, sob o
--   débito CENAX-009A-D2.

revoke execute on function public.bridge_mark_imported(uuid)
  from public, anon, authenticated;

revoke execute on function public.bridge_mark_rejected(uuid)
  from public, anon, authenticated;

comment on function public.bridge_mark_imported(uuid) is
  'RPC transacional: marca um bridge_export como exported + seu bridge_item como consumed. '
  'Preserva terminal oposto (blocked). Idempotente. Guard destination=bardo. '
  'CENAX-009A-H9: EXECUTE apenas para owner e service_role — chamada direta por '
  'anon/authenticated pelo PostgREST permitia marcar export de outra conta. '
  'NÃO tem binding de identidade: use bridge_mark_imported_v2 nos caminhos novos.';

comment on function public.bridge_mark_rejected(uuid) is
  'RPC transacional: marca um bridge_export como exported + seu bridge_item como blocked. '
  'Preserva terminal oposto (consumed). Idempotente. Guard destination=bardo. '
  'CENAX-009A-H9: EXECUTE apenas para owner e service_role. '
  'NÃO tem binding de identidade: use bridge_mark_rejected_v2 nos caminhos novos.';
