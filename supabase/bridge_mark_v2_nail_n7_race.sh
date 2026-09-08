#!/usr/bin/env bash
# CENAX-009A — N7: revogação de vínculo CONCORRENTE com o mark.
#
# Prova o ponto de linearização declarado na migration v2: as rows de vínculo
# ATIVAS EXISTENTES são travadas com FOR UPDATE antes da decisão. Uma revogação
# que commita durante o mark faz a RPC NEGAR — e não autorizar com base num
# snapshot anterior.
#
# Precisa de DUAS sessões reais, então não cabe num único arquivo .sql:
#
#   sessão 1 (revoker): BEGIN; UPDATE link -> revoked   (segura o lock)
#   sessão 2 (mark):    bridge_mark_imported_v2(...)    (bloqueia no FOR UPDATE)
#   sessão 1:           COMMIT                          (libera)
#   sessão 2:           destrava, re-avalia o predicado sob EvalPlanQual, NEGA
#
# Sem o FOR UPDATE, a sessão 2 leria o snapshot READ COMMITTED anterior à
# revogação e AUTORIZARIA o mark — que é exatamente o furo que a v2 fecha.
#
# Uso:  ./supabase/bridge_mark_v2_nail_n7_race.sh <container-postgres>
# Fixtures são criadas e removidas pelo próprio script.
set -euo pipefail

DB="${1:-supabase_db_vi-local-c009}"
psql() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

VI='00000000-0000-4000-8000-00000000a701'
BARDO='bardo-user-n7'
NOTE='00000000-0000-4000-8000-00000000b701'
EXPORT='00000000-0000-4000-8000-00000000c701'

cleanup() {
  psql -Atc "
    delete from public.bridge_exports where id='$EXPORT';
    delete from public.notes where id='$NOTE';
    delete from public.bardo_account_links where bardo_user_id='$BARDO';
    delete from auth.users where id='$VI';
  " >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "── setup ──"
cleanup
psql -Atc "
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values ('$VI','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          'n7@lab.invalid','',now(),now(),now());
  insert into public.bardo_account_links (vi_user_id, bardo_user_id, bardo_email, link_status)
  values ('$VI','$BARDO','n7@lab.invalid','active');
  insert into public.notes (id, user_id, title, raw_text) values ('$NOTE','$VI','N7','x');
  insert into public.bridge_exports (id, content_type, note_id, destination, payload, status)
  values ('$EXPORT','note','$NOTE','bardo','{}'::jsonb,'pending');
" >/dev/null
echo "   vínculo ativo + export pending criados"

echo "── sessão 1: BEGIN + UPDATE link -> revoked (segura o lock) ──"
FIFO=$(mktemp -u); mkfifo "$FIFO"
docker exec -i "$DB" psql -U postgres -d postgres -Atq < "$FIFO" > /tmp/n7_revoker.out 2>&1 &
REVOKER=$!
exec 3>"$FIFO"
printf "begin;\nupdate public.bardo_account_links set link_status='revoked', revoked_at=now() where bardo_user_id='%s';\n" "$BARDO" >&3
sleep 2
echo "   lock adquirido pela sessão 1"

echo "── sessão 2: mark concorrente (deve BLOQUEAR) ──"
docker exec -i "$DB" psql -U postgres -d postgres -Atc \
  "select outcome from public.bridge_mark_imported_v2('$EXPORT','$BARDO')" > /tmp/n7_mark.out 2>&1 &
MARK=$!
sleep 2
if kill -0 "$MARK" 2>/dev/null; then
  echo "   ✓ mark BLOQUEADO no FOR UPDATE (esperado)"
else
  echo "   ✗ mark NÃO bloqueou — o lock do vínculo não está sendo adquirido"
fi

echo "── sessão 1: COMMIT (libera) ──"
printf "commit;\n" >&3
exec 3>&-
wait "$REVOKER" 2>/dev/null || true
wait "$MARK" 2>/dev/null || true
rm -f "$FIFO"

OUTCOME=$(tr -d '[:space:]' < /tmp/n7_mark.out)
STATUS=$(psql -Atc "select status from public.bridge_exports where id='$EXPORT'" | tr -d '[:space:]')

echo
echo "── veredito N7 ──"
echo "   outcome da RPC   = ${OUTCOME:-<vazio>}"
echo "   status do export = $STATUS"
if [ "$OUTCOME" = "forbidden" ] && [ "$STATUS" = "pending" ]; then
  echo "   N7 PASS ✅ revogação concorrente negou o mark; export intacto"
  exit 0
fi
echo "   N7 FAIL ❌ esperado forbidden + pending"
exit 1
