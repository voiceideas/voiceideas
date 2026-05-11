# `VOICEIDEAS_CURRENT_STATE.md`

## 1) Estado operacional atual (fonte única de verdade)

**Projeto Supabase ativo:**
`uhzwqhaxnodtshlvvikt` 

**Ambiente padrão de operação:**

* Docker obrigatório (`npm run docker:shell`) 
* Node 22
* CLI Supabase via container

---

## 2) Backend — status real

### 2.1 Functions esperadas (bridge)

* `bridge-items` → catálogo autenticado
* `export-to-cenax` → exportação canônica

Origem: 

**Estado esperado:**

* deployadas
* acessíveis com JWT válido
* operando via `_shared/auth.ts`

---

### 2.2 Functions pipeline captura

* `ingest-capture-session`
* `segment-audio-session`
* `transcribe-chunk`
* `materialize-idea`

Origem: 

**Estado esperado:**

* pipeline completo funcional
* sem dependência de cliente para processamento crítico

---

## 3) Banco de dados — estado esperado

### Tabelas críticas (devem existir)

* `capture_sessions`
* `audio_chunks`
* `notes`
* `organized_ideas`
* `bridge_items`
* `bridge_exports`
* `user_settings`
* `bardo_account_links` (fonte de autoridade de identidade VI↔Bardo a partir de P1.3)

Origem: 

---

### Relação obrigatória

* `bridge_exports.bridge_item_id → bridge_items.id`

---

### Status semântico (não alterar)

#### bridge_items

* `draft`
* `eligible`
* `published`
* `consumed`
* `blocked`

#### bridge_exports

* `pending`
* `exporting`
* `exported`
* `failed`

Origem: 

---

## 4) Bridge v1 — estado atual

### Caminho canônico (válido)

* `export-to-cenax`
* `bridge-items`
* payload: `voiceideas.bridge-export.v1`

---

### Caminho legado (EXISTE, MAS NÃO É FONTE DE VERDADE)

* `bridge-exports` (endpoint antigo)
* uso de `owner_email` / `content_hash`

**Status:**

* ainda presente
* deve ser removido ou isolado

Origem: 

---

### 4.3) P1.4 — Produtor de `bardo_account_links` (2026-04-17, hardening 2026-05-10)

Após P1.3 endurecer o consumer legado, o VI passou a ter **produtor real** do vínculo explícito. A âncora de identidade é `bardo_user_id` (opaco, fornecido pelo Bardo) — email deixou de ser identidade mesmo no aceite.

**Edge function: `supabase/functions/link-bardo-account`**

* Self-managed JWT (`verify_jwt=false` + `requireAuthenticatedRequest`) — mesma convenção das outras funções autenticadas do projeto.
* `GET /link-bardo-account` → retorna `{ ok: true, linked: boolean, link_status: 'active'|null, link: BardoAccountLink|null }` do usuário VI autenticado.
* `POST /link-bardo-account` body `{ bardo_user_id, bardo_email? }` → upsert idempotente. Resposta: `{ ok: true, linked: true, link_status: 'active', link, created, updated }`. Se já existia outro vínculo ativo para o mesmo `vi_user_id` com `bardo_user_id` diferente, ele é revogado antes de criar o novo (1 vínculo ativo por usuário VI por vez).
* `POST /link-bardo-account` body `{ action: 'revoke' }` → revoga todos os vínculos ativos. Resposta: `{ ok: true, linked: false, link_status: 'revoked', revoked: <n> }`.
* `vi_user_id` sempre vem de `auth.uid()` — **nunca** do body. Evita cross-user linking.
* Registrada em `supabase/config.toml` e em `scripts/check-sensitive-functions-jwt.mjs`.
* **Hardening 2026-05-10 (A.2.VI / SYSFIX.LINK.1):** contrato de resposta passou a ser superset — mantém os campos antigos (`link`, `created`, `updated`, `revoked`) para retrocompat com `bardoAccountLinkService` e adiciona `ok`, `linked`, `link_status` para callers externos (ex.: Bardo). Smoke tests no remoto confirmaram 401 sem Authorization e 401 com Bearer inválido.
* **VI_LINK.AUTO_ACCOUNT_LINK (2026-05-10):** página web `/connect-bardo` implementada (`src/pages/ConnectBardo.tsx`, registrada em `src/App.tsx` como rota pública fora do `ProtectedLayout`). O Bardo, após `bridge-identity-check` retornar `connected`, redireciona o usuário para essa rota com query params `bardo_user_id` (obrigatório), `bardo_email` (opcional), `return_url`/`callback_url` (opcional, validado por allowlist `https://obardo.app` + localhost em DEV), `state` (opcional, ≤256 chars). Se usuário VI não está logado, a página dispara `signInWithEmail`/`signInWithGoogle` com redirect de retorno apontando para `/connect-bardo` com os mesmos params, e retoma o upsert ao voltar autenticado. Quando logado, a página chama `upsertBardoAccountLink({ bardoUserId, bardoEmail })`, que invoca `POST /functions/v1/link-bardo-account` com JWT VI do usuário. Sucesso: redireciona pro callback com `voiceideas_link=success` (preservando `state`), ou mostra confirmação local. Erro: `voiceideas_link=missing_bardo_user_id` se faltar id; `voiceideas_link=error` se EF falhar; sem callback no allowlist, mostra mensagem local. Helper `src/lib/bardoCallback.ts` implementa `isAllowedBardoCallback`, `buildBardoCallbackUrl` e `normalizeBardoState` — bloqueia open-redirect e schemes não-http. Não há JWT em URL, não há service role no cliente, idempotência segue garantida pela EF.

