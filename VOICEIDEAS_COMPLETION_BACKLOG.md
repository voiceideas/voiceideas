# VoiceIdeas Completion Backlog (Execution Guide)

## 1) Como usar este backlog
- Ordem importa.
- Nao abrir frentes paralelas sem fechar os blocos criticos.
- Cada item tem criterio de aceite objetivo.
- Marcar evidencia (comando, payload, screenshot, SQL result) para cada aceite.
- Para execução determinística de P0 com saída JSON obrigatória, usar `VOICEIDEAS_TASKS.md`.

## 2) Prioridade P0 (bloqueia entrega confiavel)

### P0.1 Consolidar bridge canonico e isolar legado
Problema:
- coexistem caminhos novo e legado com contratos diferentes.

Escopo:
1. definir um caminho oficial para exportacao/consumo da bridge v1.
2. remover ou desativar UI/servico legado que usa shape antigo.
3. garantir que `bridge_items` e `bridge_exports` sejam usados de forma coerente.

Criterio de aceite:
- nenhum fluxo de usuario depende de `owner_email/content_hash`.
- exportacao de `note` e `organized_idea` segue somente fluxo canonico.
- teste de regressao para exportacao aprovado.

Arquivos para revisar:
- `src/lib/bridgeExport.ts` (legado)
- `src/components/SendToBardoModal.tsx` (legado)
- `supabase/functions/bridge-exports/index.ts` (legado parcial)
- `src/services/bridgeExportService.ts` (canonico)
- `supabase/functions/export-to-cenax/index.ts` (canonico)
- `supabase/functions/bridge-items/index.ts` (catalogo)

### P0.2 Resolver acesso operacional Supabase remoto
Problema:
- CLI pode falhar com 403 por privilegio de conta/token.

Escopo:
1. garantir acesso da conta certa no projeto Supabase.
2. validar comandos de operacao remota dentro do Docker.
3. registrar procedimento definitivo de credencial/equipe.

Criterio de aceite:
- `npx supabase migration list --linked` funciona.
- `npx supabase functions list --project-ref ...` funciona.
- equipe tem procedimento repetivel para acesso.

### P0.3 Corrigir higiene de segredo no frontend — CONCLUIDO (2026-05-09)
Problema (historico):
- `VITE_OPENAI_API_KEY` aparecia em `.env` local.

Resolucao registrada em 2026-05-09:
- chave antiga OpenAI revogada
- chave nova ativa somente no backend Supabase (env das Edge Functions)
- `.env` local nao contem mais `VITE_OPENAI_API_KEY`
- grep em `src/` retorna zero ocorrencias de `VITE_OPENAI_API_KEY`/`OPENAI_API_KEY`
- segredo consumido apenas via `Deno.env.get('OPENAI_API_KEY')` em `transcribe`, `organize` e `_shared/openai.ts`

Criterio de aceite (todos atendidos):
- [x] build frontend sem chave OpenAI cliente
- [x] nenhuma referencia `VITE_OPENAI_API_KEY` ativa em codigo de runtime
- [x] segredo sensivel somente no ambiente server/function

## 3) Prioridade P1 (necessario para finalizar produto)

### A.2.VI SYSFIX.LINK.1 (VI side) — CONCLUIDO (2026-05-10)
Substituir o hotfix manual em `bardo_account_links` (HOTFIX.LINK.1) por um endpoint VI funcional, seguro e idempotente, sem afrouxar `account_link_required` em `bridge-exports`.

Resolucao registrada em 2026-05-10:
- `supabase/functions/link-bardo-account` revalidada — contrato POST `{ bardo_user_id, bardo_email? }` permanece, `vi_user_id` sempre derivado de `auth.uid()`, idempotente sobre (vi_user_id, bardo_user_id) ativo.
- Resposta evoluida para superset (preserva retrocompat): adicionados campos `ok`, `linked`, `link_status` sobre os antigos `link`, `created`, `updated`, `revoked`.
- Deployada (project_ref `uhzwqhaxnodtshlvvikt`, versao 2 ou superior).
- Smoke remoto confirmou: sem Authorization → 401; Bearer invalido → 401.
- `build` verde, `migration list --linked` sem 403, `functions list` lista a EF como ACTIVE.

Pendencia restante (fora do VI):
- **SYSFIX.LINK.1 (Bardo side)** — o fluxo "conectar ao VI" no Bardo precisa chamar `POST /functions/v1/link-bardo-account` no VI com o JWT VI do usuario depois de `bridge-identity-check`. Enquanto isso nao existir, novos usuarios precisarao de hotfix manual equivalente ao registrado em `VOICEIDEAS_TEMP_LINK_HOTFIX.md`.
- **Onde enderecar:** este repo (VoiceIdeas) NAO recebe bloco operacional para o Bardo. Envie a pendencia para o fluxo de orientacoes no Bardo (CENAX). O lado VI ja oferece tudo que e necessario.

Encerramento formal A.2.VI.POST_CLOSE (2026-05-10):
- npm build verde (17.8s)
- migration list --linked sem 403, local↔remote sincronizado
- functions list mostra link-bardo-account ACTIVE v2 (2026-05-10 19:53:02 UTC)
- bridge-inbox e bridge-exports inalterados, P1.3 preservado
- nenhuma alteracao no Bardo nesta task

### VI_LINK.AUTO_ACCOUNT_LINK — CONCLUIDA (2026-05-10)
Implementa o fluxo `/connect-bardo` no VoiceIdeas web, fechando o lado VI da pendencia que o Bardo Cut 0.6.119 deixou aberta (builder de `/connect-bardo` ja implementado no Bardo; faltava o destino aqui).

Entregue:
- `src/pages/ConnectBardo.tsx` — pagina publica `/connect-bardo` com estados validating / missingParams / needLogin / linking / success / error.
- `src/lib/bardoCallback.ts` — allowlist + builder seguro de callback. Aceita `https://obardo.app`, `https://www.obardo.app`, e localhost apenas em DEV. Bloqueia open-redirect, schemes nao-http, state >256 chars.
- `src/App.tsx` — rota `/connect-bardo` registrada como publica fora de `ProtectedLayout`, lazy-loaded.
- `src/lib/i18nMessages.ts` — chaves `connectBardo.*` adicionadas em pt-BR / en / es.

Contrato com o Bardo:
- Bardo abre: `<VI_WEB_URL>/connect-bardo?bardo_user_id=<id>&bardo_email=<email opc>&return_url=<callback Bardo>&state=<opt>`
- VI logado → chama `POST /functions/v1/link-bardo-account` com JWT VI; sucesso redireciona pra callback com `?voiceideas_link=success&state=<mesmo>`
- VI nao logado → fluxo de login (email/Google) com redirect preservando os mesmos query params; retoma upsert apos auth
- Faltando bardo_user_id → callback `?voiceideas_link=missing_bardo_user_id`
- Erro EF → callback `?voiceideas_link=error`
- Sem callback no allowlist → mostra estado local; nenhum redirect

Criterio de aceite (todos atendidos):
- [x] rota `/connect-bardo` existe e responde
- [x] precisa de login VI (vi_user_id derivado do JWT, nunca do body)
- [x] chama `link-bardo-account` via `bardoAccountLinkService.upsertBardoAccountLink`
- [x] callback validado por allowlist (no open-redirect)
- [x] idempotente (delegado a `link-bardo-account` no servidor)
- [x] build verde
- [x] functions list e migration list operacionais

