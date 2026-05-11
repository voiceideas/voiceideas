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

### 4.5) VI_BRIDGE.STATUS_AND_RESEND.1 — Estado pós-Bardo e reenvio controlado (2026-05-12)

**Antes:**
* `bridge_exports.status` colapsava import e reject em `'exported'` (a diferenciação vivia em `bridge_items.bridge_status`: `'consumed'` vs `'blocked'`).
* UI (`IdeaBridgeExportButton`) lia apenas `bridge_exports.status` → mostrava "Exportado para Bardo" igual pra import e reject. Usuário não sabia o resultado real.
* Reenvio só era oferecido quando `latestExport.status === 'failed'`. Para um item já importado/rejeitado, o botão dizia "Enviar para Bardo" e clicar disparava `retry: false` → `export-to-cenax` retornava `reused: true` (sem nova tentativa).
* `_shared/bridge-items.ts:getNextBridgeStatus()` preservava `'consumed'` e `'published'`, mas **não** `'blocked'` — qualquer re-sync (chamada a `bridge-items` ou novo export attempt) "destravava" itens rejeitados de volta para `'eligible'`, perdendo o terminal.

**Depois:**
* `BardoBridgeExportPanel` agora deriva um estado `BardoLifecycle` (`never_sent | pending | imported | rejected | failed | exported_unknown`) combinando `bridge_exports.status` + `bridge_items.bridge_status` (este vem via embed PostgREST `bridge_items:bridge_item_id(bridge_status,consumed_at,blocked_at,published_at)`). Mostra badge "Importado no Bardo" (verde) ou "Rejeitado no Bardo" (rosa) quando aplicável.
* Botão explícito **"Reenviar ao Bardo"** aparece quando `lifecycle === 'imported' | 'rejected' | 'failed'`. Para `failed` o copy é "Tentar enviar de novo"; para terminais Bardo, "Reenviar ao Bardo" + nota "Reenviar cria uma nova tentativa sem apagar o historico anterior. Use se o item foi apagado no Bardo ou se a importacao falhou."
* `getNextBridgeStatus` corrigido — preserva também `'blocked'`. Sync passivo nunca mais destrava terminal.
* Nova RPC `public.bridge_reopen_for_resend(p_bridge_item_id uuid)` (migration `202605120002`): reabre `bridge_items` terminal (`consumed`/`blocked`) para `eligible`, **preservando** `consumed_at`/`blocked_at` como rastro histórico. Idempotente. service_role apenas.
* `export-to-cenax` POST: quando `retry === true` AND existe `bridge_item_id`, chama `bridge_reopen_for_resend` antes de inserir a nova `bridge_exports` (pending). Sem isso, o Inbox do Bardo (que filtra `bridge_status NOT IN ('consumed','blocked')`) nunca veria a nova tentativa.

**Modelo de reenvio (Opção A do spec):**
* Cada reenvio = nova row em `bridge_exports` com `status='pending'`. Row anterior preservada como `exported`/`failed`.
* `bridge_items` reabre para `eligible`; `consumed_at`/`blocked_at` ficam como histórico.
* Idempotência: `bridge_items.upsert onConflict='source_type,source_id'` continua garantindo 1 row de catálogo por par; RPCs `bridge_mark_imported/rejected` continuam idempotentes.
* Histórico não é apagado: `bridge_exports` é log auditável; cada tentativa vira uma linha.

**Mapeamento de campos (esclarecimento do schema atual):**
* Spec pediu `imported_at`/`rejected_at` em `bridge_exports`. Schema atual tem só `exported_at`. **Decisão:** manter schema (não criar colunas redundantes); usar `bridge_items.consumed_at`/`blocked_at` como timestamps semânticos. UI já consome via embed.

**Validações:**
* migration aplicada via `supabase db push --linked`.
* `export-to-cenax v7 ACTIVE`, `bridge-items v5 ACTIVE` (2026-05-11 23:17 UTC).
* RPCs em produção: `bridge_mark_imported`, `bridge_mark_rejected`, `bridge_reopen_for_resend`.
* `npm run build` verde (20.37s); chunk `organizedIdeaService-g6Ymp3Pj.js` em produção contém todos os strings novos (Reenviar/Importado/Rejeitado/Tentar novo/etc) e o embed `bridge_status`/`consumed_at`/`blocked_at`.

**Pendência operacional:**
* Smoke E2E com clicks reais ainda depende de um ciclo completo (export → Bardo importa → reenviar) com usuário autenticado. Próxima task: VI_BRIDGE.MODES.2 + um teste de resend.
* Item `366691b0-…` ("Consolidação...") continua em `eligible` por causa do bug antigo que já é água passada — o `blocked_at` permanece como rastro. Próxima ação do Bardo nele (rejeitar de novo ou importar) corrige o estado.

---

