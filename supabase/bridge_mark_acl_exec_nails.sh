#!/usr/bin/env bash
# CENAX-009A-H9 — camada 2: EXECUÇÃO REAL das RPCs de mark, pelo vetor do defeito.
#
# Complementa `bridge_mark_acl_nails.sql` (camada 1, privilégio de catálogo).
# Aqui a chamada é feita via PostgREST — exatamente o caminho pelo qual o
# defeito foi explorado no diagnóstico:
#
#     authenticated (VoiceIdeas)
#       → POST /rest/v1/rpc/bridge_mark_imported
#       → export de OUTRA conta
#       → 200 {"marked":1,...}
#
# Critério deliberadamente tolerante (decisão do REVIEW):
#   - anon/authenticated: a chamada NÃO pode ter sucesso E o estado do export
#     deve permanecer inalterado. NÃO se exige um HTTP status específico — o
#     PostgREST já devolveu 401, 403 e 404 para o mesmo defeito de permissão,
#     dependendo do role e do estado do schema-cache.
#   - service_role: deve funcionar (compatibilidade com as fases F1–F3).
#
# Por que NÃO usa `SET ROLE` no psql
# ----------------------------------
# `SET ROLE <role>; SELECT <função sem EXECUTE>` faz o Postgres 17.6.1.106 da
# imagem Supabase local **segfaultar** (signal 11), derrubando o servidor antes
# de reportar `insufficient_privilege`. Reproduzível também com funções que não
# pertencem a esta frente (ex.: `bridge_identity_probe_by_email`), portanto é
# bug do ambiente, não do código. O servidor se recupera sozinho, mas o teste
# fica inútil. Via PostgREST a negação é limpa.
#
# Uso: ./supabase/bridge_mark_acl_exec_nails.sh [api-url] [publishable-key] [secret-key] [container]
set -uo pipefail

API="${1:-http://127.0.0.1:55321}"
PUBL="${2:-sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH}"
SECRET="${3:-sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz}"
DB="${4:-supabase_db_vi-local-c009}"

q() { docker exec -i "$DB" psql -U postgres -d postgres -Atc "$1" 2>&1; }

VI='00000000-0000-4000-8000-00000000ac01'
BARDO='bardo-user-acl-exec'
EMAIL='aclexec@lab.invalid'
PASS='AclExec!2026'
NOTE='00000000-0000-4000-8000-00000000ac02'
EXPORT='00000000-0000-4000-8000-00000000ac03'
FAILS=0

cleanup() {
  q "delete from public.bridge_exports where id='$EXPORT';
     delete from public.notes where id='$NOTE';
     delete from public.bardo_account_links where bardo_user_id='$BARDO';" >/dev/null 2>&1
  curl -s -X DELETE "$API/auth/v1/admin/users/$VI" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" >/dev/null 2>&1
}
trap cleanup EXIT
cleanup