Pendencias operacionais (fora do escopo desta task):
- ~~Bardo precisa publicar `VITE_VOICEIDEAS_WEB_URL` no Cloudflare apontando pro dominio web do VI~~ — **resolvido pelo Bardo em 2026-05-11**: variavel publica gravada em `.env.production` versionado no repo Bardo, bundle ja contem URL baked. Bardo opera em Cloudflare Pages.
- ~~Validar E2E com usuario limpo, sem hotfix~~ — **VALIDADO em 2026-05-11 20:25 UTC** com `count4all@gmail.com`. Vinculo legitimo criado em `bardo_account_links` (row `b2b1f238-278a-4812-ad9f-d1ee3b9a6623`); `bridge-inbox` passou de 403 → 200 items=[]; empty state correto.
- Apos janela de 24h sem regressao (a partir de 2026-05-11 20:25 UTC, ou seja, **>= 2026-05-12 20:25 UTC**), revogar HOTFIX.LINK.1 (row `a5273c62-7c51-46ad-b8cd-dc4942803f65`).

### UX-FIX 2026-05-11 — alias `return` no /connect-bardo
Handoff do Bardo apontou que o auto-redirect nao disparou no E2E. Causa: Bardo manda `return=...`, VI lia apenas `return_url`/`callback_url`. Contrato divergente (mesma classe de bug do P1.5 inbox `bardo_user_id` antigo).

Correcao aplicada em `src/pages/ConnectBardo.tsx`:
- aliases aceitos: `return_url`, `callback_url`, `return`
- todos passam pelo mesmo allowlist (`isAllowedBardoCallback`); URLs fora do allowlist sao tratadas como ausentes (nenhum redirect)
- botao explicito "Voltar ao Bardo agora" adicionado no estado de sucesso, alem do auto-redirect (1.2s)
- novas chaves i18n `connectBardo.success.backToBardoButton` em pt-BR / en / es

Deploy via `docker compose run --rm codex` + `vercel build --prod` + `vercel deploy --prebuilt --prod`. Chunk producao `ConnectBardo-DuJJH1V7.js` confirmado com os 3 aliases (`return_url`, `callback_url`, `return`).

### VI_BRIDGE.MODES.1 — CONCLUIDA (2026-05-12)
Expande "Enviar ao Bardo" para notas manual e contínuo, mantendo invariantes de seguranca (account_link_required, identidade via JWT, ownership por user_id, bloqueio de conteudo vazio).

Diagnostico mapeado:
- `notes` nao tem coluna de mode; identificacao por `source_capture_session_id` (NOT NULL = safe_capture, NULL = manual/continuo indistinguivel)
- `bridge_items.source_session_mode` tinha CHECK constraint = 'safe_capture'
- gate unico em `_shared/bridge-export.ts:validateNoteContext` → issue `outside_safe_capture_scope`
- filter em `syncEligibleBridgeItemsForUser` (`.not('source_capture_session_id', 'is', null)`)

Mudancas (resumo):
- migration `202605120001_bridge_items_allow_manual_mode.sql` (idempotente): CHECK aceita ['safe_capture', 'manual']
- `_shared/bridge-export.ts`: tipo `BridgeExportSourceSessionMode`; `validateNoteContext` por-caminho; sem `outside_safe_capture_scope`
- `_shared/bridge-items.ts`: mode derivado do envelope; sync sem filter de sessao
- `src/types/bridge.ts`: union 'safe_capture' | 'manual'
- UI: `SafeCaptureBridgeExportPanel` → `BardoBridgeExportPanel` (git mv); copy ajustada por mode
- callsites atualizados em `NoteCard.tsx`, `OrganizedView.tsx`

Validacoes:
- npm build verde
- migration aplicada via supabase db push --linked
- functions deploy: export-to-cenax v6 ACTIVE + bridge-items v4 ACTIVE
- CHECK constraint confirmado em producao: `source_session_mode = ANY (ARRAY['safe_capture'::text, 'manual'::text])`

Pendencia operacional:
- redeploy web (Vercel via codex)
- VI_BRIDGE.MODES.2: validar E2E manual + continuo + safe_capture com clicks reais
- somente apos VI_BRIDGE.MODES.2 avancar para desktop/Android

### VI_BRIDGE.STATUS_AND_RESEND.1 — CONCLUIDA (2026-05-12)
VI agora reflete corretamente import/reject feitos no Bardo e permite reenvio controlado.

Diagnostico:
- bridge_mark_imported / bridge_mark_rejected ja existiam e ja atualizavam ambas as tabelas. Bardo ja chamava corretamente — `bb43a3b4-...` (idea) e `9d1f6257-...` (nota) foram observados como `bridge_exports.status='exported'` com `bridge_items.bridge_status='consumed'` (nota) e `blocked_at` setado (idea).
- Causa raiz #1: `_shared/bridge-items.ts:getNextBridgeStatus()` so preservava 'consumed' e 'published' — 'blocked' caia em 'eligible'. Re-sync passivo destravava itens rejeitados.
- Causa raiz #2: UI lia apenas `bridge_exports.status`, que e o mesmo ('exported') pra import e reject — usuario nao via diferenciacao.
- Causa raiz #3: `BardoBridgeExportPanel.handleExport` so passava `retry: true` quando latestExport era 'failed'. Para terminais Bardo, passava 'false' e EF retornava `reused: true` sem criar nova tentativa.
- Gap funcional: mesmo se retry=true, sem reabrir o `bridge_item` terminal, Inbox do Bardo nunca veria a nova `bridge_exports` (filtro `bridge_status NOT IN ('consumed','blocked')`).

Mudancas:
- migration `202605120002_bridge_reopen_for_resend.sql` (nova RPC `bridge_reopen_for_resend(uuid)`): reabre item terminal para 'eligible' preservando consumed_at/blocked_at; idempotente; service_role only.
- `_shared/bridge-items.ts:getNextBridgeStatus()`: agora preserva 'blocked' tambem.
- `export-to-cenax/index.ts`: quando retry=true e ha bridge_item_id, chama `bridge_reopen_for_resend` antes de inserir a nova `bridge_exports`.
- `src/types/bridge.ts`: novo `BridgeItemEmbed` + `BridgeExport.bridgeItem: BridgeItemEmbed | null`.
- `src/services/bridgeExportService.ts`: `listBridgeExports` agora faz embed PostgREST `bridge_items:bridge_item_id (bridge_status, consumed_at, blocked_at, published_at)`. `mapBridgeExportRow` consome o embed.
- `src/components/BardoBridgeExportPanel.tsx`: deriva `BardoLifecycle` (`never_sent | pending | imported | rejected | failed | exported_unknown`); mostra badge "Importado no Bardo" / "Rejeitado no Bardo"; botao explicito "Reenviar ao Bardo" / "Tentar enviar de novo" quando aplicavel, chamando `exportBridgeContent({...retry:true})`.

Decisao de schema:
- NAO criamos colunas `imported_at` / `rejected_at` em `bridge_exports`. Schema atual ja diferencia via `bridge_items.consumed_at`/`blocked_at`; criar duplicacao seria fonte de inconsistencia.

Validacoes:
- npm build verde (20.37s)
- migration list --linked: 202605120002 sincronizada
- functions list: export-to-cenax v7, bridge-items v5 ACTIVE (2026-05-11 23:17 UTC)
- RPCs em producao: bridge_mark_imported, bridge_mark_rejected, bridge_reopen_for_resend
- chunk producao `organizedIdeaService-g6Ymp3Pj.js` carrega todas as strings novas + embed markers (bridge_status / consumed_at / blocked_at)

