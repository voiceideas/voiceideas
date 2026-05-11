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