echo "── setup ──"
curl -s -X POST "$API/auth/v1/admin/users" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" \
  -H 'Content-Type: application/json' \
  -d "{\"id\":\"$VI\",\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true}" >/dev/null
q "insert into public.bardo_account_links (vi_user_id, bardo_user_id, bardo_email, link_status)
   values ('$VI','$BARDO','$EMAIL','active');
   insert into public.notes (id, user_id, title, raw_text) values ('$NOTE','$VI','ACL-EXEC','x');
   insert into public.bridge_exports (id, content_type, note_id, destination, payload, status)
   values ('$EXPORT','note','$NOTE','bardo','{}'::jsonb,'pending');" >/dev/null

JWT=$(curl -s -X POST "$API/auth/v1/token?grant_type=password" -H "apikey: $PUBL" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')
[ -n "$JWT" ] || { echo "   não foi possível obter JWT do usuário de teste"; exit 1; }
echo "   usuário, vínculo e export pending criados"

state() { q "select status from public.bridge_exports where id='$EXPORT'" | tr -d '[:space:]'; }
reset_fixture() { q "update public.bridge_exports set status='pending', exported_at=null where id='$EXPORT'" >/dev/null; }

# deny <label> <auth-header> <fn> <payload>
deny() {
  local label="$1" auth="$2" fn="$3" payload="$4" before after code
  before=$(state)
  code=$(curl -s -o /tmp/acl_exec.out -w '%{http_code}' "$API/rest/v1/rpc/$fn" -X POST \
    -H "$auth" -H "apikey: $PUBL" -H 'Content-Type: application/json' -d "$payload")
  after=$(state)
  if [ "$code" -ge 400 ] && [ "$before" = "$after" ]; then
    printf '   EXEC PASS  %-38s DENY (HTTP %s, estado %s intacto)\n' "$label" "$code" "$after"
    return
  fi
  printf '   EXEC FAIL  %-38s HTTP %s, estado %s -> %s\n' "$label" "$code" "$before" "$after"
  FAILS=$((FAILS+1))
}

# allow <label> <fn> <payload>
allow() {
  local label="$1" fn="$2" payload="$3" code
  reset_fixture
  code=$(curl -s -o /tmp/acl_exec.out -w '%{http_code}' "$API/rest/v1/rpc/$fn" -X POST \
    -H "Authorization: Bearer $SECRET" -H "apikey: $SECRET" \
    -H 'Content-Type: application/json' -d "$payload")
  if [ "$code" -lt 400 ]; then
    printf '   EXEC PASS  %-38s OK (HTTP %s)\n' "$label" "$code"
    return
  fi
  printf '   EXEC FAIL  %-38s HTTP %s: %s\n' "$label" "$code" "$(head -c 120 /tmp/acl_exec.out)"
  FAILS=$((FAILS+1))
}

V1="{\"p_bridge_export_id\":\"$EXPORT\"}"
V2="{\"p_bridge_export_id\":\"$EXPORT\",\"p_bardo_user_id\":\"$BARDO\"}"

echo
echo "════ negação — anon / authenticated ════"
deny "authenticated -> v1 imported" "Authorization: Bearer $JWT"   bridge_mark_imported    "$V1"
deny "authenticated -> v1 rejected" "Authorization: Bearer $JWT"   bridge_mark_rejected    "$V1"
deny "anon          -> v1 imported" "Authorization: Bearer $PUBL"  bridge_mark_imported    "$V1"
deny "anon          -> v1 rejected" "Authorization: Bearer $PUBL"  bridge_mark_rejected    "$V1"
deny "authenticated -> v2 imported" "Authorization: Bearer $JWT"   bridge_mark_imported_v2 "$V2"
deny "authenticated -> v2 rejected" "Authorization: Bearer $JWT"   bridge_mark_rejected_v2 "$V2"
deny "anon          -> v2 imported" "Authorization: Bearer $PUBL"  bridge_mark_imported_v2 "$V2"
deny "anon          -> v2 rejected" "Authorization: Bearer $PUBL"  bridge_mark_rejected_v2 "$V2"
deny "authenticated -> helper link"  "Authorization: Bearer $JWT" bardo_link_vi_user_locked  "{\"p_bardo_user_id\":\"$BARDO\"}"
deny "authenticated -> helper owner" "Authorization: Bearer $JWT" bridge_export_owner_strict "{\"p_bridge_export_id\":\"$EXPORT\"}"

echo
echo "════ compatibilidade — service_role continua funcional ════"
allow "service_role  -> v1 imported" bridge_mark_imported    "$V1"
allow "service_role  -> v1 rejected" bridge_mark_rejected    "$V1"
allow "service_role  -> v2 imported" bridge_mark_imported_v2 "$V2"
allow "service_role  -> v2 rejected" bridge_mark_rejected_v2 "$V2"

echo
if [ "$FAILS" -eq 0 ]; then
  echo "════ CENAX-009A-H9 — CAMADA 2 OK (execução via PostgREST) ════"; exit 0
fi
echo "════ CENAX-009A-H9 — $FAILS FAIL(s) na camada 2 ════"; exit 1