Pendencia operacional:
- Smoke E2E real (export → Bardo importa → reenviar → confirmar nova bridge_exports + bridge_item de volta para eligible) precisa clicks no UI
- Idem para reject → reenviar
- VI_BRIDGE.MODES.2 e este smoke podem ser feitos na mesma rodada

### VI_BRIDGE.UX_STATE_AND_PREFS.1 — CONCLUIDA (2026-05-12)
Endereca 4 gaps observados pelo Gian apos o E2E:
1. Preferencia de integracao Bardo so vivia em localStorage (perdia em limpeza).
2. Sem indicacao de conta VI logada.
3. Settings com copy "Foundation ready for a future Bardo connection" mesmo com ponte ativa.
4. Reenvio bloqueado quando fonte sumiu (organized_idea consumido cujas notas-fonte foram deletadas).

Mudancas:
- migration `202605120003_user_settings_external_integrations.sql`: nova coluna `external_integrations_enabled` em user_settings (NOT NULL default false).
- `useUserSettings` hook: agora retorna `externalIntegrationsEnabled` + `setExternalIntegrationsEnabled` (persistencia em user_settings).
- `IntegrationSettingsProvider`: refatorado. Server-side e source of truth; localStorage e cache. Quando server responde, valores remotos sobrescrevem cache. Updates sao otimistas + persistidos em background.
- `src/components/settings/SignedInAccountCard.tsx`: novo card em Settings mostrando email + id parcial + estado do vinculo Bardo (consultado via `getActiveBardoAccountLink`).
- `Settings.tsx`: renderiza `<SignedInAccountCard />` no topo.
- `export-to-cenax v8`: aceita `body.useSnapshot: true`. Quando true + ha bridge_export anterior com payload, clona payload, chama `bridge_reopen_for_resend`, cria nova bridge_exports pending. Marca payload com metadata `snapshotResend` (sourceExportId, originalExportedAt, reason).
- `bridgeExportService.exportBridgeContent`: novo parametro `useSnapshot?: boolean`.
- `BardoBridgeExportPanel`: distingue 3 modos de clique (`normal`, `retry`, `snapshot`). Quando `canSnapshotResend` (terminal Bardo + !elegivel + ha payload anterior), mostra card "A fonte original mudou..." + botao "Reenviar ultimo conteudo".
- copy `integrations.destination.bardo.preparedTitle` + `preparedDescription` reescritos em pt-BR / en / es para refletir ponte ativa.

Validacoes:
- migration aplicada via supabase db push --linked
- coluna `external_integrations_enabled` confirmada em producao (NOT NULL default false)
- export-to-cenax v8 ACTIVE (2026-05-12)
- npm build verde (22.41s)
- chunk index-D0sY310G.js contem nova copy "Conexao com o Bardo disponivel"
- chunk Settings-CjhFe2nq.js contem strings "Conta VoiceIdeas" / "Bardo conectado" / "Sem vinculo Bardo"
- chunk organizedIdeaService-DYM0WHgS.js contem "Reenviar ultimo conteudo" + "A fonte original mudou" + "useSnapshot" + "snapshotResend"

Pendencia operacional curta:
- smoke real de snapshot resend: clicar em organized_idea consumido cuja notas-fonte foram deletadas (ex: 4bcd62a3 "Notas sobre Joao e referencias culturais"); confirmar nova bridge_exports pending com payload clonado + metadata snapshotResend.
- smoke de prefs server-side: limpar localStorage; reabrir app; confirmar que toggle Bardo continua ON apos relogin.

### VI_BRIDGE.FINAL_STATUS_CYCLE.1 — CONCLUIDA (2026-05-12)

Ciclo VI <-> Bardo validado E2E em producao com clicks reais. Ponte nao bloqueia mais empacotamento.

Validacoes finais:
- npm build verde
- supabase migration list --linked: 202605120001/002/003 sincronizadas
- supabase functions list: 17 ACTIVE incluindo export-to-cenax v9, bridge-items v6, bridge-exports v6, link-bardo-account v2, bridge-identity-check v2

Evidencia E2E:
- import safe_capture: 92ac447e/a7958323 consumed em 2026-05-11
- import organized_idea (manual): 4bcd62a3/e06b2be2 consumed (snapshot resend importado em 2026-05-12 01:38:47)
- reject organized_idea (safe_capture): e51590b8/996d120f blocked em 2026-05-12 01:38:52
- snapshot resend: row 1c10a211 com payload.snapshotResend.sourceExportId=52ee4a07; row original preservada
- historico: 3 bridge_exports rows totais sem deletes; consumed_at/blocked_at carregam timestamps historicos intactos

Proximo bloco de trabalho:
1. Desktop build readiness (Tauri)
2. Android device/build readiness (Capacitor + safe capture)
3. iOS / App Store readiness
4. Cleanup separado: revogar hotfix Gian (a5273c62-...) apos confirmar que o fluxo automatico de vinculo cobre o Gian via OAuth + /connect-bardo no proximo signup limpo

A ponte VI <-> Bardo nao e mais bloqueador. Pode-se iniciar empacotamento/release readiness em qualquer ordem.

### VI_RELEASE.HOUSEKEEPING.1 — CONCLUIDA (2026-05-12)

Working tree limpo (`git status --short` vazio). 7 commits tematicos.
Pronto para VI_I18N.SWEEP.1 em arvore limpa.

Estado antes: 12 modificados + 30 untracked.

7 commits temáticos:
1. bdae63e docs(handover): 5 MDs operacionais
2. a0f1ee5 feat(bridge): infra P1.3/P1.4 (4 migrations + hook + helper + toggle)
3. eba13f1 chore(legacy): JSDoc banners + remove imports legacy mortos
4. 37621b1 feat(errors): classifyAppError + session-expired
5. 80dc00b chore(bridge-identity-check): P1.5 instrumentation
6. 3f08f12 chore(ios): 18 PNGs AppIcon + Capacitor SPM
7. f62fe1a chore(housekeeping): README + wasm vendored + gitignore core

Decisoes:
- core 2.1 GB ELF ARM aarch64: REMOVIDO + gitignore
- migrations untracked ja aplicadas no remoto: commitadas como historico
- codigo de producao sem fonte no git: useBardoAccountLink + shared helper
  + wasm vendored — agora versionados
- nenhum segredo versionado (scan completo)
- sem mudanca funcional: tudo higiene + documentacao

Validacoes:
- npm build verde
- git status --short vazio

Proximo passo: VI_I18N.SWEEP.1 em arvore limpa.

### VI_I18N.SWEEP.1A_1D — CONCLUIDA (2026-05-12)

Espanhol completo. Paridade total: pt-BR / en / es = 467 chaves cada.
Spread silencioso (`...enMessages`) removido. Script de audit + npm script.

Estado antes:
- esMessages = 103 explicitas + spread `...enMessages` → 364 chaves caiam em
  ingles sem aviso. Usuario via 22% pt-mistura + 78% ingles.
- TypeScript `satisfies Record<TranslationKey, ...>` aceitava por causa do
  spread cobrir formalmente as 467 chaves; conteudo real era EN.

Estado depois:
- esMessages = 467 entradas explicitas (sem spread), ordem canonica pt-BR.
- 364 entries auto-traduzidas via script PT→ES (regras determinísticas
  + sentinels contra cascades + ~50 hard-overrides para casos complexos).