### 4.4) VI_BRIDGE.MODES.1 — Bridge expandida para manual/contínuo (2026-05-12)

**Antes:** apenas notas safe_capture (Android Foreground Service) tinham acesso à ponte. O gate único era em `_shared/bridge-export.ts:validateNoteContext` — qualquer nota sem `source_capture_session_id` recebia o issue `outside_safe_capture_scope`, e o CHECK constraint em `bridge_items.source_session_mode` só aceitava `'safe_capture'`. Notas manuais e modo contínuo Web Speech ficavam permanentemente fora.

**Depois:** ponte aceita também manual + contínuo (ambos representados como `source_session_mode='manual'` no catálogo — são indistinguíveis no schema, pois nenhum dos dois popula `source_capture_session_id`; o "manual" cobre as duas trajetórias).

**Mudanças:**
* Migration `202605120001_bridge_items_allow_manual_mode.sql` (idempotente): substitui `bridge_items_source_session_mode_check` por `CHECK (source_session_mode IN ('safe_capture', 'manual'))`. `NOT NULL` preservado.
* `_shared/bridge-export.ts`: novo tipo `BridgeExportSourceSessionMode = 'safe_capture' | 'manual'`. `validateNoteContext` reformulada — agora é por-caminho: safe_capture exige session completed + raw_storage_path + sem failed; manual exige só conteúdo não-vazio. Removido o issue `outside_safe_capture_scope`. `resolveNoteBridgeExport` e `resolveOrganizedIdeaBridgeExport` derivam `sourceSessionMode` do schema: `NOT NULL → safe_capture`, `NULL → manual`.
* `_shared/bridge-items.ts`: `MaterializedBridgeItemDraft.sourceSessionMode` aceita union; `buildBridgeItemPayload` e `createMaterializedDraft` derivam do envelope (fallback defensivo para `'manual'`); `syncEligibleBridgeItemsForUser` removeu o filter `.not('source_capture_session_id', 'is', null)` — agora cataloga todas as notas do usuário, nota a nota.
* `src/types/bridge.ts`: substituições do union `'safe_capture' | null` por `BridgeExportSourceSessionMode | null` em `BridgeExportPayload`, `BridgeExportEligibility`, `BridgeItemPayload`, `BridgeItem`.
* UI: `SafeCaptureBridgeExportPanel` renomeado para `BardoBridgeExportPanel` (git mv preservou histórico). Copy ajustada: para safe_capture mantém "Elegivel: origem em captura segura concluida e sincronizada"; para manual exibe "Elegivel: nota pronta para enviar ao Bardo". 2 callsites atualizados (`NoteCard.tsx`, `OrganizedView.tsx`). Banners em `Notes.tsx`, `Organized.tsx`, `bridgeExport.ts` (legacy) e `SendToBardoModal.tsx` (legacy) atualizados.

**Invariantes preservadas (não negociáveis):**
* `account_link_required` em `bridge-exports` continua exigido.
* Email continua **não** sendo autorização.
* Ownership: queries filtram por `user_id`; ninguém vê nota de outro.
* Conteúdo vazio bloqueia em ambos os modos.
* safe_capture continua exigindo session completed + raw_storage_path + sem failure (zero regressão).
* `bridge_items` upsert continua com `onConflict: source_type,source_id` (idempotência por nota/ideia).
* RPCs `bridge_mark_imported` / `bridge_mark_rejected` inalteradas.

**Decisão de schema (justificada):**
Não adicionamos um campo `notes.session_mode`. Manual e contínuo seriam ambos `'manual'` no nosso vocabulário, e adicionar um campo exigiria backfill em base legada e código de escrita por modo em todos os caminhos de criação de nota. A derivação via `source_capture_session_id` é determinística (NOT NULL → safe_capture, NULL → manual), reversível, e cobre todos os casos atuais.

**Deploy 2026-05-12:**
* Migration aplicada (`supabase db push --linked`).
* `export-to-cenax` v6 ACTIVE + `bridge-items` v4 ACTIVE.
* `npm run build` verde.
* Web ainda precisa ser redeployado para a UI nova chegar em produção (próximo passo).

