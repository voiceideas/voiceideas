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