- 10 entries pre-existentes corrigidas (Ouvindo, Pronto, edição, etc).
- 5 patches manuais finais (roteiro.description, continuousHint, manualPath.title,
  metric.groups, manualHint).

Cascades documentadas no script (8 bugs do approach split/join):
1. `Gravando o áudio` → `Gravandel audio` — leading space obrigatorio
2. `Buscar` → `Búsquedar` — regra Busca→Búsqueda removida
3. `Permissão negada` → `Permiso dedenegado` — longest-form first
4. `recomendado` → `recomiendado` — identity rule de protecao
5. `Transcrevendo` → `Transcribendo` — reorder
6. ` à ideia` → ` la la idea` — sentinels opacos
7. funcoes `\xE3` literal — decodeJsEscapes() antes das regras
8. `agrupamentos` → `agrupacións` — plural antes do singular

Audit script (scripts/audit-i18n.mjs):
- parsa 3 blocos via regex robusta (aceita Record<string,...> E
  Record<TranslationKey,...> — pt-BR usa string porque DEFINE TranslationKey)
- FAIL (exit 1): missing-keys, extra-keys, spread-fallback, pt-residual
- WARN (exit 0): identical-to-pt (28 entries onde PT/ES coincidem
  legitimamente: "Captura segura", "Markdown copiado", "Comandos de voz:",
  "ajuste automático", "Cancelar", etc.)
- Output: JSON estruturado para CI
- npm run audit:i18n

Validacoes:
- npm run audit:i18n: paridade OK, sem spread, sem PT residual
- npm run build:web: verde
- lint clean em i18nMessages.ts e audit-i18n.mjs

Proximo passo: definido por Gian.

### VI_I18N.SWEEP.1B — CONCLUIDA (2026-05-12)

Extracao de hardcoded das telas principais. 96 chaves novas x 3 locales
= 288 entradas adicionadas. 8 arquivos refatorados. Build verde.

Estado antes:
- BardoBridgeExportPanel + IdeaBridgeExportButton: 100% hardcoded pt-BR.
  Strings como "Ponte v1 · Bardo", "Importado no Bardo", "Reenviar ultimo
  conteudo", "Tentativas registradas:", "Enviar para X" etc. apareciam
  em ingles/espanhol quando usuario trocava idioma (pq nao havia chave).
- AcceptInvite + ShareIdeaModal: 100% hardcoded sem useI18n.
- CaptureQueue: header, KPIs, empty states hardcoded.
- NoteCard + OrganizedView: title="Enviar ao Bardo" hardcoded em ambos.
- ShareIdeaModal usava toLocaleDateString('pt-BR') hardcoded.

Estado depois:
- 96 chaves novas distribuidas em 4 sections:
  - bardo.bridge.* (18 chaves)
  - bardo.export.* (10 chaves) — fns parametrizadas por ${label}
  - invite.* (29 chaves)
  - share.* (19 chaves)
  - captureQueue.* (15 chaves)
  - note.actions.sendToBardo (1 chave compartilhada)
- 8 arquivos refatorados consumindo useI18n + t()
- Datas no ShareIdeaModal agora usam formatDate do hook (responde a locale)
- IdeaBridgeExportButton tambem usa formatDate (era toLocaleString('pt-BR'))

Conteudo deferido para fase C:
- CaptureQueue deep operational labels (~24 strings: Etapa, Duracao,
  Plataforma, Arquivo, Storage, Excluir copia local pendente?, etc.)
- dead-code legacy
- pages secundarias nao auditadas (Home/Notes/Organized partial; outros
  components: FolderRenameModal, BulkActionsBar, OrganizePanel)

Validacoes:
- npm run audit:i18n: 563/563/563, sem spread, sem PT residual
- npm run build:web: verde (tsc + vite)
- npx tsc --noEmit: sem erros
- re-scan /tmp/scan-hardcoded.mjs nos 8 arquivos: 0 hits reais
  (3 falsos positivos: 2x "Promise" type, 1x "VoiceIdeas" alt marca)

Proximo passo: definido por Gian (sugestao: VI_I18N.SWEEP.1C deep
CaptureQueue + dead-code).

### VI_I18N.SWEEP.1C — CONCLUIDA (2026-05-12)

Sweep residual fechado. 6 arquivos refatorados. +81 chaves x 3 locales
= 243 entradas novas. Paridade 644/644/644.

Estado antes:
- CaptureQueue.tsx deep operational labels hardcoded (15 strings: Etapa,
  Duracao, Plataforma, Arquivo, Storage, Estado da transcricao,
  Excluir copia/sessao/trecho confirms, Sessoes da fila, Ideias separadas,
  Notas salvas, Status bruto, Rename, Nota criada a partir deste trecho)
  + 6 buttons Cancelar/Excluir hardcoded nos confirm dialogs.
- IdeaDrafts.tsx (323 lines): zero i18n. toLocaleString('pt-BR') hardcoded.
- Admin.tsx (212 lines): zero i18n. Strings: Acesso restrito, Painel Admin,
  KPIs, feedback messages, role toggles, limit editor (16 strings).
- BardoConnectionToggle.tsx (203 lines): zero i18n. 14 strings (form,
  toggle states, placeholders, helpers).
- VoiceSegmentationSettings.tsx (134 lines): zero i18n. 10 strings.
- SignedInAccountCard.tsx (132 lines): zero i18n. 14 strings +
  toLocaleDateString('pt-BR') hardcoded.

Estado depois:
- captureQueue.deep.* (15) — labels operacionais profundos
- ideaDrafts.* (4) — Textos da fila, loadError, Ouvir audio, Texto bruto
- admin.* (25) — restricted, panel, KPIs, feedback, role toggles, limit
  editor com fns parametrizadas por email
- bardoConnection.* (15) — toggle, form, placeholders, link summary
- voiceSegmentation.* (10) — title/body/restore + 4 inputs + cut expression
- signedInAccount.* (15) — title, status, link/no-link, errors;
  formatDate substitui toLocaleDateString('pt-BR')

Termos tecnicos preservados (nao traduzidos):
- bardo_account_links (table schema)
- rawStoragePath, bardo_user_id (debug ids)
- Storage (mesmo termo em pt/en/es)

Conteudo deferido (fora de escopo):
- SendToBardoModal.tsx (374 lines, 15 strings) — DEAD CODE. Sem imports.
  Notes/Organized tem JSDoc "LEGACY BRIDGE PATH NAO esta montado aqui".
- Home/Notes/Organized — scanner reportou 0 hits reais (so types).
- TagCloudPanel/FolderBar/NotesList/VoiceRecorder/AudioPlayer/OrganizePanel
  — falsos positivos (Promise type annotations).
- UserAvatar — so icone+inicial, sem texto.

Validacoes:
- npm run audit:i18n: 644/644/644, sem spread, sem PT residual
- npm run build:web: verde
- npx tsc --noEmit: sem erros
- /tmp/scan-hardcoded-1c.mjs: hits reais restantes = 1
  (bardo_account_links em SignedInAccountCard — schema name intencional)

Proximo passo: smoke visual rapido por idioma (pt-BR/en/es), depois
tag 0.1.0 / changelog.

### VI_I18N.SMOKE.1 — CONCLUIDA (2026-05-12)