**Camada cliente (React)**

* `src/services/bardoAccountLinkService.ts` — wrapper sobre `invokeAuthenticatedFunction`; expõe `getActiveBardoAccountLink`, `upsertBardoAccountLink`, `revokeBardoAccountLinks`.
* `src/hooks/useBardoAccountLink.ts` — hook com estado `{ link, loading, saving, error, isLinked }` + `linkAccount` / `revokeAccount` / `refresh`.
* `src/components/BardoConnectionToggle.tsx` — expandido: ativar o toggle abre formulário inline pedindo `bardo_user_id` (obrigatório) + `bardo_email` (opcional, só auditoria). Salvar invoca `linkAccount` + `onToggle(true)`. Desativar chama `revokeAccount` + `onToggle(false)`. Visibilidade "ativa" agora depende de `enabled && isLinked`.

**Âncora de identidade**

* `bardo_account_links.bardo_user_id` (text, opaco).
* `user_settings.bardo_bridge_enabled` continua existindo como flag de consentimento local, mas **não é identidade**.
* `owner_email` em `bridge_exports` segue no schema, **não é autorização**.

**Risco residual**

* `bardo_user_id` real ainda precisa vir do Bardo via handshake/OAuth — hoje o user digita manualmente o ID que ele mesmo lê no próprio Bardo. Para o E2E completo da ponte, o Bardo precisa expor esse ID ao usuário (ou o VI precisa buscar via API do Bardo). Até lá, o fluxo é manual mas seguro.

### 4.2) P1.3 — Account linking explícito VI ↔ Bardo (2026-04-17)

A partir desta mudança a ponte deixou de assumir identidade implícita por email. Foi introduzida a tabela `public.bardo_account_links` como **fonte de autoridade** para o mapeamento `bardo_user_id → vi_user_id`.

**Tabela nova: `public.bardo_account_links`**

