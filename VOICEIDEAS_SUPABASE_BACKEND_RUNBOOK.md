# VoiceIdeas Supabase Backend Runbook

## 1) Objetivo
Este documento descreve como operar o backend Supabase do VoiceIdeas com seguranca, como validar schema/functions, e como resolver os bloqueios mais comuns no ambiente remoto.

## 2) Premissas operacionais
- Projeto Supabase alvo padrao: `uhzwqhaxnodtshlvvikt`
- Este repo foi preparado para uso com Docker isolando credenciais.
- Nao considerar deploy de function como "schema pronto".
- Sempre validar migrations + functions + auth + RLS em conjunto.

## 3) Setup de credenciais (Docker first)

### 3.1 Arquivo de ambiente Docker
Arquivo: `.env.docker`

Campos relevantes:
- `SUPABASE_ACCESS_TOKEN`
- `GH_TOKEN` (opcional)
- `VERCEL_TOKEN` (opcional)
- `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` (opcional)

### 3.2 Entrar no shell Docker
```bash
npm run docker:shell
```

Dentro do container:
```bash
./scripts/docker-bootstrap.sh
```

## 4) Comandos principais de operacao

### 4.1 Link do projeto
```bash
bash scripts/supabase-link.sh
```

Ou manual:
```bash
npx supabase link --project-ref uhzwqhaxnodtshlvvikt
```

### 4.2 Aplicar migrations no remoto
```bash
npx supabase db push --linked
```

### 4.3 Deploy de functions
```bash
bash scripts/supabase-deploy-functions.sh
```

Deploy individual:
```bash
npx supabase functions deploy bridge-items --no-verify-jwt --project-ref uhzwqhaxnodtshlvvikt
npx supabase functions deploy export-to-cenax --no-verify-jwt --project-ref uhzwqhaxnodtshlvvikt
```

### 4.4 Enviar secrets
```bash
bash scripts/supabase-push-secrets.sh
```

Ou:
```bash
npx supabase secrets set --env-file supabase/functions.env --project-ref uhzwqhaxnodtshlvvikt
```

## 5) Variaveis de ambiente relevantes

### 5.1 Frontend (cliente)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Regra fixa:
- nao introduzir `VITE_OPENAI_API_KEY` (ou qualquer outra `VITE_*` com segredo) no frontend. Segredo OpenAI vive apenas em Edge Functions via `OPENAI_API_KEY`.
- historico: P0.3 fechado em 2026-05-09 — chave antiga revogada, chave nova so no backend.

### 5.2 Edge Functions
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `CENAX_BRIDGE_URL` e/ou `BARDO_BRIDGE_URL`
- `BRIDGE_SHARED_SECRET` (quando usar endpoint de secret compartilhado)

## 6) Schema bridge esperado (estado alvo)

### 6.1 `bridge_items`
Tabela catalogo, com RLS por `user_id`.
Campos centrais:
- origem (`source_type`, `source_id`, `source_capture_session_id`, `source_session_mode`)
- conteudo (`content_type`, `title`, `summary`, `content`, `payload`)
- governanca (`validation_status`, `validation_issues`, `bridge_status`)
- semantica (`destination_kind`, `destination_candidates`)
- ciclo (`published_at`, `consumed_at`, `blocked_at`, `created_at`, `updated_at`)

### 6.2 `bridge_exports`
Tabela de eventos de exportacao.
Campos centrais:
- `content_type`
- referencia de conteudo (`idea_draft_id` ou `note_id` ou `organized_idea_id`)
- `destination`
- `payload`
- `status`
- `validation_status`, `validation_issues`
- `error`, `exported_at`
- `bridge_item_id` (FK para `bridge_items`)

### 6.3 `user_settings`
Tabela de preferencia por usuario (inclui `bardo_bridge_enabled`).

## 7) Migrations bridge importantes no repo
- `202604160001_bridge_exports_safe_capture_v1.sql`
- `202604160002_bridge_items_catalog.sql`
- `202604160003_link_bridge_items_exports.sql`
- `202604160004_reconcile_bridge_schema_legacy.sql`
- `202604170001_bridge_items_blocked_at.sql`
- `202604170002_bridge_mark_rpcs.sql`
- `202604170003_bridge_mark_rpcs_fix_exported_at.sql`

## 8) Verificacao de backend (checklist)

### 8.1 Schema
- `bridge_items` existe
- `user_settings` existe
- `bridge_exports.bridge_item_id` existe
- constraints de status/content_type ativas
- indexes criticos ativos
- RLS e policies ativas

### 8.2 Functions
- `bridge-items` deployada e respondendo GET autenticado
- `export-to-cenax` deployada e processando `note`/`organized_idea`
- `bridge-exports` somente se ainda necessario no fluxo de consumo legado

### 8.3 SQL de smoke/e2e
Arquivos:
- `supabase/bridge_smoke_v5.sql`
- `supabase/bridge_verify_e2e.sql`

Uso:
```bash
supabase db query --linked --file supabase/bridge_smoke_v5.sql
supabase db query --linked --file supabase/bridge_verify_e2e.sql
```

## 9) Troubleshooting real conhecido

### 9.1 Supabase CLI retornando 403
Sintoma:
- `unexpected ... status 403`
- mensagem de falta de privilegio da conta

Diagnostico:
- token de acesso sem permissao para endpoint de management
- conta nao autorizada para projeto/org

Acoes:
1. verificar conta logada no CLI dentro do Docker
2. validar se o `SUPABASE_ACCESS_TOKEN` no `.env.docker` corresponde a conta correta
3. pedir acesso ao projeto na org Supabase
4. somente apos acesso, repetir:
- `npx supabase migration list --linked`
- `npx supabase functions list --project-ref ...`

### 9.2 Erro frontend "Sua sessao expirou"
Origem comum:
- token expirado/invalido ao chamar edge function

Arquivos para diagnostico:
- `src/lib/functionAuth.ts`
- `src/services/serviceAuth.ts`
- `src/utils/captureQueueErrorMessage.ts`

Acoes:
1. forcar novo login
2. confirmar refresh token funcional
3. inspecionar request para edge function (Authorization/apikey)
4. validar clock do dispositivo/sistema

## 10) Auth model nas edge functions
- `verify_jwt=false` em `supabase/config.toml`
- validacao real e feita em `_shared/auth.ts` com `client.auth.getUser()`
- requisicoes do frontend devem sempre enviar `Authorization: Bearer <jwt>` e `apikey`

Nota:
- `_shared/auth.ts` ainda aceita `x-supabase-auth`. Se essa compatibilidade nao for mais necessaria, planejar remocao controlada para endurecer superficie.

## 11) Operacao segura de release backend
1. atualizar migrations no branch
2. revisar diff de schema
3. executar `db push --linked`
4. deploy de functions
5. rodar smoke SQL
6. validar fluxo real no app (bridge-items + export-to-cenax)
7. registrar resultado com timestamp e commit hash