Smoke visual por idioma fechado. 2 arquivos corrigidos durante o
smoke (AcceptInvite + ShareIdeaModal). 13 strings PT hardcoded + 2
leaks de mensagens do backend supabase + 1 toLocaleDateString('pt-BR')
hardcoded. +11 chaves novas x 3 locales = 33 entries. Paridade
655/655/655.

Setup:
- preview server via preview_start (porta 5175). config 'voiceideas'
  em .claude/launch.json da harness apontando para symlink.
- locale switch via localStorage.setItem('voiceideas.language.v1', X)
- snapshots via preview_snapshot (accessibility tree).

Surfaces testadas (3 locales x 3 rotas publicas):
- /auth: pt-BR / en / es - todas limpas
- /accept-invite?token=fake: pt-BR mostra erro backend especifico,
  en/es mostram fallback i18n (leak suprimido)
- /connect-bardo: pt-BR / en / es - todas limpas

Residuais corrigidos durante o smoke:
1. AcceptInvite backend error leak: mensagens pt-BR do Supabase edge
   vazavam para UI en/es. Fix: locale-aware suppression (preserva
   especificidade em pt-BR).
2. AcceptInvite: 9 strings PT hardcoded (linkIncomplete, loadPreview,
   acceptFailed, successMessage fn, fallbackExpectedEmail, sendLink,
   googleLogin, signOut) + toLocaleDateString('pt-BR') -> formatDate
3. ShareIdeaModal: 4 strings PT hardcoded + 1 result.warning leak
   do backend. Locale-aware suppression aplicada.

Chaves novas (11):
- invite.error.{linkIncomplete, loadPreview, acceptFailed, sendLink,
  googleLogin, signOut}, invite.successMessage (fn),
  invite.fallbackExpectedEmail
- share.success.{invited (fn), linkCreated}, share.error.fallback

Residuais conhecidos NAO corrigidos (deferred):
- Hook-level fallback strings (~13 ocorrencias em useSpeechRecognition,
  useAudioTranscription, useCaptureSession, useCaptureQueue,
  useMobileAudioCapture, useIdeaDrafts, useBridgeExport, AudioPlayer).
  Fired apenas quando err.message vazio (edge case).
- src/utils/captureQueueErrorMessage.ts: centralizador com ~12
  mensagens hardcoded. Refactor exige passar t() como arg ou
  refactor para useI18n no consumer.
- Backend (Supabase edge functions): mensagens em pt-BR fixas. Fora
  de escopo (envolve mudar functions).

Surfaces protegidas NAO testadas visualmente (requerem auth):
- Home / VoiceRecorder / CaptureQueue deep / Notes / Organized /
  Settings / IdeaDrafts / Admin. Cobertura indireta via audit
  paridade + SWEEP.1A_1D/1B/1C que refatoraram todas essas.

Validacoes:
- npm run audit:i18n: 655/655/655, sem spread, sem PT residual
- npm run build:web: verde
- npx tsc --noEmit: sem erros
- 3 locales x 3 rotas confirmados via preview_snapshot
- screenshot do auth pt-BR como evidencia visual

Proximo passo: changelog/tag 0.1.0.

### VI_RELEASE.0.1.0.FINAL — CONCLUIDA (2026-05-12)

Release 0.1.0 fechado formalmente. Tag anotada v0.1.0 criada e enviada.
Release notes em VOICEIDEAS_RELEASE_NOTES_0.1.0.md.

Validacoes finais:
- git status --short: vazio
- npm run audit:i18n: 655/655/655, sem spread, sem PT residual
- npm run build:web: verde
- npx supabase migration list --linked (via docker): 27 migrations
  alinhadas (Local/Remote/Time), ultima 202605120003
- npx supabase functions list (via docker): 17 functions ACTIVE

Alinhamento de versao (5 surfaces, todas em 0.1.0):
- package.json
- src-tauri/tauri.conf.json
- src-tauri/Cargo.toml
- android/app/build.gradle (versionName "0.1.0", versionCode 2)
- ios/App/App.xcodeproj/project.pbxproj (MARKETING_VERSION 0.1.0,
  CURRENT_PROJECT_VERSION 2)

Artefatos confirmados (Distribuicao-Final/ gitignored):
- VoiceIdeas-macOS-AppleSilicon.dmg (3.0 MB)
- VoiceIdeas-macOS-Intel.dmg (3.1 MB)
- VoiceIdeas-Android-arm64.apk (3.3 MB debug)
- VoiceIdeas-Android-arm64.aab (3.1 MB release)
- src-tauri/target/release/bundle/macos/VoiceIdeas.app
- android/app/build/outputs/bundle/release/app-release.aab
- iPad install local via devicectl (Personal Team, Apple ID free)

Release notes cobrem:
- Ponte VI<->Bardo (linking + modos + status return + snapshot resend +
  17 edge functions ativas)
- 4 plataformas (web, desktop macOS arm64+Intel, Android, iPad)
- i18n: 3 locales x 655 keys + audit + smoke
- Outras mudancas: safe-area Android icon, useUserSettings boot race fix,
  UserAvatar component, Layout limpo, hotfix Gian revogado
- Limitacoes: App Store/TestFlight/Play Store/notarization/i18n residual
- Validacoes finais
- Comandos para reproduzir
- Proximos blocos sugeridos

Limitacoes (nao bloqueiam tag):
- App Store/TestFlight aguardando Apple Developer pago
- Google Play aguardando keystore + foreground service hardening
- macOS fora App Store precisa notarizacao
- ~25 strings PT residuais em hooks/utils/edge messages (plano para
  VI_I18N.SWEEP.1D futuro)

Proximo bloco: definido por Gian (sugestoes: Apple Developer, Google
Play, macOS notarization, Bardo bridge metricas/retry, ou SWEEP.1D).

### VI_RELEASE.REBUILD_APPS.1 — CONCLUIDA (2026-05-12)

Rebuild final dos artefatos pos-tag a partir de HEAD release (e843181 /
tag v0.1.0). Tag NAO movida — commit docs deste rebuild fica adiante
da tag, mas binarios sao do mesmo codigo da tag.

Base:
- git rev-parse HEAD: e843181
- git tag --points-at HEAD: v0.1.0
- working tree limpo pre e pos rebuild (Distribuicao-Final gitignored)

Validacoes pre-rebuild:
- npm run audit:i18n verde (655/655/655)
- npm run build:web verde

Artefatos regenerados:
- Web dist: ~700 kB gzip (npm run build:web)
- Desktop arm64: VoiceIdeas.app + VoiceIdeas_0.1.0_aarch64.dmg (3.22 MB)
- Desktop Intel: VoiceIdeas.app + VoiceIdeas_0.1.0_x64.dmg (3.31 MB)
- Android APK debug: app-debug.apk (4.72 MB)
- Android AAB release: app-release.aab (3.44 MB)
- iOS simulator .app: compilado OK em /tmp/ios-derived
- iOS device .app: instalado + lancado no iPad fisico (Personal Team,
  Apple ID free). bundleID com.voiceideas.mobile. Launch confirmado
  pelo devicectl.

Distribuicao-Final/ atualizado com 4 artefatos novos (substituindo
versoes stale de Mar 20-21):
- VoiceIdeas-macOS-AppleSilicon.dmg
- VoiceIdeas-macOS-Intel.dmg
- VoiceIdeas-Android-arm64.apk
- VoiceIdeas-Android-arm64.aab