* `id uuid PK`
* `vi_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
* `bardo_user_id text NOT NULL` — identificador opaco fornecido pelo Bardo
* `bardo_email text NULL` — snapshot de auditoria, **não** autoriza nada
* `link_status text NOT NULL` — `'active'` ou `'revoked'`
* `linked_at`, `revoked_at`, `created_at`, `updated_at`
* Unique parcial `(vi_user_id, bardo_user_id) WHERE link_status='active'` — 1 vínculo ativo por par
* RLS: usuário VI só vê/gerencia os próprios vínculos; service_role bypassa
* Migration: `supabase/migrations/202604170006_bardo_account_links.sql`

**Consumer legado endurecido: `supabase/functions/bridge-exports`**

* `GET /bridge-exports` agora **exige** `bardo_user_id` na query; `email` virou parâmetro opcional de auditoria.
* Antes de listar exports, o endpoint resolve vínculo ativo via `getActiveBardoAccountLink()` em `_shared/bardo-account-link.ts`.
* Sem vínculo ativo → **403** com código `account_link_required`.
* Filtro do listing mudou de `.eq('owner_email', email)` para `.eq('owner_user_id', link.vi_user_id)`.
* `owner_email` continua no schema legado, mas não é mais base de autorização.

**Regra operacional**

* O aceite no `BardoConnectionToggle` (ou equivalente) precisa passar a persistir um row em `bardo_account_links` com o `bardo_user_id` emitido pelo Bardo. Enquanto isso não existir, o path legacy recusa todos os consumos — que é exatamente o comportamento desejado para fechar o risco de email-as-implicit-identity.

### 4.1) P0.1 — isolamento do legado (2026-04-17)

Marcação visível aplicada nos 3 arquivos legados com o banner `LEGACY BRIDGE PATH — NÃO USAR PARA NOVOS FLUXOS / CAMINHO CANÔNICO = export-to-cenax + bridge-items`:

* `src/lib/bridgeExport.ts` — JSDoc header reforçado.
* `src/components/SendToBardoModal.tsx` — JSDoc header reforçado. Grep em `src/` confirma que este modal **não é montado em nenhuma tela ativa** (única definição, zero imports além do próprio arquivo).
* `supabase/functions/bridge-exports/index.ts` — JSDoc header reforçado. Continua aceitando `x-bridge-secret` para o consumidor Bardo legado.

Notas curtas adicionadas em `src/pages/Notes.tsx` e `src/pages/Organized.tsx` clarificando que a bridge UI canônica é renderizada via `NoteCard`/`OrganizedView` → `SafeCaptureBridgeExportPanel`.

Comportamento em runtime **inalterado**: nenhum componente mudou, nenhum endpoint alterado, nenhuma chamada nova adicionada. Build continua verde (verificado pós-mudança).

Risco de dupla escrita: **efetivamente neutralizado no cliente** — `sendToBardo()` é dead code em UI. Schema v1 de `bridge_exports` permanece apenas por compatibilidade com o polling do Bardo.

---

## 5) Android — estado real

### Implementado

* Foreground Service ativo
* Plugin Capacitor (`SecureCapture`)
* Chunking WAV local
* Persistência por sessão
* Manifesto por sessão
* Recuperação honesta após interrupção

Origem: 

---

### NÃO IMPLEMENTADO

* recuperação completa após process death em todos cenários
* sync automático robusto pós-captura

---

## 6) iOS — limitação estrutural

* NÃO suporta captura com tela bloqueada
* roda apenas foreground

Isso é decisão de arquitetura, não bug. 

---

## 7) Frontend — estado atual

### Stack

* React + Vite
* Capacitor (mobile)

### Modos de captura

* Manual
* Continuous
* Safe Capture (fonte principal)

Origem: 

---

## 8) Segurança — estado atual

### Correto

* JWT obrigatório nas edge functions
* validação server-side
* bridge com validação de elegibilidade
* segredo OpenAI vive **apenas** em Edge Functions (`Deno.env.get('OPENAI_API_KEY')`); zero referência runtime no cliente

---

### Concluído (P0.3 — fechado em 2026-05-09)

* `VITE_OPENAI_API_KEY` removido do frontend e do `.env` local
* chave OpenAI antiga revogada
* chave nova ativa apenas no backend Supabase
* validação por grep: zero ocorrência de `VITE_OPENAI_API_KEY`/`OPENAI_API_KEY` em `src/`

---

## 9) Problema ativo crítico

### Supabase CLI (bloqueio operacional)

Sintoma:

* erro 403 em:

  * `migration list`
  * `functions list`

Diagnóstico:

* falta de permissão da conta/token

Origem: 

---

### Estado atual

* backend pode estar correto
* mas não é verificável via CLI

**Projeto não está operacionalmente confiável até resolver isso**

---

## 10) O que já foi validado

* pipeline de captura existe
* Android safe capture funcional (base sólida)
* estrutura bridge v1 implementada
* schema consistente no código

---

## 11) O que NÃO foi validado (bloqueadores reais)

* CLI Supabase funcionando
* deploy confirmado das functions no remoto
* fluxo completo E2E com export real
* Android testado em device real com lock prolongado

---

## 12) Regras de continuidade (obrigatórias)

NÃO FAZER:

* usar estado React como fonte de verdade para captura Android
* reabrir captura iOS em background
* tratar `bridge_exports` como catálogo
* usar fluxo legado como principal
* colocar chave OpenAI no frontend
* não declarar o sistema operacional sem executar a seção 16

Origem: 

---

## 13) Definição objetiva de “projeto saudável”

O projeto só é considerado estável quando:

1. Supabase CLI funciona sem 403
2. `bridge-items` responde com dados reais
3. `export-to-cenax` cria registros válidos
4. `bridge_exports` vincula corretamente ao `bridge_item_id`
5. Android safe capture validado em hardware real
6. Nenhum segredo sensível no frontend

---

## 14) Próxima ação obrigatória (ordem)

1. Resolver acesso Supabase (P0)
2. Consolidar bridge canônica
3. Remover/neutralizar legado
4. Corrigir higiene de segredo
5. Validar fluxo E2E real

Ordem definida em: 

---

## 15) Leitura obrigatória após este arquivo

1. `VOICEIDEAS_SYSTEM_ARCHITECTURE.md`
2. `VOICEIDEAS_SUPABASE_BACKEND_RUNBOOK.md`
3. `VOICEIDEAS_ANDROID_SECURE_CAPTURE_RUNBOOK.md`
4. `VOICEIDEAS_COMPLETION_BACKLOG.md`

---

## Conclusão

O sistema só pode ser considerado operacional quando a seção 16 passar integralmente.

A arquitetura está correta.
O risco está na execução e validação final.

---

## 16) Verificação operacional (executar, não ler)

### Pré-requisitos
- usar o ambiente Docker do projeto
- ter `SUPABASE_ACCESS_TOKEN` válido no `.env.docker`
- ter um JWT real de usuário autenticado para testar as functions protegidas
- ter um `noteId` elegível de `safe_capture` para o teste de `export-to-cenax`

### Passos

#### 1. Entrar no ambiente correto
```bash
npm run docker:shell
./scripts/docker-bootstrap.sh
```

#### 2. Validar vínculo com o projeto Supabase

```bash
npx supabase link --project-ref uhzwqhaxnodtshlvvikt
```

#### 3. Verificar acesso a migrations remotas

```bash
npx supabase migration list --linked
```

#### 4. Verificar acesso a functions remotas

```bash
npx supabase functions list --project-ref uhzwqhaxnodtshlvvikt
```

#### 5. Verificar schema bridge no remoto

```bash
supabase db query --linked --file supabase/bridge_smoke_v5.sql
```

#### 6. Testar `bridge-items` com autenticação real

Substituir:

* `__SUPABASE_URL__`
* `__SUPABASE_ANON_KEY__`
* `__JWT__`

```bash
curl -sS -X GET "__SUPABASE_URL__/functions/v1/bridge-items?sync=1&limit=20" \
  -H "Authorization: Bearer __JWT__" \
  -H "apikey: __SUPABASE_ANON_KEY__"
