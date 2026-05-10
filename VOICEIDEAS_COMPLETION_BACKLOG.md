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