Verificacoes nos bundles:
- Secrets (OPENAI_API_KEY / VITE_OPENAI / SUPABASE_SERVICE_ROLE /
  BRIDGE_SHARED_SECRET / sk-): 0 hits em todos os 5 bundles
- Regression markers (Conta VoiceIdeas, Bardo conectado, Importado
  no Bardo, Reenviar ultimo conteudo, useSnapshot, Conexao com o
  Bardo disponivel): TODOS presentes em web/Android/iOS. Desktop
  .app tem JS comprimido dentro do binario Tauri — markers
  deduzidos transitivamente (dist/ source verificado direto).

iPad Personal Team:
- Install: bundleID com.voiceideas.mobile registrado em /private/var
- Launch: confirmado via devicectl
- Warning "No provider was found" do provisioning lookup e benigno
  (esperado em Personal Team free)

Tag NAO foi movida. Commit docs deste rebuild fica adiante de v0.1.0.
Binarios refletem o mesmo codigo da tag (apenas rebuild).

Proximo bloco: definido por Gian.

### VI_RELEASE.IOS_IPAD.3 — CONCLUIDA smoke visual (2026-05-12)

Usuario (Gian) confirmou: "o app esta rodando e funcionando" no iPad fisico
apos install+launch via devicectl.

Tabela final de plataformas (versao 0.1.0):
- Web: funcional
- VI <-> Bardo: ciclo fechado
- Desktop macOS arm64: funcionando
- Android: funcionando
- iPad iOS local: funcionando
- App Store/TestFlight: aguardando Apple Developer paga

Limitacoes conhecidas (Apple ID free):
- cert dura 7 dias; rebuild+reinstall depois
- App Store/TestFlight bloqueados ate Apple Developer paga

VoiceIdeas validado para uso local multiplataforma em 0.1.0.

Proximos passos sugeridos:
- housekeeping do working tree
- checklist final de release local 0.1.0 (tag git, changelog, snapshot
  dos artefatos)
- smokes pre-distribuicao publica (quando aplicavel)

### VI_RELEASE.IOS_IPAD.2 — CONCLUIDA install+launch CLI (2026-05-12)

App instalado e lancado no iPad fisico via xcodebuild + devicectl. Smoke visual
pendente (5 cliques manuais pelo Gian no iPad).

Signing (Gian configurou no Xcode antes da task):
- CODE_SIGN_STYLE=Automatic, CODE_SIGN_IDENTITY="iPhone Developer"
- DEVELOPMENT_TEAM=XDFKA49BZ7 (Apple ID free / Personal Team)
- PRODUCT_BUNDLE_IDENTIFIER=com.voiceideas.mobile (mantido sem conflito)
- MARKETING_VERSION=0.1.0, CURRENT_PROJECT_VERSION=2

iPad:
- Agencia Capitolio (iPad 6th gen A1954, UDID 5D0F9B77-...)
- devicectl state: connected

Build device:
- DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild
  -project ios/App/App.xcodeproj -scheme App -configuration Debug
  -destination "platform=iOS,id=<UDID>" build
- ** BUILD SUCCEEDED **
- App.app em /tmp/voiceideas-ios-device/Build/Products/Debug-iphoneos/

Install (CLI):
- xcrun devicectl device install app --device <UDID> <App.app>
- "App installed: bundleID=com.voiceideas.mobile, databaseUUID=AE0685F6-..."

Launch (CLI):
- xcrun devicectl device process launch --device <UDID> com.voiceideas.mobile
- "Launched application with com.voiceideas.mobile bundle identifier"
- (warning "No provider was found" antes do launch e benigno em Apple ID free; nao impacta)

Bundle metadata do .app instalado:
- CFBundleDisplayName=VoiceIdeas
- CFBundleIdentifier=com.voiceideas.mobile
- CFBundleShortVersionString=0.1.0
- CFBundleVersion=2

Bridge sanity: 8 markers todos 1 match cada, 0 OPENAI_API.

Limitacoes conhecidas (Apple ID free):
- Cert dura 7 dias; depois precisa rebuild+reinstall
- Sem push notifications, app groups, app capabilities especiais (VoiceIdeas
  nao usa nenhum desses)
- App Store / TestFlight bloqueados ate Apple Developer paga

Smoke visual pendente (Gian no iPad):
- app abre / login / Settings / card Conta VoiceIdeas / microfone /
  gravacao basica / safe capture

### VI_RELEASE.IOS_IPAD.1 — CONCLUIDA local (2026-05-12), instalacao iPad fora de escopo

iOS alinhado em versao 0.1.0 e projeto pronto para abrir no Xcode.
Build simulator OK como validacao de compilacao.

Mudancas:
- ios/App/App.xcodeproj/project.pbxproj:
  - MARKETING_VERSION 1.0 -> 0.1.0 (CFBundleShortVersionString)
  - CURRENT_PROJECT_VERSION 1 -> 2 (CFBundleVersion)
  - Debug + Release configs

Sync:
- npm run ios:sync executou build:native-web + cap sync ios + mobile-icons
- web assets copiados para ios/App/App/public/assets/
- 6 plugins Capacitor resolvidos (app/browser/filesystem/keep-awake/audio-recorder/speech-recognition)
- 18 PNGs de icone iOS + Contents.json

Bundle iOS validado:
- 8 bridge markers presentes (Importado/Reenviar/Conta VoiceIdeas/etc)
- chunks da ponte: ConnectBardo, bardoAccountLinkService, Settings, organizedIdeaService
- 0 ocorrencias de OPENAI_API

Build simulator:
- DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
- BUILD SUCCEEDED
- App.app 7.7 MB gerado com CFBundleShortVersionString=0.1.0, CFBundleVersion=2, bundleId=com.voiceideas.mobile
- Toolchain: Xcode 26.4 (build 17E192)
- Nota: xcode-select aponta para CommandLineTools no sistema; usamos DEVELOPER_DIR env para nao precisar de sudo

Hardware:
- iPad fisico pareado detectado: Agencia Capitolio (6th gen, A1954)
- Instalacao no iPad NAO foi feita: requer signing identity / Personal Team / Apple Developer paga

APP STORE / TESTFLIGHT FORA DE ESCOPO desta task:
- usuario ainda NAO possui conta Apple Developer paga
- VI_RELEASE.IOS_IPAD.1 e apenas alinhamento + build local validado
- Submission App Store, TestFlight e signing release ficam bloqueados ate
  conta Apple Developer (US$ 99/ano) ser adquirida

Caminho para o user instalar manualmente no iPad (free sideload, 7 dias):
1. Habilitar Developer Mode no iPad (Settings -> Privacy & Security)
2. npm run ios:open (abre Xcode)
3. Signing & Capabilities -> Team = Apple ID pessoal (free)
4. Selecionar device "Agencia Capitolio"
5. Click ▶ (Build & Run)
6. Confiar no certificate em Settings -> General -> VPN & Device Management

Proximos passos:
- iOS / App Store: bloqueado ate user adquirir Apple Developer paga
- Smokes pre-distribuicao publica (Android lock-screen, signing release, notarizacao)

### HOTFIX.LINK.1.REVOKE_GIAN — CONCLUIDA (2026-05-12)

Hotfix manual de Gian revogado com seguranca apos validacao completa do
fluxo automatico via count4all.

Estado pre-revogacao:
- bardo_account_links: 2 rows, ambas active
  - a5273c62-... (Gian hotfix, criado 2026-04-19) — active
  - b2b1f238-... (count4all real, criado 2026-05-11) — active