**Pendente — VI_BRIDGE.MODES.2:** validar E2E manual + contínuo + safe_capture com clicks reais. Sem dados de teste limpos, o smoke server-side foi limitado a (i) verificação da nova CHECK constraint em produção (aceita 'safe_capture' e 'manual') e (ii) confirmação de deploy ACTIVE. UI smoke E2E é a próxima task.

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
* **VI_LINK.AUTO_ACCOUNT_LINK (2026-05-10):** página web `/connect-bardo` implementada (`src/pages/ConnectBardo.tsx`, registrada em `src/App.tsx` como rota pública fora do `ProtectedLayout`). O Bardo, após `bridge-identity-check` retornar `connected`, redireciona o usuário para essa rota com query params `bardo_user_id` (obrigatório), `bardo_email` (opcional), `return`/`return_url`/`callback_url` (opcional, validado por allowlist `https://obardo.app`/`https://www.obardo.app` + localhost em DEV), `state` (opcional, ≤256 chars). Se usuário VI não está logado, a página dispara `signInWithEmail`/`signInWithGoogle` com redirect de retorno apontando para `/connect-bardo` com os mesmos params, e retoma o upsert ao voltar autenticado. Quando logado, a página chama `upsertBardoAccountLink({ bardoUserId, bardoEmail })`, que invoca `POST /functions/v1/link-bardo-account` com JWT VI do usuário. Sucesso: redireciona pro callback com `voiceideas_link=success` (preservando `state`), ou mostra confirmação local. Erro: `voiceideas_link=missing_bardo_user_id` se faltar id; `voiceideas_link=error` se EF falhar; sem callback no allowlist, mostra mensagem local. Helper `src/lib/bardoCallback.ts` implementa `isAllowedBardoCallback`, `buildBardoCallbackUrl` e `normalizeBardoState` — bloqueia open-redirect e schemes não-http. Não há JWT em URL, não há service role no cliente, idempotência segue garantida pela EF.
* **Deploy 2026-05-10 (Vercel via docker codex):** `https://voiceideas.vercel.app/connect-bardo` ao vivo. Deploy mediado pelo container `codex` com `vercel build --prod` + `vercel deploy --prebuilt --prod`, sem dependência do auto-deploy do Vercel CI.
* **E2E real 2026-05-11 (count4all@gmail.com):** handoff do Bardo registrou execução completa do fluxo em produção. `bridge-link-probe` → `connected`; primeiro `bridge-inbox` → `403 ACCOUNT_LINK_REQUIRED`; CTA Bardo abriu `https://voiceideas.vercel.app/connect-bardo?...&return=https://obardo.app/?voiceideas_link=success`; VI criou vínculo em `bardo_account_links` (row `b2b1f238-278a-4812-ad9f-d1ee3b9a6623`, `vi_user_id=57bdd56b-…`, `bardo_user_id=c1bbf06e-…`, `linked_at=2026-05-11 20:30:11 UTC`); retorno ao Bardo processou `voiceideas_link=success`; segundo `bridge-inbox` → `200 items=[]`; empty state correto. Vínculo legítimo, não-hotfix.
* **UX hotfix 2026-05-11:** handoff do Bardo apontou que o auto-redirect não disparou no E2E porque o Bardo usa o param `return=` (sem sufixo) e a página só lia `return_url`/`callback_url`. Corrigido: `ConnectBardo.tsx` agora aceita `return`, `return_url` e `callback_url` como aliases (todos passam pelo mesmo allowlist). Também adicionado botão explícito "Voltar ao Bardo agora" no estado de sucesso, além do auto-redirect (1.2s). Redeploy via `vercel deploy --prebuilt --prod` confirmou `return_url`, `callback_url` e `return` presentes no chunk `ConnectBardo-DuJJH1V7.js`.
* **Hotfix Gian (HOTFIX.LINK.1) — política de revogação:** row `a5273c62-7c51-46ad-b8cd-dc4942803f65` continua ativa. Política aprovada pelo Bardo: aguardar 24h sem regressão a partir do E2E count4all (janela mínima até **2026-05-12 20:25 UTC**). Após a janela, conferir (i) `count4all` continua com `bridge-inbox 200`, (ii) `/connect-bardo` continua operando, (iii) nenhum `ACCOUNT_LINK_REQUIRED` novo no Bardo, (iv) nenhum `oauth_completed_no_profile` inesperado; aí sim revogar via `UPDATE public.bardo_account_links SET link_status='revoked', revoked_at=now() WHERE id='a5273c62-…'` (ou via `POST /link-bardo-account body { action: 'revoke' }` autenticado como Gian). Depois testar conactseculo21/Gian pelo fluxo automático real — **não** recriar hotfix manual salvo rollback emergencial.
* **HOTFIX.LINK.1.PRECHECK_VI (lado VI) — 2026-05-11:** pre-check VI executado e aprovado. count4all (`b2b1f238-…`) e Gian hotfix (`a5273c62-…`) ambos `active` + `revoked_at=null`. `/connect-bardo` ao vivo (HTTP 200, chunk `ConnectBardo-DDpuHb_e.js`, aliases `return_url`/`callback_url`/`return` presentes). `npm run build` verde (24.73s). `supabase functions list` mostra link-bardo-account ACTIVE v2 + bridge-items v3 + bridge-exports v6 + bridge-identity-check v2. `supabase migration list --linked` sincronizada. **Nenhum dado alterado.** Revogação continua bloqueada por (a) janela temporal (≥ 2026-05-12 20:25 UTC) e (b) confirmação de telemetria Bardo (sem regressão).

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