```

#### 7. Testar filtros de `bridge-items`

```bash
curl -sS -X GET "__SUPABASE_URL__/functions/v1/bridge-items?bridge_status=eligible&validation_status=valid&limit=20" \
  -H "Authorization: Bearer __JWT__" \
  -H "apikey: __SUPABASE_ANON_KEY__"
```

```bash
curl -sS -X GET "__SUPABASE_URL__/functions/v1/bridge-items?destination_kind=world&content_type=organized_idea&limit=20" \
  -H "Authorization: Bearer __JWT__" \
  -H "apikey: __SUPABASE_ANON_KEY__"
```

#### 8. Testar `export-to-cenax` em modo de validação

Substituir:

* `__NOTE_ID__`

```bash
curl -sS -X POST "__SUPABASE_URL__/functions/v1/export-to-cenax" \
  -H "Authorization: Bearer __JWT__" \
  -H "apikey: __SUPABASE_ANON_KEY__" \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "bardo",
    "contentType": "note",
    "noteId": "__NOTE_ID__",
    "validateOnly": true
  }'
```

#### 9. Testar vínculo bridge catálogo ↔ export

```bash
supabase db query --linked --file supabase/bridge_verify_e2e.sql
```

---

### Resultado esperado

#### Acesso operacional

* `supabase migration list --linked` → não retorna `403`
* `supabase functions list --project-ref uhzwqhaxnodtshlvvikt` → não retorna `403`

#### Schema

* `bridge_smoke_v5.sql` confirma:

  * `bridge_items` existe
  * `bridge_exports.bridge_item_id` existe
  * `user_settings` existe
  * RLS/policies principais existem

#### Function `bridge-items`

* retorna `HTTP 200`
* retorna JSON com:

  * `items`
  * `count`
  * `sync` quando `sync=1`
* não vaza itens de outro usuário

#### Function `export-to-cenax`

* retorna resposta válida em `validateOnly`
* inclui `validationStatus`
* bloqueia item inelegível corretamente
* aceita item elegível de `safe_capture`

#### Bridge canônica

* `bridge_verify_e2e.sql` confirma vínculo entre:

  * `bridge_items`
  * `bridge_exports`

---

### Falha operacional (regra binária)

Se qualquer um destes itens falhar, considerar:

> **VoiceIdeas não está operacionalmente saudável**

Nesses casos:

* não avançar backlog
* não iniciar nova frente
* corrigir primeiro:

  * acesso Supabase
  * schema remoto
  * functions
  * auth
  * vínculo bridge catálogo/export

---

### Evidência mínima a registrar a cada rodada

Salvar no handoff:

* timestamp da verificação
* commit atual
* saída de:

  * `migration list`
  * `functions list`
  * teste de `bridge-items`
  * teste de `export-to-cenax`
  * query de verificação bridge
* conclusão binária:

  * `OPERACIONAL`
  * `NÃO OPERACIONAL`