UPDATE executado:
  UPDATE public.bardo_account_links
  SET link_status='revoked', revoked_at=now(), updated_at=now()
  WHERE id='a5273c62-7c51-46ad-b8cd-dc4942803f65'
    AND link_status='active' AND revoked_at IS NULL
  RETURNING ...;

Estado pos-revogacao:
- a5273c62-... — revoked, revoked_at=2026-05-12 12:09:51, linked_at preservado
- b2b1f238-... — active (intocado)
- total: 2 rows (zero deletes), 1 active, 1 revoked

Validacoes:
- npm build verde
- supabase migration list sincronizada (ultima: 202605120003)
- supabase functions list: bridge stack intacta
  - export-to-cenax v9, bridge-items v6, bridge-exports v6,
    link-bardo-account v2, bridge-identity-check v2

Garantias:
- historico preservado (linked_at mantido)
- nenhum delete executado
- count4all intocado
- bridge-exports continua exigindo vinculo ativo (P1.3+)

Validacao operacional sugerida (nao bloqueia):
Na proxima abertura do Inbox Bardo pelo Gian, esperar 403
ACCOUNT_LINK_REQUIRED -> CTA do Bardo -> /connect-bardo automatico ->
nova row em bardo_account_links via fluxo limpo. Isso fecha o ciclo
sem precisar de hotfix manual.

### VI_RELEASE.DEVICE_SMOKE.1 — CONCLUIDA (2026-05-12)

Usuario (Gian) confirmou:
- APK Android instalou (versionCode=2) e abre no device, com icone correto
- Desktop .app/.dmg abre e funciona
- Versao 0.1.0 alinhada em package.json, build.gradle, tauri.conf.json e Cargo.toml

Artefatos prontos:
- dist/VoiceIdeas_0.1.0_aarch64.dmg (3.1 MB)
- dist/VoiceIdeas.app (8.6 MB)
- android/app/build/outputs/apk/debug/app-debug.apk (4.7 MB)
- android/app/build/outputs/bundle/release/app-release.aab (3.4 MB)

npm build: verde (refletindo agora version 0.1.0)

Risco remanescente (pre-distribuicao publica):
- Android lock-screen capture long (>10min): nao exercitada
- Android recuperacao apos process death: nao exercitada
- Android keystore Play Store proprio: ainda debug keystore no AAB
- Desktop notarizacao Apple Developer ID: nao feita
- Desktop build Intel/universal: ainda so arm64
- iOS / App Store readiness: nao iniciada

Para uso pessoal/desenvolvimento, ambos os clientes (Android e Desktop)
estao operacionais. Para distribuicao publica em loja, os smokes/processes
acima sao necessarios.

### VI_RELEASE.ANDROID.1 — CONCLUIDA build (2026-05-12), device real PENDENTE

Builds gerados:
- debug APK: android/app/build/outputs/apk/debug/app-debug.apk (4.5 MB)
- release AAB: android/app/build/outputs/bundle/release/app-release.aab (3.3 MB)
- BUILD SUCCESSFUL in 42s (606 actionable tasks)

Metadata:
- applicationId: com.voiceideas.mobile
- versionCode: 1, versionName: 1.0
- minSdk: 24, target: 36, compile: 36

Manifest sanity:
- perms RECORD_AUDIO, FOREGROUND_SERVICE_MICROPHONE, WAKE_LOCK presentes
- CaptureForegroundService com foregroundServiceType="microphone"
- MainActivity registra SecureCapturePlugin

Bridge stack confirmada no bundle:
- ConnectBardo-BHFvfVZR.js, bardoAccountLinkService-B3Bmss68.js,
  Settings-C5B5zmwy.js, organizedIdeaService-C2QptA7I.js presentes
- 8 markers ponte: todos com 1 match cada
- 0 ocorrencias de VITE_OPENAI_API_KEY/OPENAI_API_KEY

Limitacao critica:
- Nenhum device Android conectado nesta rodada (adb devices vazio)
- LOCK SCREEN CAPTURE NAO TESTADA em hardware real
- Recuperacao apos process death nao exercitada
- Nao declarar Android "release-ready" para Play Store sem este smoke

Pendencias de release:
- Smoke real com device fisico (instalar APK debug, login, captura segura,
  lock screen >=10min, confirmar manifesto/chunks/nota final)
- Assinatura release com keystore Play Store (hoje AAB sai com debug keystore)
- Submissao Play Store

Working tree note: idem desktop — modificacoes/untracked pre-existentes
do Gian nao relacionadas a esta task; ZERO codigo alterado nesta rodada,
apenas docs atualizados.

### VI_RELEASE.DESKTOP.1 — CONCLUIDA (2026-05-12)

Build desktop arm64 gerado e validado.

Artefatos:
- src-tauri/target/release/bundle/macos/VoiceIdeas.app (8.6 MB)
- src-tauri/target/release/bundle/dmg/VoiceIdeas_0.1.0_aarch64.dmg (3.1 MB)
- Copias em dist/VoiceIdeas.app + dist/VoiceIdeas_0.1.0_aarch64.dmg

Metadata:
- arch: arm64 (aarch64-apple-darwin)
- versao: 0.1.0
- bundle id: com.voiceideas.desktop
- URL scheme: voiceideas://
- signing: adhoc/linker-signed (nao-notarizado)

Bridge stack verificada (grep em desktop-dist/assets/):
- "Importado no Bardo", "Reenviar ultimo conteudo", "Conta VoiceIdeas",
  "Conexao com o Bardo disponivel", "external_integrations_enabled",
  "useSnapshot", "A fonte original mudou", "Bardo conectado": todas presentes
- chunks ConnectBardo, bardoAccountLinkService, organizedIdeaService,
  Settings com as ultimas alteracoes

Seguranca:
- 0 ocorrencias de VITE_OPENAI_API_KEY/OPENAI_API_KEY (P0.3 mantido)
- envs Supabase presentes (backend = mesmo do web)

Pendencias de release (nao bloqueiam build):
- Notarizacao Apple Developer ID
- Submissao App Store
- Build Intel/universal (somente arm64 hoje)

Validacoes:
- npm run build verde
- npm run desktop:build verde (exit 0)
- artefatos presentes nos paths esperados

Working tree note: o repo tem varias modificacoes/untracked pre-existentes
nao relacionadas a esta task (BardoConnectionToggle, useBardoAccountLink,
docs antigos). NADA foi alterado de codigo nesta task; somente a doc
foi atualizada.

Criterio de aceite (VI side, todos atendidos):
- [x] endpoint VI existe, deployado e ACTIVE
- [x] JWT obrigatorio (401 sem auth, 401 com bogus token)
- [x] `vi_user_id` derivado do JWT, nunca do body
- [x] vinculo idempotente, revoga ativos diferentes antes de inserir
- [x] `bridge-inbox` continua exigindo vinculo ativo (P1.3 preservado)
- [x] build verde, remoto operacional

### P1.1 Endurecer fluxo de "Separar ideias" com auth resiliente
Sintoma historico:
- erro `401 Invalid JWT` / "Sua sessao expirou".

Escopo:
1. validar refresh/relogin no caminho de fila sem travar usuario.
2. adicionar retry controlado e mensagens consistentes.
3. registrar causa raiz quando for erro de sessao vs infra.

Criterio de aceite:
- cenarios de sessao expirada se recuperam com relogin claro.
- fila nao fica em loop de erro opaco.
- logs permitem diferenciar auth x infra.

Arquivos chave:
- `src/lib/functionAuth.ts`
- `src/services/serviceAuth.ts`
- `src/utils/captureQueueErrorMessage.ts`
- `src/pages/CaptureQueue.tsx`

### P1.2 Validar ponta-a-ponta bridge com dados reais de safe_capture
Escopo:
1. gerar sessao real de safe capture.
2. materializar `note` e `organized_idea`.
3. sync para `bridge_items`.
4. exportar com `export-to-cenax`.
5. confirmar vinculo em `bridge_exports.bridge_item_id`.

Criterio de aceite:
- item elegivel aparece em `bridge_items`.
- export cria row em `bridge_exports` vinculada.
- status evolui para `published/consumed` ou `blocked` conforme retorno.

### P1.3 Fechar observabilidade minima operacional
Escopo:
1. padronizar logs de erro no frontend e functions.
2. incluir correlation keys (sessionId, chunkId, bridgeItemId, exportId).
3. criar runbook de incidentes de captura e bridge.

Criterio de aceite:
- incidentes comuns podem ser diagnosticados sem engenharia reversa.

## 4) Prioridade P2 (melhoria estrutural apos estabilidade)

### P2.1 Limpeza de tipos bridge
Problema:
- `src/types/bridge.ts` mistura contratos novos e legado.

Escopo:
1. separar `types/bridge-legacy.ts` e `types/bridge-v1.ts` (ou equivalente).
2. migrar imports para reduzir acoplamento.
3. remover tipos mortos.

Criterio de aceite:
- tipagem reflete um contrato por fluxo, sem ambiguidade.

### P2.2 Telemetria de captura Android
Escopo:
1. registrar metricas basicas de sessao/chunks/erros.
2. dashboard simples para taxas de falha.

Criterio de aceite:
- visibilidade real de confiabilidade por versao.

### P2.3 Politica de retencao de artefatos locais Android
Escopo:
1. definir limpeza de sessoes antigas.
2. preservar somente o necessario para retry.

Criterio de aceite:
- armazenamento local nao cresce indefinidamente.

### P2.4 VI_SECURITY.INVITE_ERROR_CODES (pos-release 0.1.0)
Origem: audit 2026-05-12, findings F1 + F5 (low severity).

Problema:
- Cliente em locale != pt-BR suprime mensagens do backend para evitar
  leak de português, colapsando estados distintos (token expirado,
  revogado, rate-limited, email mismatch) em uma mensagem generica.
- Detecção de account-mismatch usa heuristica .includes('mesmo email
  do convite') em substring pt-BR — quebra silenciosamente se backend
  for localizado ou frase mudar em refactor.

Escopo:
1. Edge functions (accept-idea-invite, preview-idea-invite,
   share-idea, link-bardo-account) retornam:
   { error: string (human-readable pt-BR), error_code: 'invite_expired'
     | 'invite_revoked' | 'email_mismatch' | 'rate_limited' |
     'invalid_token' | 'already_accepted' | ... }
2. Cliente (AcceptInvite.tsx, ShareIdeaModal.tsx) parar de usar
   substring .includes(); switch-case em error_code.
3. Catálogo i18n adicionar chaves invite.error.byCode.<code> para
   cada error_code suportado, em pt/en/es.
4. account-mismatch flow (linha 108-114) detecta via
   error_code === 'email_mismatch', não mais via substring pt-BR.

Criterio de aceite:
- Usuários en/es veem mensagem de erro específica para o estado real.
- account-mismatch UI dispara independente da língua do backend.
- Adicionar teste manual: forçar cada error_code via mock e validar
  rendering em 3 locales.

Prioridade: P2 (não bloqueia release; é robustez de UX de erro).
Risco: alterar 4 edge functions pós-tag — testar isolado antes de
deploy. Versão Bardo do consumer não afetada.

### P2.5 VI_BARDO.IDENTITY_LINK_HARDENING (pos-release 0.1.0)
Origem: audit 2026-05-12, findings F2 (low) + F4 (info).

Problema:
- bardo_user_id é self-attested no fluxo atual: usuário VI digita
  qualquer string em BardoConnectionToggle e VoiceIdeas persiste como
  vínculo canônico em bardo_account_links. Verificação de ownership é
  delegada ao consumer Bardo. Funciona para 0.1.0, mas é débito
  arquitetural — se bridge virar superfície importante, modelo correto
  é Bardo iniciar o link, não o cliente VI declarar.
- bardo_user_id completo renderizado no DOM em
  BardoConnectionToggle.tsx:193-194 (SignedInAccountCard.tsx:113 já
  trunca via .slice(0, 8)). Tratamento inconsistente.

Escopo:
1. Truncamento imediato: aplicar mesmo .slice(0, 8) em
   BardoConnectionToggle.tsx:193-194:
   <code>{link.bardo_user_id.slice(0, 8)}…</code>
   + opcional toggle "show full" se necessário para debug.
2. Documentar em link-bardo-account/index.ts comentário de cabeçalho
   esclarecendo a expectativa de validação Bardo-side no consumer.
3. (Futuro ideal) Substituir self-attestation por handshake assinado:
   - Bardo inicia link → emite token de bind one-time assinado (JWT/HMAC).
   - VoiceIdeas recebe token, valida assinatura, persiste vínculo.
   - Elimina possibilidade de cross-system identity confusion.

Modelo atual:
   cliente informa bardo_user_id → VoiceIdeas aceita → Bardo valida depois

Modelo futuro:
   Bardo inicia link → token assinado one-time → VoiceIdeas confirma → vínculo criado

Criterio de aceite:
- Etapa 1 (truncamento): nenhum bardo_user_id completo renderizado em
  DOM de produção.
- Etapa 2 (doc): expectativa de validação Bardo-side explícita no
  código da edge function.
- Etapa 3 (handshake assinado): bloqueio explícito da escrita de
  link sem token válido emitido pelo Bardo.

Prioridade: P2 etapas 1-2 (curto prazo); P3 etapa 3 (planejamento
conjunto com Bardo). Depende de criticidade do bridge na roadmap.

## 5) Critérios de "pronto para handoff ao Bardo consumidor"
- `bridge-items` autenticado e estavel.
- RLS validada por usuario.
- filtros `bridge_status`, `validation_status`, `destination_kind`, `content_type` funcionando.
- fluxo de exportacao com idempotencia minima comprovado.
- docs de contrato e exemplos de payload atualizados.

## 6) Matriz de testes recomendada

### 6.1 Qualidade de codigo
- `npm run docker:lint`
- `npm run docker:build`

### 6.2 Sync/build Android
- `npm run android:sync`
- `cd android && ./gradlew assembleDebug`

### 6.3 Bridge/DB remoto
- `npx supabase db push --linked`
- deploy functions bridge
- `supabase db query --linked --file supabase/bridge_smoke_v5.sql`
- `supabase db query --linked --file supabase/bridge_verify_e2e.sql`

### 6.4 Fluxo funcional web
1. login
2. abrir capture queue
3. separar ideias
4. transcrever trecho
5. salvar nota
6. exportar item elegivel
7. validar historico de exportacao

## 7) Definicao de pronto final (release-ready)
- sem fluxo critico dependente de caminho legado.
- sem segredo sensivel exposto no cliente.
- sem erro auth recorrente bloqueando fila.
- bridge catalogo e export estaveis no remoto.
- Android safe capture validado em device real com lock screen.
- documentacao atualizada apos cada marco.
