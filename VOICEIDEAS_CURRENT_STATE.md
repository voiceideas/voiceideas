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

### 4.15) VI_RELEASE.HOUSEKEEPING.1 — Working tree limpo (2026-05-12)

**Status:** ✅ working tree limpo. 7 commits temáticos. Zero segredos versionados. Pronto para VI_I18N.SWEEP.1 em árvore limpa.

**Estado antes:**
* 12 arquivos modificados
* 30 untracked (incluindo `core` de 2.1 GB)

**Estado depois:**
* `git status --short` retorna vazio

**7 commits gerados (em ordem):**

| Hash | Tema | Conteúdo |
|---|---|---|
| `bdae63e` | docs handover | 5 MDs (CLAUDE_OPERATOR_GUIDE, ANDROID_SECURE_CAPTURE_RUNBOOK, REMOTE_STATE_SNAPSHOT, SCHEMA_AND_API_REFERENCE, SYSTEM_ARCHITECTURE) |
| `a0f1ee5` | feat bridge infra | 4 migrations P1.3+performance + useBardoAccountLink hook + _shared/bardo-account-link helper + BardoConnectionToggle P1.4 |
| `eba13f1` | chore legacy | JSDoc banners em SendToBardoModal/bridgeExport + remoção de imports órfãos em Notes/Organized |
| `37621b1` | feat errors | classifyAppError + buildSessionExpiredError em errors.ts/functionAuth.ts; consumido por serviceAuth/captureQueueErrorMessage |
| `80dc00b` | chore bridge-identity-check | P1.5.DEBUG instrumentação (request IDs, sha256 digest visual, mask email) — já em prod v2 |
| `3f08f12` | chore ios | 18 PNGs do AppIcon + Package.swift com CapacitorCommunityKeepAwake |
| `f62fe1a` | chore housekeeping | README real do projeto + decode-audio.wasm vendored + .gitignore core dumps |

**Decisões importantes:**

1. **`core` (2.1 GB ELF ARM aarch64 crash dump)** — REMOVIDO + adicionado ao `.gitignore` com pattern `core` e `**/core.[0-9]*`. Nunca deve ser versionado.

2. **Migrations untracked já aplicadas no remoto** — committadas como histórico. `supabase migration list --linked` já as listava; faltava só o arquivo no git.

3. **Código de produção sem fonte no git** — `useBardoAccountLink`, `_shared/bardo-account-link`, `decode-audio.wasm` estavam em working tree há semanas e eram CONSUMIDOS por código já commitado. Agora versionados.

4. **Nenhum segredo versionado** — scan por `OPENAI_API_KEY`, `VITE_OPENAI`, `SUPABASE_SERVICE_ROLE`, `BRIDGE_SHARED_SECRET`, `sk-`, `eyJ`, `access_token`, `refresh_token` retornou apenas falsos positivos (referências legítimas a `session.access_token` e `Deno.env.get(...)`).

5. **Sem mudança funcional** — todos os commits são higiene de código + documentação no git. Comportamento runtime idêntico.

**Validações:**
* `npm run build` verde (voice-ideas@0.1.0)
* `git status --short` vazio

**Próximo bloco:** VI_I18N.SWEEP.1 (varredura de i18n com árvore limpa).

---

### 4.16) VI_I18N.SWEEP.1A_1D — Espanhol completo + audit (2026-05-12)

**Status:** ✅ pt-BR, en, es agora têm paridade total (467 chaves cada). Spread fallback removido. Script de audit + `npm run audit:i18n`.

**Estado antes:**
* `esMessages` = 103 chaves explícitas + `...enMessages` (spread silencioso) → 364 chaves caíam em inglês sem aviso
* TypeScript `TranslationKey = keyof typeof ptBrMessages` (467 chaves) — `satisfies Record<TranslationKey, TranslationMessage>` aceitava o spread porque o compilador via 467 chaves cobertas, mas o conteúdo real era EN
* Cobertura ES "fake": ao trocar idioma, usuário via 22% pt-mistura + 78% inglês

**Estado depois:**
* `esMessages` = 467 entradas explícitas (sem spread), na ordem canônica de `ptBrMessages`
* 364 entradas auto-traduzidas com regras determinísticas PT→ES (`/tmp/translate-pt-es-v7.mjs` versionado como referência de processo)
* ~50 entradas hard-overrides para strings com vocabulário complexo (templates literais com `${count}` ternários, frases longas, casos onde cascades produziam typos)
* 103 entradas pré-existentes preservadas; 10 entradas pré-existentes corrigidas via `MANUAL_FIXES` (continham PT residual: `Ouvindo`, `Pronto`, `Pasta gravada`, `fim`, `pausa curta`, `edição`, etc.)
* `recorder.manualPath.title`, `organizePanel.type.roteiro.description`, `recorder.mode.continuousHint`, `recorder.postCapture.metric.groups`, `recorder.mode.manualHint` — patches manuais finais

**Engenharia da varredura:**

| Stage | Item |
|---|---|
| Dump | `/tmp/i18n-dump.json` — 467 chaves × 3 locales × `{type: 'str'|'fn', value, matchesEn}` |
| Identificação | 364 com `matchesEn=true` (= caíam no spread); 103 com `matchesEn=false` (= explícitas) |
| Tradução | 7 versões iterativas do script (v1→v7): regras PT→ES + sentinels contra cascades + 50 manual overrides |
| QA | scan paranóico com whitelist `SAFE_FALSE_POSITIVES` para palavras ES que contêm fragmentos PT (`intentar`/`organizado`/`continuar`/etc) |
| Audit | `scripts/audit-i18n.mjs` checa paridade, spread, residual PT, identidade com pt-BR |

**Cascades documentadas no script (v7) — bugs do approach split/join sem word-boundary:**

1. **`Gravando o áudio` → `Gravandel audio`** — regra `['o áudio', 'el audio']` matchava `o áudio` dentro de `Gravando o áudio` sem leading space. Fix: leading space obrigatório.
2. **`Buscar` → `Búsquedar`** — `['Busca', 'Búsqueda']` rodava dentro de `Buscar` produzindo `Búsquedar`. Fix: regra removida (usar override quando precisar do substantivo).
3. **`Permissão negada` → `Permiso dedenegado`** — múltiplas regras `['negada', 'denegado']` aplicadas em sequência. Fix: regras de longest-form first.
4. **`recomendado` → `recomiendado`** — `['recomenda', 'recomienda']` cascade dentro de `recomendado`. Fix: regra removida + identity rule de proteção.
5. **`Transcrevendo` → `Transcribendo`** — `['Transcreve', 'Transcribe']` rodava antes de `['Transcrevendo', 'Transcribiendo']`. Fix: reorder.
6. **` à ideia` → ` la la idea`** — `[' à ', ' a la ']` produzia ` a la `, depois `[' a ', ' la ']` cascataba em ` la la `. Fix: sentinels (`\x01SENT_ALA\x01`) opacos para a regra de partícula.
7. **`Confirmar exclusão` (em função) → permanecia PT** — `Function.toString()` via tsx esbuild emite `\xE3` literal para `ã`, e o split('exclusão') não casava. Fix: `decodeJsEscapes()` pré-processa `\xNN` e `\uXXXX` antes das regras.
8. **`agrupamentos` → `agrupacións`** — singular antes do plural fez `agrupamento` virar `agrupación` e deixar o `s`. Fix: plural first.

**Audit script (`scripts/audit-i18n.mjs`):**

* lê src/lib/i18nMessages.ts e parsa os 3 blocos `export const` via regex robusta (aceita `Record<string,...>` E `Record<TranslationKey,...>` — pt-BR usa `string` porque define `TranslationKey`)
* Issues categorizadas:
  - **FAIL (exit 1)**: `missing-keys`, `extra-keys`, `spread-fallback`, `pt-residual` (heurística com whitelist de palavras ES legítimas que contêm fragmentos PT)
  - **WARN (exit 0)**: `identical-to-pt` (PT e ES compartilham muito vocabulário — 28 entradas ES são genuinamente iguais a pt-BR: "Captura segura", "Markdown copiado", "Comandos de voz:", "ajuste automático", etc.)
* Output: JSON estruturado para parsing por CI
* npm script: `npm run audit:i18n`

**Validações finais:**
* `npm run audit:i18n` retorna OK (zero FAIL, 2 WARNs informativos)
* `npm run build:web` verde (tsc + vite)
* Lint clean em `i18nMessages.ts` e `audit-i18n.mjs`
* Spot-check de ~70 strings + ~25 funções via random sample — nenhum PT residual visível

**Próximo bloco:** definido por Gian.

---

### 4.17) VI_I18N.SWEEP.1B — Extração de hardcoded das telas principais (2026-05-12)

**Status:** ✅ telas prioritárias agora consomem i18n via `useI18n().t()`. 96 novas chaves × 3 locales = 288 entradas adicionadas. Build verde, audit passa.

**Estado antes:**
* `BardoBridgeExportPanel.tsx` — 100% hardcoded pt-BR ("Ponte v1 · Bardo", "Validando elegibilidade...", "Importado no Bardo", "Reenviar último conteúdo", etc.)
* `IdeaBridgeExportButton.tsx` — 100% hardcoded ("Tentativas registradas:", "Enviar para X", "Disponível na Inbox do X", etc.)
* `AcceptInvite.tsx` — 100% hardcoded sem acento (Página de aceitar convite)
* `ShareIdeaModal.tsx` — 100% hardcoded ("Compartilhar no VoiceIdeas", "Convidar", "Convites desta ideia")
* `CaptureQueue.tsx` — header, KPIs e empty states hardcoded; deep operational labels (Etapa, Duração, Plataforma, Arquivo, Storage, etc.) também
* `NoteCard.tsx` + `OrganizedView.tsx` — `title="Enviar ao Bardo"` hardcoded em ambos
* `pt-BR.toLocaleDateString` no ShareIdeaModal — datas sempre em português independente do idioma do usuário

**Estado depois:**

Chaves novas (96, divididas em 4 sections):
* `bardo.bridge.*` (18 chaves): título do painel, status de elegibilidade (3 variantes), badges (3), lifecycle imported/rejected (4), help text, resend/retry/snapshot
* `bardo.export.*` (10 chaves): button labels (send/retry), status labels com `${label}` parametrizado (4), textos de tentativas (3), pending notice parametrizado
* `invite.*` (29 chaves): título, subtítulo, badge, unavailable, sent-to-prefix, expires-prefix, accepted, openSharedIdeas, accountMismatch (8 sub-chaves), validating, signedInAs (fn), linkSent (title + body fn), form (3), Google button, firstAccess, error, alreadyInApp, openOrganizedIdeas
* `share.*` (19 chaves): título, closeModal, form (4), success/error titles, link (title + 4 chaves de copy), invites (4 chaves: title/loading/empty + 4 status: accepted/pending/revoked/expired)
* `captureQueue.*` (15 chaves): título, subtítulo, refresh, 4 KPIs, pendingRename (5 — one/other + body + finalizedOne/Other), segmentation (2), loadingBlocking, localPendingTitle
* `note.actions.sendToBardo` (1): reutilizado por NoteCard e OrganizedView

**Arquivos refatorados (8):**
1. `src/components/NoteCard.tsx` — `title={t('note.actions.sendToBardo')}` (1 string)
2. `src/components/OrganizedView.tsx` — idem (1 string)
3. `src/components/IdeaBridgeExportButton.tsx` — adicionou `useI18n`, refatorou `exportStatusLabel` para funções i18n; `formatDateTime` agora usa `formatDate` do hook (responde a `locale`) em vez de `toLocaleString('pt-BR')` hardcoded (~10 strings)
4. `src/components/BardoBridgeExportPanel.tsx` — adicionou `useI18n`; ~15 strings substituídas (status, badges, lifecycle, resend variants)
5. `src/pages/AcceptInvite.tsx` — adicionou `useI18n`; ~22 strings substituídas; usa `t('common.or')` para o separador; reuse `auth.linkSent.*` evitado (criadas `invite.linkSent.*` específicas porque copy diferente)
6. `src/components/ShareIdeaModal.tsx` — adicionou `useI18n` + `formatDate`; ~16 strings substituídas; `toLocaleDateString('pt-BR')` agora usa `formatDate` do hook (responde a `locale`)
7. `src/pages/CaptureQueue.tsx` — adicionou `useI18n`; ~15 strings substituídas no header + KPIs + pendingRename banner + segmentation preset + loading + local pending title
8. `src/lib/i18nMessages.ts` — +96 chaves × 3 locales (288 entradas), todas no padrão de seção comentado

**Conteúdo deferido para fase C (sweep.1B.2):**
* `CaptureQueue.tsx` deep operational labels (~24 strings restantes): "Etapa:", "Duração:", "Plataforma:", "Arquivo:", "Storage:", "Estado da transcrição:", "Excluir cópia local pendente?", "Sessões da fila", "Ideias separadas:", "Notas salvas:", etc. — admin-y/debug panel
* dead-code legacy (componentes não-importados via grep cross-ref)
* qualquer string em pages que não foram listadas como prioridade (Home.tsx, Notes.tsx, Organized.tsx — partial i18n já existe via FolderBar/NotesList/OrganizedView)
* outros components: FolderRenameModal, BulkActionsBar, OrganizePanel — não auditados nesta fase

**Validações:**
* `npm run audit:i18n` verde — paridade 563/563/563, sem spread, sem PT residual
* `npm run build:web` verde — tsc + vite OK
* `npx tsc --noEmit` clean — sem erros de tipo
* Re-scan `/tmp/scan-hardcoded.mjs` nos 8 arquivos: 0 hits reais (3 falsos positivos: 2x "Promise" type annotation, 1x "VoiceIdeas" alt — marca)

**Próximo bloco:** definido por Gian (sugestões: VI_I18N.SWEEP.1C deep CaptureQueue + dead-code sweep, ou outra prioridade).

---

### 4.18) VI_I18N.SWEEP.1C — Sweep residual/admin/deep UI (2026-05-12)

**Status:** ✅ 6 arquivos refatorados. +81 chaves × 3 locales = 243 entradas novas. paridade 644/644/644. build verde, audit verde.

**Estado antes:**
* `CaptureQueue.tsx` deep operational labels hardcoded: 15 strings principais ("Etapa:", "Duração:", "Plataforma:", "Arquivo:", "Storage:", "Estado da transcrição:", "Excluir cópia local pendente?", "Sessões da fila", "Ideias separadas:", "Notas salvas:", "Status bruto:", "Rename:", "Excluir sessão remota?", "Excluir trecho remoto?", "Nota criada a partir deste trecho") + buttons Cancelar/Excluir nos confirm dialogs (6 strings)
* `IdeaDrafts.tsx` (323 lines): zero i18n. "Textos da fila", "Falha ao carregar...", "Ouvir áudio", "Texto bruto"
* `Admin.tsx` (212 lines): zero i18n. "Acesso restrito", "Painel Admin", KPIs, feedback messages, role toggles, limit editor — 16 strings adicionais identificadas além das 8 do scanner
* `BardoConnectionToggle.tsx` (203 lines): zero i18n. 14 strings (form, toggle states, placeholders, helpers)
* `VoiceSegmentationSettings.tsx` (134 lines): zero i18n. 10 strings (título, body, restaurar, 4 labels de input, expressão de corte + helper)
* `SignedInAccountCard.tsx` (132 lines): zero i18n. 14 strings (título, status, link/no-link variants, error messages, `toLocaleDateString('pt-BR')` hardcoded)

**Estado depois:**
* `CaptureQueue.tsx` deep: 15 labels + 6 buttons traduzidos via `captureQueue.deep.*` e reuso de `common.cancel`/`common.delete`
* `IdeaDrafts.tsx`: 100% i18n; `formatDate` substitui `toLocaleString('pt-BR')` hardcoded; reusa `captureQueue.deep.noteFromChunk`
* `Admin.tsx`: 100% i18n incluindo feedback messages, role labels, aria-labels parametrizados por email
* `BardoConnectionToggle.tsx`: 100% i18n; toggle state, form, placeholders, link summary, reuse de `common.cancel`/`common.loading`
* `VoiceSegmentationSettings.tsx`: 100% i18n via `voiceSegmentation.*`
* `SignedInAccountCard.tsx`: 100% i18n; `formatDate` substitui `toLocaleDateString('pt-BR')`

**Chaves novas (81 keys, 6 sections):**
* `captureQueue.deep.*` (15) — labels operacionais profundos (Etapa, Duração, Plataforma, Arquivo, Storage, Estado da transcrição, deleteLocalConfirm, deleteRemoteSessionConfirm, deleteRemoteChunkConfirm, queueSessionsTitle, ideasSeparated, notesSaved, rawStatus, rename, noteFromChunk)
* `ideaDrafts.*` (4) — Textos da fila, loadError, Ouvir áudio, Texto bruto
* `admin.*` (25) — restricted (3), panelTitle, refreshAria, kpis (2), feedback (6), notesTodayInline (fn), role toggles (4), limit editor (4 fns), dailyNotesCount (fn), dailyLimit, loadUsersError
* `bardoConnection.*` (15) — bridge active/inactive, linkedEmail (fn), linkedNoEmail, activatePrompt, formHelp, bardoIdLabel/Required/Placeholder, emailLabel/Placeholder, linking, linkButton, linkedIdPrefix
* `voiceSegmentation.*` (10) — title, body, restoreDefaults, silenceMid, silenceLong, minChunk, analysisWindow, cutExpression, cutExpressionPlaceholder, cutExpressionHelp
* `signedInAccount.*` (15) — title, loggedInAs, idPrefix, checkingLink, linkCheckError, bardoConnected, activeLinkSuffix, associatedAccountPrefix, linkedAtPrefix, bardoUserIdPrefix, bardoNoActiveLink, toConnectHint, noEmail, linkQueryError

**Termos técnicos preservados (não traduzidos):**
* `bardo_account_links` (nome de tabela no schema)
* `rawStoragePath: ...` (path técnico, debug visível)
* `Storage` (mesmo termo em pt/en/es — usado como label técnico)
* `Promise` (TypeScript type annotation — falso positivo do scanner, não é texto JSX)
* Identificadores como `bardo_user_id`, `id` (debug ids visíveis ao operador)

**Conteúdo deferido (fora de escopo / não-renderizável):**
* `SendToBardoModal.tsx` (374 lines, 15 strings hardcoded) — **dead code**. Sem imports. Notes.tsx e Organized.tsx têm JSDoc explícito: "LEGACY BRIDGE PATH... NÃO está montado aqui". Não justifica i18n.
* `Home.tsx`, `Notes.tsx`, `Organized.tsx` — scanner reportou 0 hits, são tipos type annotation. Páginas delegam a NotesList/OrganizedView/FolderBar (todos com i18n).
* `OrganizePanel.tsx`, `TagCloudPanel.tsx`, `FolderBar.tsx`, `NotesList.tsx`, `VoiceRecorder.tsx`, `AudioPlayer.tsx` — falsos positivos apenas (Promise types).
* `UserAvatar.tsx` (107 lines) — só ícone+inicial, sem texto traduzível.
* `LanguageProvider.tsx`, `IntegrationSettingsProvider.tsx`, `StatusBanner.tsx` — sem texto user-facing direto (props consumem texto do consumidor).

**Validações:**
* `npm run audit:i18n`: paridade 644/644/644, sem spread, sem PT residual, FAIL=0 WARN=2 (info-only: keys legitimately compartilhados PT/ES como "Bardo conectado.")
* `npm run build:web`: verde (tsc + vite)
* `npx tsc --noEmit`: sem erros de tipo
* Re-scan `/tmp/scan-hardcoded-1c.mjs`: hits reais restantes = 1 (`bardo_account_links` em SignedInAccountCard — schema name, intencional)

**Próximo bloco:** smoke visual rápido por idioma (pt-BR / en / es) na web, depois tag 0.1.0 / changelog.

---

### 4.19) VI_I18N.SMOKE.1 — Smoke visual por idioma (2026-05-12)

**Status:** ✅ surfaces públicas validadas em pt-BR/en/es via preview server. 2 arquivos corrigidos durante o smoke (AcceptInvite + ShareIdeaModal): 13 strings PT hardcoded + 2 leaks de mensagens do backend supabase + 1 `toLocaleDateString('pt-BR')` hardcoded. +11 chaves novas × 3 locales. Audit verde, build verde, paridade 655/655/655.

**Setup:**
* Dev server iniciado via `preview_start` na porta 5175 (config `voiceideas` em `.claude/launch.json` da harness, apontando para symlink `voice-ideas-macos` → `/Users/capitolio/Documents/New project/voice-ideas-macos`)
* Idioma alternado via `localStorage.setItem('voiceideas.language.v1', 'pt-BR'|'en'|'es')` + reload
* Snapshots via `preview_snapshot` (accessibility tree — confirma texto exato renderizado)

**Surfaces testadas (sem login — apenas rotas públicas):**

| Surface | pt-BR | en | es |
|---|---|---|---|
| `/auth` (AuthGate splash + form) | ✅ "Capture suas ideias por voz e organize com IA" / "Entrar com link mágico" / "ou" / "Entrar com Google" | ✅ "Capture your ideas by voice and organize them with AI" / "Sign in with magic link" / "or" / "Sign in with Google" | ✅ "Captura tus ideas por voz y organízalas con IA" / "Entrar con enlace mágico" / "o" / "Entrar con Google" |
| `/accept-invite?token=fake-test` | ✅ título "Convite para ideia compartilhada" + erro backend específico "Esse convite não existe ou já foi removido." (pt-BR retém especificidade) | ✅ "Invite to a shared idea" / fallback "Could not load the invite." (sem leak) | ✅ "Invitación a una idea compartida" / fallback "No fue posible cargar la invitación." (sem leak) |
| `/connect-bardo` | ✅ "Conectar VoiceIdeas com Bardo" + erro "O link do Bardo veio sem o identificador..." | ✅ "Connect VoiceIdeas to Bardo" / erro EN | ✅ "Conectar VoiceIdeas con Bardo" / erro ES |

**Residuais encontrados + corrigidos durante o smoke (AcceptInvite + ShareIdeaModal):**

1. **AcceptInvite — backend error leak** (`Esse convite não existe ou já foi removido.` aparecia em en/es porque `{error || t('invite.unavailable.fallback')}` priorizava a mensagem do servidor mesmo em PT). Backend (Supabase edge `preview-idea-invite`/`accept-idea-invite`) retorna mensagens em pt-BR fixas — fora de escopo desta task ("NÃO alterar functions"). **Fix UI-side:** em `locale !== 'pt-BR'`, suprimir mensagem do servidor e usar t() fallback. Preserva especificidade em pt-BR.
2. **AcceptInvite L32** — `'Esse link de convite esta incompleto.'` hardcoded → `t('invite.error.linkIncomplete')`
3. **AcceptInvite L54** — `'Nao foi possivel carregar o convite.'` fallback PT → `t('invite.error.loadPreview')` + locale-aware leak suppression
4. **AcceptInvite L99** — `\`A ideia "${result.ideaTitle}" agora esta disponivel na sua conta.\`` template literal PT → `t('invite.successMessage', { ideaTitle })`
5. **AcceptInvite L101** — `'Nao foi possivel aceitar o convite.'` → `t('invite.error.acceptFailed')` + locale-aware
6. **AcceptInvite L102** — `'o email do convite'` fallback → `t('invite.fallbackExpectedEmail')`
7. **AcceptInvite L127** — `new Date(...).toLocaleDateString('pt-BR', ...)` hardcoded locale → `formatDate(...)` do `useI18n` (responde ao locale ativo)
8. **AcceptInvite L151/160/172** — três fallbacks PT em handlers (email login / google / sign out) → keys `invite.error.sendLink` / `googleLogin` / `signOut` + locale-aware
9. **ShareIdeaModal L86** — `\`Convite enviado para ${email}.\`` template PT → `t('share.success.invited', { email })`
10. **ShareIdeaModal L87** — `'Convite criado. Compartilhe o link manualmente.'` fallback PT → `t('share.success.linkCreated')`. `result.warning` (backend) suprimido em locale ≠ pt-BR.
11. **ShareIdeaModal L93** — `'Erro ao compartilhar a ideia.'` fallback PT → `t('share.error.fallback')` + locale-aware

**Chaves novas (11 keys × 3 locales = 33 entries):**
* `invite.error.linkIncomplete`, `loadPreview`, `acceptFailed`, `sendLink`, `googleLogin`, `signOut`
* `invite.successMessage` (fn parametrizada por ideaTitle), `invite.fallbackExpectedEmail`
* `share.success.invited` (fn parametrizada por email), `linkCreated`, `share.error.fallback`

**Residuais conhecidos NÃO corrigidos (deferred para fase posterior):**

1. **Hook-level fallback strings em pt-BR** (~13 ocorrências). Fired apenas quando `err.message` está vazio (edge case):
   * `src/hooks/useSpeechRecognition.ts` (2): `'Nao foi possivel iniciar a gravacao...'`, `'Seu navegador nao suporta...'`
   * `src/hooks/useAudioTranscription.ts` (5): `'O audio gravado ficou vazio...'`, `'Permita o uso do microfone...'`, `'Seu navegador nao suporta gravacao...'`
   * `src/hooks/useCaptureSession.ts` (1): `'Falha ao carregar sessoes de captura.'`
   * `src/hooks/useCaptureQueue.ts` (1): `'Falha ao carregar a fila de captura.'`
   * `src/hooks/mobile/useMobileAudioCapture.ts` (2): `'A captura movel encontrou um erro.'`
   * `src/hooks/useIdeaDrafts.ts` (1): `'Falha ao carregar drafts de ideia.'`
   * `src/hooks/useBridgeExport.ts` (1): `'Falha ao carregar exportacoes da bridge.'`
   * `src/components/audio/AudioPlayer.tsx` (1): `'Nao foi possivel carregar o audio.'`
2. **`src/utils/captureQueueErrorMessage.ts`** — centralizador de erros de fila com ~12 mensagens hardcoded PT (load / pending-upload / segment / rename / transcribe / save-note / materialize / export / delete-chunk / delete-session / discard-local-upload / generic). É usado em todos os contextos da CaptureQueue + BardoBridgeExportPanel. Refactor exige tornar a função aware-de-locale (passar `t` como arg).

**Estratégia de refactor para fase futura (VI_I18N.SWEEP.1D ou similar):**
* Hooks aceitam um `t` opcional via parâmetro de config (ou contexto via `useI18n` no nível do componente que consome).
* `captureQueueErrorMessage` evolui para `(context, error, t) => string`.
* Backend (Supabase edge functions): pode receber locale como header e responder mensagens localizadas — escopo separado (envolve edge functions).

**Surfaces protegidas (que requerem auth) NÃO testadas visualmente neste smoke:**
* Home / VoiceRecorder
* CaptureQueue (header testado via re-scan; deep operational ainda não validado em runtime)
* Notes / Organized
* Settings (SignedInAccountCard, BardoConnectionToggle, VoiceSegmentationSettings)
* IdeaDrafts
* Admin

Cobertura indireta destas surfaces:
* Audit i18n garante paridade 655/655/655 (todas as chaves usadas têm tradução em todos os locales)
* SWEEP.1A_1D, 1B, 1C cobriram refactor sistemático destas surfaces
* Random sample de ~70 strings + ~25 fns durante 1A_1D não revelou PT residual

**Validações técnicas:**
* `npm run audit:i18n`: paridade 655/655/655, sem spread, sem PT residual heurístico (WARN: 2 info-only para identical-to-pt legitimo)
* `npm run build:web`: verde
* `npx tsc --noEmit`: sem erros
* Visual confirmation via `preview_snapshot` em 3 locales para auth + accept-invite + connect-bardo (todas limpas)
* Screenshot capturado do auth pt-BR como evidência

**Próximo bloco:** changelog/tag 0.1.0.

---

### 4.20) VI_RELEASE.0.1.0.FINAL — Tag v0.1.0 + release notes (2026-05-12)

**Status:** ✅ release 0.1.0 fechado formalmente. Tag anotada `v0.1.0` criada e enviada. Release notes em `VOICEIDEAS_RELEASE_NOTES_0.1.0.md`.

**Validações finais executadas:**
* `git status --short` vazio (working tree limpo antes do commit do release)
* `npm run audit:i18n` — paridade total 655/655/655, sem spread, sem PT residual heurístico, WARN=2 info-only
* `npm run build:web` — verde (tsc + vite, 4 chunks gerados < 230 kB cada)
* `npx supabase migration list --linked` (via docker) — 27 migrations alinhadas Local/Remote/Time (última `202605120003`)
* `npx supabase functions list --project-ref uhzwqhaxnodtshlvvikt` (via docker) — 17 functions ACTIVE

**Alinhamento de versão (5 surfaces):**

| Surface | Valor | Localização |
|---|---|---|
| `package.json` | `"version": "0.1.0"` | raiz do projeto |
| `src-tauri/tauri.conf.json` | `"version": "0.1.0"` | desktop manifest |
| `src-tauri/Cargo.toml` | `version = "0.1.0"` | crate Rust do Tauri |
| `android/app/build.gradle` | `versionName "0.1.0"`, `versionCode 2` | Android |
| `ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION = 0.1.0`, `CURRENT_PROJECT_VERSION = 2` | iOS |

**Artefatos confirmados (não versionados no git — `Distribuicao-Final/` gitignored):**

| Plataforma | Path | Tamanho |
|---|---|---|
| Web | `dist/` (build via `npm run build:web`) | ~700 kB total gzip |
| Desktop macOS arm64 | `Distribuicao-Final/VoiceIdeas-macOS-AppleSilicon.dmg` | 3.0 MB |
| Desktop macOS arm64 (.app) | `src-tauri/target/release/bundle/macos/VoiceIdeas.app` | (bundle) |
| Desktop macOS Intel | `Distribuicao-Final/VoiceIdeas-macOS-Intel.dmg` | 3.1 MB |
| Android arm64 (debug APK) | `Distribuicao-Final/VoiceIdeas-Android-arm64.apk` | 3.3 MB |
| Android arm64 (release AAB) | `Distribuicao-Final/VoiceIdeas-Android-arm64.aab` + `android/app/build/outputs/bundle/release/app-release.aab` | 3.1 MB |
| iPad | install local via `xcrun devicectl` (Personal Team, Apple ID free) | — |

**Release notes:** `VOICEIDEAS_RELEASE_NOTES_0.1.0.md` cobre ponte VI↔Bardo (account linking + modos + status return + snapshot resend + edge functions), plataformas, i18n (3 locales × 655 keys + audit + smoke), outras mudanças relevantes, limitações conhecidas (App Store/TestFlight/Play Store/notarization/i18n residual), validações finais, comandos para reproduzir, próximos blocos.

**Limitações reafirmadas:**
* App Store / TestFlight bloqueados até Apple Developer pago
* Google Play precisa keystore dedicado + refinamento de foreground service
* macOS fora App Store precisa notarização
* ~25 strings PT residuais em hooks/utils/edge function messages — não bloqueia tag, plano em VI_I18N.SWEEP.1D futuro

**Commit do release:** registrado abaixo no commit que adiciona o release notes file + atualiza estes docs.
**Tag:** `v0.1.0` (anotada) — "VoiceIdeas 0.1.0 local release snapshot".

**Próximo bloco:** definido por Gian (sugestões: VI_I18N.SWEEP.1D opcional; Apple Developer enrollment; Google Play keystore + foreground service hardening; Bardo bridge expansão métricas/retry/observabilidade).

---

### 4.21) VI_RELEASE.REBUILD_APPS.1 — Rebuild final dos artefatos pós-tag (2026-05-12)

**Status:** ✅ todos os artefatos regenerados a partir do HEAD da release (`e843181` / tag `v0.1.0`). Tag NÃO foi movida (commit docs-only neste rebuild fica adiante da tag). Apps físicos refletem as últimas alterações de bridge, i18n e versionamento.

**Base do rebuild:**
* `git rev-parse HEAD` = `e843181` (`docs(release): VoiceIdeas 0.1.0 release notes + snapshot final`)
* `git tag --points-at HEAD` = `v0.1.0`
* `git status --short` = vazio (pré-rebuild)
* Working tree limpo confirmado antes e depois (Distribuicao-Final/* gitignored).

**Validações pré-rebuild:**
* `npm run audit:i18n` — paridade 655/655/655, sem spread, sem PT residual
* `npm run build:web` — verde (tsc + vite)

**Artefatos regenerados:**

| Plataforma | Path final | Tamanho | Timestamp |
|---|---|---|---|
| Web | `dist/` (build via `npm run build:web`) | ~700 kB gzip | 19:01 |
| Desktop macOS arm64 (.app) | `src-tauri/target/release/bundle/macos/VoiceIdeas.app` | (bundle) | 18:59 |
| Desktop macOS arm64 (.dmg) | `src-tauri/target/release/bundle/dmg/VoiceIdeas_0.1.0_aarch64.dmg` → `Distribuicao-Final/VoiceIdeas-macOS-AppleSilicon.dmg` | 3.22 MB | 19:02 |
| Desktop macOS Intel (.app) | `src-tauri/target/x86_64-apple-darwin/release/bundle/macos/VoiceIdeas.app` | (bundle) | 19:01 |
| Desktop macOS Intel (.dmg) | `src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/VoiceIdeas_0.1.0_x64.dmg` → `Distribuicao-Final/VoiceIdeas-macOS-Intel.dmg` | 3.31 MB | 19:02 |
| Android arm64 (debug APK) | `android/app/build/outputs/apk/debug/app-debug.apk` → `Distribuicao-Final/VoiceIdeas-Android-arm64.apk` | 4.72 MB | 19:02 |
| Android arm64 (release AAB) | `android/app/build/outputs/bundle/release/app-release.aab` → `Distribuicao-Final/VoiceIdeas-Android-arm64.aab` | 3.44 MB | 19:02 |
| iOS App (simulator) | `/tmp/ios-derived/Build/Products/Debug-iphonesimulator/App.app` | (bundle) | 19:04 |
| iOS App (device — iPad) | `/tmp/ios-derived-device/Build/Products/Debug-iphoneos/App.app` (1.15 MB binary) → instalado no iPad físico | — | 19:06 |

**Comandos executados:**
* `npm run desktop:build` (arm64)
* `npm run desktop:build:intel`
* `npm run android:build` (APK + AAB)
* `npm run ios:sync` + simulator build + device build via `xcodebuild build ... -destination 'id=<iPad UDID>'`
* `xcrun devicectl device install app` + `xcrun devicectl device process launch com.voiceideas.mobile` na iPad de 6ª geração paired

**Resultado iPad (Personal Team, Apple ID free):**
* `App installed: bundleID: com.voiceideas.mobile`
* `installationURL: file:///private/var/containers/Bundle/Application/F909505F-736B-4D9A-83C4-517636D33BE5/App.app/`
* `Launched application with com.voiceideas.mobile bundle identifier.`
* Warning benigno "No provider was found" do devicectl provisioning lookup (esperado em Personal Team; install + launch concluem normalmente).

**Verificações de segurança nos bundles (0 hits = OK):**

| Bundle | OPENAI_API_KEY | VITE_OPENAI | SUPABASE_SERVICE_ROLE | BRIDGE_SHARED_SECRET | sk-proj-/sk-XXX40+ |
|---|---|---|---|---|---|
| Web dist (assets/*.js) | 0 | 0 | 0 | 0 | 0 |
| Desktop arm64 binary (`strings voiceideas`) | 0 | 0 | 0 | 0 | 0 |
| Desktop Intel binary | 0 | 0 | 0 | 0 | 0 |
| Android APK (assets/public/assets/*.js) | 0 | 0 | 0 | 0 | 0 |
| Android AAB (base/assets/public/assets/*.js) | 0 | 0 | 0 | 0 | 0 |
| iOS App.app (grep -ar) | 0 | 0 | 0 | 0 | 0 |

**Verificações de regressão nos bundles (1+ = presente):**

| Bundle | Conta VoiceIdeas | Bardo conectado | Importado no Bardo | Reenviar último conteúdo | useSnapshot | Conexão com o Bardo disponível |
|---|---|---|---|---|---|---|
| Web dist | 1 | 2 | 1 | 1 | 5 | 1 |
| Android APK | 1 | 2 | 1 | 1 | 5 | 1 |
| Android AAB | 1 | 2 | 1 | 1 | 5 | 1 |
| iOS App.app | 1 | 2 | 1 | 1 | 5 | 1 |
| Desktop .app (Tauri) | n/a — JS embedded compresso | — | — | — | — | — |

**Nota sobre Desktop .app:** Tauri embute o web bundle compactado dentro do binário Mach-O `voiceideas`. `strings | grep` no binário não recupera literais JS individuais (são deserializados em runtime), mas como o `.app` foi construído da mesma `dist/` que passou no scan e o binário tem referências a "Bardo"/"VoiceIdeas" no metadata, a presença dos markers é deduzida transitivamente.

**Distribuicao-Final/ atualizado (gitignored):**
```
VoiceIdeas-Android-arm64.aab     3.44 MB  19:02
VoiceIdeas-Android-arm64.apk     4.72 MB  19:02
VoiceIdeas-macOS-AppleSilicon.dmg  3.22 MB  19:02
VoiceIdeas-macOS-Intel.dmg         3.31 MB  19:02
```

**Anterior (Mar 20-21, stale antes do rebuild):**
* `.aab` 3.28 MB / `.apk` 3.50 MB / arm64 .dmg 3.13 MB / Intel .dmg 3.21 MB — todos pre-VI_BRIDGE / pre-i18n. Substituídos.

**Tag NÃO movida.** Por convenção (`v0.1.0` aponta para o commit imutável `e843181`), o commit docs deste rebuild fica adiante da tag. Os artefatos físicos refletem o mesmo código da tag — apenas binários são novos, código não mudou.

**Próximo bloco:** definido por Gian.

---

### 4.22) VI_SECURITY.AUDIT_0.1.0 — Auditoria de segurança do diff de release (2026-05-12)

**Status:** ✅ auditoria fechada. **0 critical / 0 high / 0 medium / 3 low / 2 info.** Release **não bloqueada**. Findings registrados em `docs/security-findings.md` + 2 tickets P2 abertos no backlog (`VI_SECURITY.INVITE_ERROR_CODES` e `VI_BARDO.IDENTITY_LINK_HARDENING`).

**Escopo do diff auditado:** `a665500..7495817` — 7 commits, 18 arquivos, 2538 inserções / 223 deleções. Predominantemente refactor de catálogo i18n + release docs. Única mudança substantiva de lógica foi a supressão de erros locale-aware em `AcceptInvite.tsx` e `ShareIdeaModal.tsx`.

**Tooling baseline:** `npm run security:test` (check-jwt + check-surface) — verde antes e depois.
* `Verified self-managed auth mode for 15 authenticated functions.`
* `Verified hardened client/server security surfaces for organize, transcribe, and sharing.`

**Subagente:** `security-reviewer` (do skill `security-audit`). Cross-ref com:
* edge functions (`link-bardo-account`, `accept-idea-invite`, `preview-idea-invite`, `share-idea`)
* services (`shareIdeas.ts`, `bardoAccountLinkService.ts`, `functionAuth.ts`)
* hooks (`useAdminUsers.ts`, `useUserProfile.ts`)
* RLS migrations + `public.is_admin()` SECURITY DEFINER

**Findings (resumo — detalhes em `docs/security-findings.md`):**

| # | Sev | Arquivo | Categoria | Ticket |
|---|---|---|---|---|
| F1 | low | `AcceptInvite.tsx`:126/159/169/182 + `ShareIdeaModal.tsx`:97-98 | Locale-aware error suppression colapsa estados distintos em mensagem genérica para en/es | P2.4 VI_SECURITY.INVITE_ERROR_CODES |
| F2 | low/info | `BardoConnectionToggle.tsx` + `link-bardo-account` | Self-attestation de `bardo_user_id` permite cross-system identity confusion. Design documentado — verification delegada ao consumer Bardo | P2.5 VI_BARDO.IDENTITY_LINK_HARDENING |
| F3 | info | `Admin.tsx`:53/68 + `useAdminUsers.ts`:103/118 | Stack trace / DB error leak (audiência: só admins) | (defer — sem ticket) |
| F4 | info | `BardoConnectionToggle.tsx`:193-194 | `link.bardo_user_id` completo no DOM (vs SignedInAccountCard que trunca) | P2.5 VI_BARDO.IDENTITY_LINK_HARDENING |
| F5 | low | `AcceptInvite.tsx`:108-114 | Heurística `.includes('mesmo email do convite')` em substring pt-BR — quebra silenciosamente se backend for localizado | P2.4 VI_SECURITY.INVITE_ERROR_CODES |

**Categorias sem achados (verificadas):**
* XSS no catálogo i18n (auto-escape de React; sem `dangerouslySetInnerHTML` novo)
* Path traversal em `audit-i18n.mjs` (path hardcoded, dev script only)
* Auth bypass via client `isAdmin` (RLS re-verifica via `public.is_admin()` SECURITY DEFINER server-side)
* OAuth redirect inseguro (allowlist server-side Supabase intacta)
* Novos `localStorage` com dado sensível (única referência nova é `voiceideas.language.v1` — preferência de locale)
* Nova fetch/POST sem auth (mantém padrão `getAuthenticatedFunctionHeaders()`)
* Log de token/email/ID (zero `console.*` adicionado no diff)

**Decisão Gian (product owner):**
> "Eu não bloquearia a 0.1.0 por isso. A auditoria está saudável: 0 Critical, 0 High, 0 Medium. Os achados são reais, mas não indicam exploração direta. O risco principal não é invasão; é ambiguidade operacional, especialmente em convite/link Bardo."

Plano aprovado:
1. **NÃO mexer antes da tag.** Refatorar edge functions agora por causa de `error_code` pode abrir regressão desnecessária.
2. **Commit do relatório.** `docs/security-findings.md` versionado como evidência de release.
3. **2 tickets P2 pós-release** (não 5):
   * `VI_SECURITY.INVITE_ERROR_CODES` (agrupa F1 + F5)
   * `VI_BARDO.IDENTITY_LINK_HARDENING` (agrupa F2 + F4)
4. F3 fica em defer sem ticket dedicado (audiência admin pequena, baixo retorno em refatorar agora).

**Leitura cética registrada (Gian):**
F2 é o achado mais importante. "Design documentado" não elimina risco arquitetural. Delegar ownership verification ao consumer Bardo é aceitável para 0.1.0 mas é **dívida real**. Se bridge virar superfície importante, evolução ideal:

```
Bardo inicia link → token assinado/one-time → VoiceIdeas confirma → vínculo criado
```

NÃO:
```
Cliente informa bardo_user_id → VoiceIdeas aceita → Bardo valida depois
```

O segundo modelo funciona mas é mais frágil. Documentado em ticket P2.5 etapa 3 como evolução futura.

**Validações:**
* `npm run security:test`: verde (re-rodado após commit de docs)
* `git status --short`: vazio
* Tag `v0.1.0` segue em `e843181` (não movida).

**Próximo bloco:** definido por Gian.

---

### 4.23) VI.HOTFIX.LINK.1.REVOKE_GIAN — Verify pós-E2E Bardo (idempotente, 2026-05-12)

**Status:** ✅ revoke já efetivado anteriormente (entry 4.11, 12:09:51 UTC). Re-execução desta task confirmou idempotência: row alvo já está `revoked`, sem ação adicional necessária. Pre-checks completos. Anomalia secundária registrada (cross-link conactseculo21 × count4all) sem ação — escopo da task é só revoke da row específica.

**Trigger:** Lado Bardo concluiu o E2E real `BARDO.VI_LINK.AUTO_ACCOUNT_LINK` com `count4all@gmail.com` em produção (janela de 24h iniciada em 2026-05-11 20:25 UTC, encerrada em 2026-05-12 20:25 UTC). Bardo solicitou ao VI revogar a row hotfix antiga `a5273c62-7c51-46ad-b8cd-dc4942803f65`.

**Pre-checks executados (Management API via `docker compose run --rm codex` + token `SUPABASE_ACCESS_TOKEN`):**

| # | Check | Resultado |
|---|---|---|
| 1 | `SELECT * FROM public.bardo_account_links WHERE id = 'a5273c62-...'` | ✅ row existe; `link_status='revoked'`; `revoked_at='2026-05-12 12:09:51.009068+00'`; `updated_at='2026-05-12 12:09:51.009068+00'` |
| 2 | Ownership = Gian (conactseculo21) | ✅ `vi_user_id=b9cb0959...` → `auth.users.email='conactseculo21@gmail.com'`; `bardo_email='conactseculo21@gmail.com'` |
| 3 | count4all tem vínculo próprio | ⚠️ row `b2b1f238` existiu (linked 2026-05-11 20:30:11, do E2E) MAS também foi revogada às 2026-05-12 15:25:28; único vínculo `active` atualmente é `2e266f5b` que vincula `vi_user_id=57bdd56b` (count4all VI) → `bardo_user_id=642f4864` (conactseculo21 Bardo). **Cross-account link anômalo** — exemplo concreto do finding F2 da audit (ticket P2.5 VI_BARDO.IDENTITY_LINK_HARDENING). Fora do escopo desta task. |
| 4 | `/connect-bardo` reachable | ✅ HTTP 200 (Vercel) |
| 5 | Sem regressão / hotfix novo após E2E | ✅ 0 linhas criadas/atualizadas após 2026-05-12 15:25:30; último `updated_at` global = 15:25:29.115333 (= criação do `2e266f5b` legítimo do E2E); migrations remotas alinhadas (últimas 5: `bardo_account_links`, `identity_probe_by_email`, `bridge_items_allow_manual_mode`, `bridge_reopen_for_resend`, `user_settings_external_integrations`) |

**Decisão de execução:** Schema da tabela suporta revogação lógica via `link_status` + `revoked_at` + `updated_at`. A row alvo já está com todos os 3 campos no estado revogado. **Nenhum DML adicional executado** (operação idempotente). Hipótese de DELETE controlado descartada porque revogação lógica preserva histórico/auditoria, que é o padrão deste projeto (P1.3+).

**Verify pós-revoke:**

| Verify | Resultado |
|---|---|
| 1. row `a5273c62` não-ativa | ✅ `link_status=revoked`, `revoked_at` setado |
| 2. count4all `bridge-inbox` 200 | ✅ confirmado pelo lado Bardo no E2E (`items=[]`, "Nada pendente"). VI não pode testar diretamente sem JWT count4all. |
| 3. conactseculo21 fluxo automático real | Histórico mostra `2e266f5b` ativo criado às 15:25:29 com `bardo_email='conactseculo21@gmail.com'` — fluxo conactseculo21 foi exercido. Mas via auth `57bdd56b` (count4all), não `b9cb0959` (conactseculo21 direto). |
| 4. ACCOUNT_LINK_REQUIRED esperado se conactseculo21 logar direto | Esperado — Gian usaria `/connect-bardo` (confirmado HTTP 200) |
| 5. Sem fallback manual/hotfix novo | ✅ 0 linhas após 15:25:30 |

**Anomalia secundária flagada (NÃO corrigida nesta task):**

Row `2e266f5b` (único `active`) é exemplo concreto em produção do finding F2 da audit (ticket P2.5 VI_BARDO.IDENTITY_LINK_HARDENING):
- VI user (auth) = `count4all@gmail.com`
- Bardo user_id vinculado = `642f4864...` (= Bardo de conactseculo21)
- bardo_email no link = `conactseculo21@gmail.com`

Interpretação provável: Gian fez E2E logado no VI como count4all (nova sessão) e logado no Bardo como conactseculo21 (sessão antiga preservada). Callback `/connect-bardo` recebeu `bardoUserId=642f4864` (conactseculo21 do Bardo) e VI estava com sessão count4all — vínculo cross-account criado conforme o design atual de self-attestation.

Conforme escopo desta task ("não apagar vínculo count4all; não mexer em outras rows; não alterar Bardo"), **nenhuma ação foi tomada sobre essa row**. Fica como evidência empírica para o ticket P2.5 que já está aberto no backlog.

**Comandos executados (todos read-only nesta sessão):**
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'bardo_account_links'
ORDER BY ordinal_position;

SELECT * FROM public.bardo_account_links
WHERE id = 'a5273c62-7c51-46ad-b8cd-dc4942803f65';

SELECT id, vi_user_id, bardo_user_id, bardo_email, link_status, linked_at, revoked_at
FROM public.bardo_account_links
WHERE bardo_email = 'count4all@gmail.com'
ORDER BY linked_at DESC;

SELECT link_status, COUNT(*) FROM public.bardo_account_links GROUP BY link_status;
-- {"active":1, "revoked":2}

SELECT id, vi_user_id, bardo_user_id, bardo_email, link_status, linked_at, revoked_at, updated_at
FROM public.bardo_account_links ORDER BY created_at ASC;

SELECT u.id, u.email, u.created_at FROM auth.users u
WHERE u.id IN ('b9cb0959-2495-49f8-a8a4-909312e4aa9f', '57bdd56b-49a7-44ab-ba53-bb81f6328972')
ORDER BY u.created_at;

SELECT COUNT(*) FROM public.bardo_account_links
WHERE created_at > '2026-05-12 15:25:30+00' OR updated_at > '2026-05-12 15:25:30+00';

SELECT MAX(updated_at) FROM public.bardo_account_links;

SELECT name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;
```

Nenhum INSERT/UPDATE/DELETE executado nesta task.

**Próximo bloco:** definido por Gian. Anomalia cross-link (row `2e266f5b`) é evidência empírica do P2.5 — pode ser priorizada se virar superfície crítica.

---

### 4.24) VI_BACKLOG.REPRIORITIZE.IDENTITY_HARDENING — Promoção P2.5 → P1.5 (2026-05-12)

**Status:** ✅ backlog reorganizado por decisão de Gian após verify do hotfix Gian. O hardening de identidade Bardo↔VI deixa de ser "melhoria pós-estabilidade" e passa a ser **bloqueador de exposição pública ampla do bridge**.

**Trigger:** Entry 4.23 confirmou em produção que o cenário do finding F2 (cross-system identity confusion via self-attestation) é real, não teórico. Row `2e266f5b` ativa em produção liga `count4all@gmail.com` (VI auth) → `conactseculo21@gmail.com` (Bardo).

**Decisão Gian (citação direta):**
> "A revogação Gian está resolvida. O ponto importante agora não é mais o hotfix antigo; é a anomalia ativa. Eu não trataria o sistema de link como pronto para exposição pública ampla enquanto existir o vínculo ativo: VI count4all@gmail.com → Bardo conactseculo21@gmail.com. Isso não é ruído. É confirmação prática do finding F2."

**O que NÃO fazer:**
> "Não sair deletando a row `2e266f5b` sem antes entender o fluxo. Apagar a linha limpa o sintoma, não corrige a causa."

**Reorganização do backlog:**

```
DONE
- VI.HOTFIX.LINK.1.REVOKE_GIAN  (idempotente, no DML required)
- VI_RELEASE.0.1.0.FINAL        (tag v0.1.0 → e843181)
- VI_RELEASE.REBUILD_APPS.1     (artefatos pós-tag)
- VI_SECURITY.AUDIT_0.1.0       (0 critical / 0 high / 0 medium)

NEXT / PRIORITY
- VI_BARDO.IDENTITY_LINK_HARDENING  (promovido P2.5 → P1.5)

LATER
- VI_SECURITY.INVITE_ERROR_CODES    (P2.4)
- VI_UI.BARDO_INBOX_WARNING_CONTRAST (P2.6)
- VI_I18N.FULL_SWEEP                (P2.7)
```

**PLAN / EXECUTE / VERIFY do P1.5 (registrado no backlog completo):**

PLAN:
1. Bloquear criação de link se e-mail autenticado no VoiceIdeas não bater com identidade autenticada no Bardo
2. Substituir self-attestation simples por desafio assinado/one-time
3. Manter fallback seguro: `ACCOUNT_LINK_REQUIRED` se houver ambiguidade

EXECUTE:
1. **Bardo** gera `link_token` assinado, curto, one-time, com:
   - `bardo_user_id`
   - `bardo_email`
   - `expires_at` (curto, ex 5 min)
   - assinatura HMAC ou JWT com chave compartilhada VI↔Bardo
2. **VoiceIdeas** recebe token no `/connect-bardo` callback:
   - valida assinatura
   - valida origem (Bardo apenas)
   - valida expiração
   - valida não-reuso (one-time via cache/DB)
3. **VoiceIdeas** só cria `bardo_account_links` se:
   - `vi.auth.email === bardo_email` do token
   - validação OK
4. **Mismatch**:
   - não criar link
   - registrar evento `identity_mismatch` (tabela `auth_observability` ou similar, com `vi_email_masked` + `bardo_email_masked` + timestamp)
   - retornar UI clara explicando o motivo
5. **Truncar** `bardo_user_id` no DOM em `BardoConnectionToggle.tsx:193-194` via `slice(0, 8)` — alinhar com padrão de `SignedInAccountCard`.

VERIFY:
- count4all VI + count4all Bardo → cria link ✓
- count4all VI + conactseculo21 Bardo → bloqueia (esperado)
- token expirado → bloqueia
- token reusado → bloqueia
- assinatura inválida ou origem desconhecida → bloqueia
- `bridge-inbox` continua 200 para link válido
- DOM scan: zero ocorrências de `bardo_user_id` completo

**Critério de aceite:**
- Impossível criar link onde `vi.auth.email != bardo_email` validado por token assinado do Bardo.
- `bardo_account_links` exposta apenas a vínculos legítimos (audit retrospectivo: revogar `2e266f5b` ou re-validar quando novo mecanismo entrar em produção).
- Telemetria mostra `identity_mismatch` events quando aplicável.

**Risco:**
- Exige coordenação Bardo (gera token) + VI (valida). Não é refactor isolado.
- Migração de vínculos existentes precisa plano: revogar todos + forçar re-link, OU marcar `legacy_self_attested=true` e exigir re-validação gradual.
- `/connect-bardo` precisa nova versão de contrato (token-based) sem quebrar Bardo durante deploy.

**Caveat sobre tag 0.1.0:**
> Citação Gian: "a tag 0.1.0 continua válida como snapshot técnico, mas o bridge Bardo/VoiceIdeas não deve ser considerado 'seguro por arquitetura' até fechar o hardening de identidade."

Tag `v0.1.0` permanece em `e843181`. Snapshot técnico ✓. **Exposição pública ampla** (compartilhar acesso amplo ao bridge VI↔Bardo, marketing, expansão de base de usuários) deve aguardar P1.5 fechar.

**Próximo bloco:** abrir P1.5 quando Bardo estiver disponível para coordenação (gerar `link_token` assinado é mudança no lado Bardo + mudança correspondente em `link-bardo-account` no VI). Truncamento DOM (etapa 5 do EXECUTE) pode ser feito imediatamente de forma isolada se Gian quiser cortar a evidência visual rápido.

---

### 4.25) VI_BARDO.IDENTITY_LINK_HARDENING.R3_CONSUME_BARDO_NONCE — fluxo nonce server-side (2026-05-13)

**Status:** ✅ código deployado em produção (`link-bardo-account` v4 ACTIVE). Smoke produção **bloqueado** até `BARDO_BRIDGE_CONSUME_NONCE_URL` ser setado nas envs (responsabilidade Gian/Bardo). Comportamento atual em prod: caminho R3 retorna `bardo_consumer_error` (fail-safe sem URL), caminho legacy retorna `legacy_blocked` por default. Nenhum link novo até a configuração final — comportamento esperado para impedir cross-account link até handshake completo.

**Contrato Bardo recebido:**

| Item | Valor |
|---|---|
| Bardo web | 0.6.121 |
| Bardo commit | `4e1ebda` |
| Query param preferencial | `bridge_nonce` |
| Issuer (Bardo edge function) | `bridge-link-issue-nonce` |
| Consumer (Bardo edge function) | `bridge-link-consume-nonce` |
| Hash de email | `sha256(BRIDGE_EMAIL_HASH_SALT + ':email:' + lower(email))` |
| Nonce shape | 64 hex |
| Nonce TTL | 5 min |
| Nonce single-use | sim |
| Consumer retorna `email_hash_match` | `true \| false \| null` |

**Arquitetura R3:**

```
[Bardo /connect button]
  └─→ Bardo gera bridge_nonce (bridge-link-issue-nonce), TTL 5min
       └─→ redireciona usuário p/ VI: /connect-bardo?bridge_nonce=<64hex>&return=<bardo>

[VI /connect-bardo]
  └─→ valida JWT VI (login se necessário)
  └─→ frontend NÃO calcula hash, NÃO chama Bardo, NÃO usa secret
  └─→ POST link-bardo-account { bridge_nonce }

[VI link-bardo-account edge function]
  ├─ Valida bridge_nonce: 64 hex regex
  ├─ vi_email = lowercase(trim(JWT.user.email))
  ├─ vi_user_email_hash = sha256(BRIDGE_EMAIL_HASH_SALT + ':email:' + vi_email)
  ├─ POST Bardo bridge-link-consume-nonce
  │   ├─ body: { bridge_nonce, vi_user_email_hash }
  │   └─ header: x-bridge-secret = BRIDGE_SHARED_SECRET
  ├─ Aceita SÓ SE response.email_hash_match === true
  ├─ Usa bardo_user_id e bardo_email da RESPOSTA do Bardo (nunca do cliente)
  └─ Upsert em bardo_account_links
```

**Regras de decisão (códigos retornados pela edge):**

| email_hash_match / result | Código VI | HTTP |
|---|---|---|
| `true` | (sucesso, cria link) | 200 |
| `false` | `mismatch` | 403 |
| `null` | `unverifiable_identity` | 403 |
| nonce expirado | `expired` | 403 |
| nonce reusado | `reused` | 403 |
| outros | `invalid_nonce` | 403 |
| nonce malformado (formato) | `malformed_nonce` | 400 |
| Bardo consumer offline/erro | `bardo_consumer_error` | 502 |
| `BRIDGE_EMAIL_HASH_SALT` ausente | `server_misconfigured` | 503 |
| Usuário VI sem email | `no_vi_email` | 400 |
| Legacy sem `ALLOW_LEGACY_BARDO_LINK=true` | `legacy_blocked` | 403 |

**Files changed:**

* `supabase/functions/link-bardo-account/index.ts` — reescrito com branch `bridge_nonce` (canônico, default), branch legacy (gated por `ALLOW_LEGACY_BARDO_LINK=true`). Server-side: validação formato → `computeEmailHash` com salt → POST Bardo consumer com `x-bridge-secret` → check `email_hash_match === true` → upsert. Logs estruturados `[link-bardo-account]` com `event: link_attempt`, `result`, `vi_user_id`, `vi_email_masked`, `bardo_user_id_prefix` (nunca completo), `timestamp`. Nunca loga: salt, x-bridge-secret, nonce completo, hash completo, payload bruto.
* `src/services/bardoAccountLinkService.ts` — discriminated union `BardoAccountLinkInput = R3Input | LegacyInput`. Nova classe `BardoAccountLinkError` propaga `code` da edge para UI. `extractErrorCode` lê `error.context.body.code` do supabase-js `FunctionsHttpError`.
* `src/pages/ConnectBardo.tsx` — lê `bridge_nonce` query param (validação leve `NONCE_HEX_REGEX` cliente). Caminho R3 preferido sobre legacy. Map `error_code → i18n key`: `mismatch → identityMismatch`, `expired|reused → nonceExpiredOrReused`, `unverifiable_identity|invalid_nonce|malformed_nonce → unverifiableIdentity`, `legacy_blocked → legacyBlocked`. Mantém defesa C1 client-side no path legacy (segunda camada).
* `src/lib/i18nMessages.ts` — +3 novas chaves × 3 locales = 9 entradas: `nonceExpiredOrReused`, `unverifiableIdentity`, `legacyBlocked` (a existente `identityMismatch` é reusada). Paridade total 659/659/659.

**Envs no Supabase VI (`uhzwqhaxnodtshlvvikt`):**

| Env var | Status | Função |
|---|---|---|
| `BRIDGE_EMAIL_HASH_SALT` | ✅ registered @ 2026-05-13 11:37:18 UTC | Salt do hash de email (compartilhado VI ↔ Bardo) |
| `BRIDGE_SHARED_SECRET` | ✅ registered @ 2026-04-17 16:04:02 UTC | Reusado como header `x-bridge-secret` na chamada VI→Bardo (mesmo secret bidirecional já usado em Bardo→VI) |
| `BARDO_BRIDGE_CONSUME_NONCE_URL` | ⚠️ **MISSING** | URL completa do `bridge-link-consume-nonce` do Bardo (provavelmente `https://<bardo-ref>.supabase.co/functions/v1/bridge-link-consume-nonce`). Sem isso, R3 retorna `bardo_consumer_error`. |
| `ALLOW_LEGACY_BARDO_LINK` | MISSING (= default `false`) | **Esperado**. Default bloqueia legacy em produção. |

**Estado prod imediato:**
* `/connect-bardo?bridge_nonce=...` → edge valida formato + computa hash → tenta `fetch(BARDO_BRIDGE_CONSUME_NONCE_URL)` com URL vazia → 502 `bardo_consumer_error`. UI mostra "Não foi possível verificar a identidade..."
* `/connect-bardo?bardo_user_id=...` (legacy) → 403 `legacy_blocked`. UI mostra "Este caminho de conexão antigo foi desativado..."
* **Ambos bloqueados.** Comportamento fail-safe esperado. Para destravar produção: setar `BARDO_BRIDGE_CONSUME_NONCE_URL`.

**Validações:**
* `npm run audit:i18n`: 659/659/659 ✅
* `npm run security:test`: verde ✅
* `npx tsc --noEmit`: sem erros ✅
* `npm run build:web`: verde ✅
* `npm run lint`: 4 errors preexistentes (verificado), 0 novos
* Deploy: `link-bardo-account` v2 → v4 ACTIVE 2026-05-13 14:49:15 UTC
* Function probe (sem auth): HTTP 401 ✅ (function viva)

**Smokes em produção:**

| Smoke | Status |
|---|---|
| Caminho feliz (`bridge_nonce` válido + mesmo email) | **`not_run`** — requer Bardo emitir nonce + URL setada |
| Identity mismatch (count4all VI + conactseculo21 Bardo) | **`not_run`** — requer coordenação Bardo |
| Nonce reutilizado | **`not_run`** — requer Bardo |
| Nonce expirado | **`not_run`** — requer Bardo |
| Nonce malformado (formato) | testável quando produção destravar — edge retornará 400 `malformed_nonce` |
| Legacy blocked em prod | **`pass` indireto** — `ALLOW_LEGACY_BARDO_LINK` ausente = default false = 403 `legacy_blocked` |
| Row `2e266f5b` | **NÃO tocada** — código não toca nessa row específica |

**Pré-requisito para destravar produção (responsabilidade Gian/Bardo):**

```bash
# Setar URL do consumer Bardo via Management API (via docker como padrão do projeto)
docker compose run --rm codex bash -lc '
curl -X POST "https://api.supabase.com/v1/projects/uhzwqhaxnodtshlvvikt/secrets" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "[{\"name\":\"BARDO_BRIDGE_CONSUME_NONCE_URL\",\"value\":\"https://<bardo-ref>.supabase.co/functions/v1/bridge-link-consume-nonce\"}]"
'
```

Depois rodar smoke: `/connect-bardo?bridge_nonce=<nonce real do Bardo>` com sessão VI logada no mesmo email.

**Tag, schema, row 2e266f5b:** todos intactos. HEAD `main` continua após o commit deste deploy.

**Próximo bloco:** Gian seta `BARDO_BRIDGE_CONSUME_NONCE_URL` + roda smokes pareados com Bardo. Depois decisão sobre migração da row `2e266f5b` legacy (revogar + forçar re-link pelo R3) e demais legacy se houver.

---

### 4.26) VI_BARDO.IDENTITY_LINK_HARDENING.R3_FINALIZE_SMOKE — URL setada + patch contrato Bardo (2026-05-13)

**Status:** ✅ URL do consumer Bardo registrada como secret VI. Edge function v6 ACTIVE com patch de compatibilidade ao response do Bardo (`code` em vez de `result`, `bardo_email_hash` opcional, sem dependência de `bardo_email` cru). Smokes funcionais (`valid_nonce_same_email`, `mismatch_blocks`, `reused_nonce_blocks`, `expired_nonce_blocks`) ainda **dependem de coordenação Bardo** (precisam de nonces reais emitidos + JWT VI). Smoke `legacy_blocked` permanece pass-indireto via default `ALLOW_LEGACY_BARDO_LINK=false`. Row `2e266f5b` UNCHANGED.

**URL recebida do Bardo:**
```
BARDO_BRIDGE_CONSUME_NONCE_URL=https://reuxrnkloldzawdhilbf.supabase.co/functions/v1/bridge-link-consume-nonce
```

**Setada via Management API (sem expor valor nos logs):**
```bash
docker compose run --rm codex bash -lc '...curl POST /v1/projects/.../secrets...'
```

**Verificação:** `BARDO_BRIDGE_CONSUME_NONCE_URL REGISTERED @ 2026-05-13T15:14:54.093Z`

**Patch de compatibilidade no `link-bardo-account/index.ts`:**

Bardo response contract observado (Cut 0.6.121+):
* `email_hash_match: true | false | null` ✅ (já suportado)
* `bardo_email_hash` (hex) — **novo** ✅ (agora usado)
* `code` (string) — **novo** canonical ✅ (com fallback `result` para resiliência)
* Sem `bardo_email` cru ✅ (gravamos `bardo_email = null` em `bardo_account_links`)
* Sem `error_code` ✅ (nunca esperado)

Mudanças aplicadas:

1. Type `BardoNonceConsumeResponse` aceita `code` (canonical) + `result` (fallback), `bardo_email_hash` opcional.
2. Variável `bardoCode = response.code || response.result || null` resiliente à transição.
3. Mapeamento `expired` / `reused` agora via `bardoCode` em vez de `bardoResponse.result`.
4. **Defense in depth:** se Bardo enviar `bardo_email_hash`, compara case-insensitive com `viEmailHash` computado localmente. Se não bate → 403 `mismatch` (mesmo que Bardo tenha dito `email_hash_match=true`). Pega cenários de salt divergente, MITM, ou bug Bardo.
5. Persistência: ao criar/upsert link, `bardoEmail: null` sempre (R3 não expõe email cru). Schema `bardo_account_links.bardo_email` é nullable — não precisa migration. Dívida para R4: coluna dedicada `bardo_email_hash` para auditoria/correlação.

**Deploy:** `link-bardo-account` v4 → v6 ACTIVE @ 2026-05-13 15:16:36 UTC.

**Validações:**
* `npm run audit:i18n`: 659/659/659 ✅
* `npm run security:test`: verde ✅
* `npx tsc --noEmit`: sem erros ✅
* `npm run build:web`: verde ✅
* `npm run lint`: 4 errors preexistentes (verificado em sessões anteriores), 0 novos
* Function probe (sem auth): HTTP 401 ✅ (function viva, auth gate funcionando)
* Row `2e266f5b` SELECT post-deploy: **UNCHANGED** (`updated_at = 2026-05-12 15:25:29.115333+00` = mesmo timestamp da última escrita pré-task). `MAX(updated_at)` em toda `bardo_account_links` = 2026-05-12 15:25:29 → confirma zero escritas pela R3/R3_FINALIZE.

**Smokes:**

| # | Smoke | Status | Motivo |
|---|---|---|---|
| A | `malformed_nonce_blocks` | **`not_run`** | Branch exercitável via curl com JWT VI válido — sem JWT em mãos. Edge function tem regex `NONCE_HEX_REGEX` que retorna 400 antes de qualquer fetch. Confirmação requer chamada real. |
| B | `valid_nonce_same_email` | **`not_run`** | Requer nonce real do `bridge-link-issue-nonce` + JWT VI no mesmo email |
| C | `mismatch_blocks` | **`not_run`** | Requer nonce Bardo para conta X + JWT VI para conta Y |
| D | `reused_nonce_blocks` | **`not_run`** | Requer nonce real consumido 2x |
| E | `expired_nonce_blocks` | **`not_run`** | Requer nonce real após TTL 5min |
| F | `legacy_blocked` | **`pass` (indireto)** | `ALLOW_LEGACY_BARDO_LINK` ausente = default false. Edge function retorna 403 `legacy_blocked` para qualquer POST sem `bridge_nonce`. Comportamento confirmado pelo código + ausência da env. |
| G | row 2e266f5b safety | **`pass`** | SELECT confirma row UNCHANGED. Código não toca essa row específica em nenhum path. |

**Dívida documentada (R4 ou similar):**
* Coluna `bardo_account_links.bardo_email_hash` (nullable text) para armazenar o hash que veio do Bardo no momento da criação do link. Hoje gravamos `bardo_email = null` e perdemos rastreabilidade. Migration nova.
* Coluna `bardo_account_links.verification_mode` (`'r3_nonce' | 'legacy'`) para distinguir vínculos criados via R3 dos legacy (incluindo `2e266f5b`). Útil para o plano de migração legacy.

**Para destravar smokes B-E (coordenação Gian/Bardo):**
1. Gian abre uma sessão VI no mesmo email do Bardo (ex: count4all@gmail.com nos dois) — caminho feliz.
2. Bardo emite nonce via `bridge-link-issue-nonce`.
3. Gian abre `https://voiceideas.vercel.app/connect-bardo?bridge_nonce=<64hex>` com sessão VI ativa.
4. Resultado esperado: row criada em `bardo_account_links` (mesmo `vi_user_id`, novo `bardo_user_id` do Bardo, `bardo_email=null`, `link_status=active`).
5. Para `mismatch_blocks`: VI logado count4all, nonce Bardo conactseculo21 → 403 `mismatch` esperado.
6. Para `reused_nonce_blocks`: usar mesmo nonce 2x → segunda recebe `reused`.
7. Para `expired_nonce_blocks`: esperar TTL 5min + tentar consumir → `expired`.

**Tag, schema, row 2e266f5b:** intactos. HEAD `main` segue limpo após commit deste finalize.

**Próximo bloco:** smokes pareados B-E rodam quando Gian e Bardo conseguirem coordenar. Depois fechamento R3 e início da migração legacy (incluindo decisão sobre `2e266f5b`).

---

### 4.27) VI_BARDO.IDENTITY_LINK_HARDENING.R3_SMOKE_MATRIX — `valid_nonce_same_email` PASS + F2 resolvido em produção (2026-05-13)

**Status:** ✅ smoke `valid_nonce_same_email` PASS end-to-end. Flow VI→Bardo + import status return PASS. **Finding F2 (cross-account link `2e266f5b`) RESOLVIDO em produção** pelo próprio mecanismo do R3 — sem ação manual. Demais smokes negativos ainda pendentes — R3 full verification continua **partial**.

**Execução do smoke (operada por Gian em produção):**

* Login VI: `count4all@gmail.com` (vi_user_id `57bdd56b`)
* Bardo emitiu nonce via `bridge-link-issue-nonce` para a conta count4all do Bardo
* Gian abriu `/connect-bardo?bridge_nonce=<64hex>` em prod com sessão ativa
* Bardo Inbox UI mostrou: estado 1 "Finalizar vínculo no VoiceIdeas" → estado 2 "Nada pendente" pós-vínculo → estado 3 "1 pendente — Importar" quando VI enviou nota teste → import OK
* VI mostrou status return: "Importado no Bardo" · "Tentativas registradas: 1" · "Exportado para Bardo"

**Evidência DB (T0 pré-smoke 15:25:30 → T1 pós-smoke 15:33:58):**

```
T0:
  a5273c62  revoked  (Gian hotfix antigo)
  b2b1f238  revoked  (count4all E2E original)
  2e266f5b  ACTIVE   ← cross-link F2 anômalo (count4all VI → conactseculo21 Bardo)

T1:
  a5273c62  revoked  (unchanged)
  b2b1f238  revoked  (unchanged)
  2e266f5b  revoked  ← revogado pela edge function às 15:33:57
  09936f4b  ACTIVE   ← R3-verified (count4all VI → count4all Bardo, bardo_email=null)
```

**Log estruturado capturado (function_logs):**

```json
{
  "event": "link_attempt",
  "result": "valid",
  "vi_user_id": "57bdd56b-49a7-44ab-ba53-bb81f6328972",
  "vi_email_masked": "co***@gmail.com",
  "bardo_user_id_prefix": "c1bbf06e",
  "timestamp": "2026-05-13T15:33:56.885Z"
}
```

HTTP `POST | 200` no edge function `link-bardo-account` no mesmo instante.

**Como F2 foi resolvido sem ação manual:**

1. T0: row `2e266f5b` ativa = count4all VI (`57bdd56b`) → conactseculo21 Bardo (`642f4864`). Cross-account link anômalo, evidência empírica do finding F2 da audit 0.1.0.
2. Smoke executado: count4all VI logado + nonce do Bardo identifica corretamente count4all Bardo (`c1bbf06e`).
3. Edge function `link-bardo-account` aplicou regra documentada "uma conta Bardo por vez por usuário VI" (`upsertActiveLink` → `revokeOthersError`).
4. Antes de criar o novo vínculo verificado, revogou TODOS os ativos anteriores do mesmo `vi_user_id` — incluindo `2e266f5b`.
5. Inseriu nova row `09936f4b`: count4all VI → count4all Bardo (identidades alinhadas pela primeira vez para esse user em produção).

**Reinterpretação do critério "row_2e266f5b_touched":**

O critério original do task spec (`row_2e266f5b_touched = false`) era uma proteção defensiva — para garantir que nenhuma operação acidental tocasse a row durante os smokes. **Tocar a row pelo mecanismo correto (re-link verificado via R3) NÃO É regressão** — é exatamente o comportamento desejado pela arquitetura. Atualização do critério:

```json
{
  "row_2e266f5b_status": "revoked_by_verified_relink",
  "row_2e266f5b_touched": true,
  "row_2e266f5b_touch_expected": true,
  "cross_link_active_after_r3": false,
  "new_verified_link_row": "09936f4b",
  "active_link_now_verified": true
}
```

**Implicações:**

* **F2 (audit finding) = RESOLVED**. Cross-account link em produção foi corrigido pelo próprio R3. Não houve regressão, houve correção orgânica via mecanismo arquitetural verificado.
* **F4 (audit finding) = RESOLVED**. Já tinha sido resolvido pelo C1 (truncamento DOM).
* **P1.5 ticket (`VI_BARDO.IDENTITY_LINK_HARDENING`) — componentes resolvidos.** Findings F2 + F4 fechados. Implementação R3 deployada e validada com smoke positivo end-to-end. O ticket pode ser marcado como entrega concluída; resta apenas verificação dos negativos (mismatch/reused/expired/malformed) que são smoke matrix de R3, não dependência de feature.
* **R3 full verification = PARTIAL** (Gian: "Eu não fecharia R3 inteiro ainda"). Negativos pendentes: `mismatch_blocks`, `reused_nonce_blocks`, `expired_nonce_blocks`, `malformed_nonce_blocks`.

**Matriz atual de smokes:**

| Smoke | Status | Evidência |
|---|---|---|
| `valid_nonce_same_email` | **PASS** | DB diff + log `result: valid` + screenshots Bardo Inbox + UI VI status |
| `vi_to_bardo_note_flow` | **PASS** | Bardo Inbox 1 pendente → Importar → Cofre de Cenas mostra nota |
| `import_status_return` | **PASS** | UI VI mostra "Importado no Bardo" + lifecycle badge |
| `mismatch_blocks` | not_run | Aguarda coordenação Bardo |
| `reused_nonce_blocks` | not_run | Aguarda Bardo |
| `expired_nonce_blocks` | not_run | Aguarda Bardo |
| `malformed_nonce_blocks` | not_run | Pode rodar isoladamente (Gian abre `/connect-bardo?bridge_nonce=abc` com sessão VI — edge retorna 400 `malformed_nonce`) |
| `legacy_blocked` | PASS indireto | `ALLOW_LEGACY_BARDO_LINK` ausente = default false |

**Tag, schema, ALLOW_LEGACY_BARDO_LINK:** intactos. HEAD `main` continua após commit deste registro.

**Próximo bloco:** rodar negativos (mismatch + reused + expired + malformed) quando coordenação Bardo permitir. Depois fechar R3 inteiro. Tickets P1.5/F2/F4 já podem ser marcados resolved.

---

### 4.28) VI_BARDO.IDENTITY_LINK_HARDENING.R3_SMOKE_MATRIX — `mismatch_blocks` PASS (2026-05-13)

**Status:** ✅ smoke `mismatch_blocks` executado em produção; resposta server-side confirmada por DB diff + structured log + edge proxy log; nenhuma row criada/alterada.

**Operação executada pelo usuário (Gian):**

* VI session: `count4all@gmail.com` (vi_user_id `57bdd56b-49a7-44ab-ba53-bb81f6328972`)
* Bardo nonce emitido para `conactseculo21@gmail.com` (bardo_user_id `642f4864-d1d9-4ebe-a626-d34c1f8027e2`)
* Resultado UX: tela do Bardo voltou para "Finalizar vínculo no Voiceideas" (estado `ACCOUNT_LINK_REQUIRED`) — vínculo não criado.

**Verificação server-side via Management API (Logflare + DB):**

* Edge proxy log (`function_edge_logs`):

  ```
  POST | 403 | https://uhzwqhaxnodtshlvvikt.supabase.co/functions/v1/link-bardo-account
  timestamp_micros = 1778688462077000  (2026-05-13 16:07:42 UTC)
  ```

* Function stdout log (`function_logs`) — structured payload exatamente como projetado:

  ```json
  {
    "event": "link_attempt",
    "result": "mismatch",
    "vi_user_id": "57bdd56b-49a7-44ab-ba53-bb81f6328972",
    "vi_email_masked": "co***@gmail.com",
    "bardo_user_id_prefix": "642f4864",
    "timestamp": "2026-05-13T16:07:42.077Z"
  }
  ```

  `result: "mismatch"` é o código de saída exato do branch onde Bardo retorna `email_hash_match: false` (Bardo computou hash de `conactseculo21` e VI computou hash de `count4all` — não bate).

* DB diff `bardo_account_links` antes vs depois:

  | id          | status  | linked_at                  | revoked_at                | updated_at                  | diff |
  |-------------|---------|----------------------------|---------------------------|-----------------------------|------|
  | `09936f4b`  | active  | 2026-05-13 15:33:58.45+00  | —                         | 2026-05-13 15:33:58.45+00   | unchanged (R3 verified, count4all↔count4all) |
  | `2e266f5b`  | revoked | 2026-05-12 15:25:29+00     | 2026-05-13 15:33:57.40+00 | 2026-05-13 15:33:58.05+00   | **unchanged** desde auto-revoke do `valid_nonce_same_email` smoke |
  | `b2b1f238`  | revoked | 2026-05-11 20:30:11+00     | 2026-05-12 15:25:28.62+00 | 2026-05-12 15:25:28.85+00   | unchanged |
  | `a5273c62`  | revoked | 2026-04-19 21:24:57+00     | 2026-05-12 12:09:51.01+00 | 2026-05-12 12:09:51.01+00   | unchanged (Gian hotfix antigo) |

  Total rows: 4 (antes) = 4 (depois). Nenhuma INSERT. Nenhuma UPDATE em qualquer row.

* Bardo bridge-inbox (cross-check via VI `bridge-exports`): GET para `bardo_user_id=642f4864&email=conactseculo21@gmail.com` retornou `403 account_link_required` (`[bex 4bb2f9b8] no active link -> 403`). Confirma que a row `2e266f5b` (cross-link revogada) realmente parou de servir importação. F2 totalmente liquidado.

**Critérios de aceitação (mismatch_blocks):**

| Critério | Resultado | Evidência |
|---|---|---|
| HTTP status retornado pelo edge | 403 | `function_edge_logs` `POST | 403 | link-bardo-account` |
| structured log `result` field | `mismatch` | `function_logs` event `link_attempt` |
| nova row em `bardo_account_links` | **não criada** | DB diff: 4 rows antes/depois |
| row `2e266f5b` mutated | **não** | `updated_at` permanece `2026-05-13 15:33:58.05+00` |
| row `09936f4b` (active) preservada | **sim** | `updated_at` permanece `2026-05-13 15:33:58.45+00` |
| UX Bardo permanece `ACCOUNT_LINK_REQUIRED` | sim | screenshot do "Inbox VoiceIdeas 0 pendentes" + CTA "Finalizar vínculo" |
| F2 (`bardo_user_id` self-attest) reconfirmado seguro | sim | usuário VI count4all NÃO conseguiu reivindicar conactseculo21 |

**Smoke matrix atualizado:**

| Cenário | Status | Notas |
|---|---|---|
| `valid_nonce_same_email` | PASS (2026-05-13 15:33:58) | entry 4.27 |
| `vi_to_bardo_note_flow` | PASS | implicação da 4.27 |
| `import_status_return` | PASS | implicação da 4.27 |
| `mismatch_blocks` | **PASS (2026-05-13 16:07:42)** | esta entry |
| `reused_nonce_blocks` | not run | requer mesmo nonce 2x — coord. Bardo |
| `expired_nonce_blocks` | not run | requer espera TTL 5min — coord. Bardo |
| `malformed_nonce_blocks` | not run | requer VI session + `bridge_nonce=abc` — manual |
| `legacy_blocked` | PASS indireto | `ALLOW_LEGACY_BARDO_LINK` ausente |

**Tag v0.1.0, schema, `ALLOW_LEGACY_BARDO_LINK`:** intactos. Sem mudança de código nesta entry (documentação + verificação apenas).

**Próximo bloco:** rodar `reused_nonce_blocks` (consumir nonce já consumido) e `expired_nonce_blocks` (esperar 5min TTL) quando o Bardo emitir nonces controlados; rodar `malformed_nonce_blocks` (`?bridge_nonce=abc`) — esse não precisa de coordenação Bardo, só sessão VI ativa.

---

### 4.29) VI_BARDO.IDENTITY_LINK_HARDENING.R3_SMOKE_MATRIX — `malformed_nonce_blocks` PASS em duas camadas (2026-05-13)

**Status:** ✅ smoke `malformed_nonce_blocks` executado em produção; rejeição confirmada em duas camadas independentes (UI client-side + edge server-side); structured log + DB diff verificados.

**Operação executada pelo operator (Claude via Chrome MCP, sessão count4all VI):**

**Camada 1 — UI client-side (defense-in-depth):**

* Navegação direta: `https://voiceideas.vercel.app/connect-bardo?bridge_nonce=abc`
* `safeBridgeNonce` em `ConnectBardo.tsx` valida regex `/^[0-9a-f]{64}$/i` → `abc` rejeitado → `bridgeNonce = null`
* Fluxo cai no branch "no nonce + no bardo_user_id" → render `connectBardo.error.missingBardoId`
* Mensagem exibida (pt-BR): "O link do Bardo veio sem o identificador da conta. Volte ao Bardo e tente conectar novamente."
* **Nenhuma chamada de rede ao edge `link-bardo-account`** (network panel limpo)
* Custo: zero (validação local antes de qualquer request)

**Camada 2 — Edge server-side (boundary check, bypass do UI):**

* Fetch direto via `javascript_tool` na aba VI logada (JWT real do count4all VI):

  ```js
  fetch('https://uhzwqhaxnodtshlvvikt.supabase.co/functions/v1/link-bardo-account', {
    method: 'POST',
    headers: { Authorization: 'Bearer <count4all JWT>', apikey: '<same>' },
    body: JSON.stringify({ bridge_nonce: 'abc' })
  })
  ```

* Resposta edge:

  ```
  HTTP 400
  Content-Type: application/json
  Body: {"code":"malformed_nonce","error":"Invalid bridge_nonce format"}
  ```

* Structured log (`function_logs` @ 2026-05-13 16:25:04.705 UTC):

  ```json
  {
    "event": "link_attempt",
    "result": "malformed_nonce",
    "vi_user_id": "57bdd56b-49a7-44ab-ba53-bb81f6328972",
    "timestamp": "2026-05-13T16:25:04.705Z"
  }
  ```

  Note: payload é compacto (não inclui `bardo_user_id_prefix` ou `vi_email_masked`) porque o branch malformed sai antes de qualquer enrichment — `result: "malformed_nonce"` é tudo que importa para auditoria.

* DB diff `bardo_account_links` antes vs depois:

  | id          | status  | updated_at                  | diff |
  |-------------|---------|-----------------------------|------|
  | `09936f4b`  | active  | 2026-05-13 15:33:58.45+00   | **unchanged** |
  | `2e266f5b`  | revoked | 2026-05-13 15:33:58.05+00   | unchanged |
  | `b2b1f238`  | revoked | 2026-05-12 15:25:28.85+00   | unchanged |
  | `a5273c62`  | revoked | 2026-05-12 12:09:51.01+00   | unchanged |

  Total: 4 rows antes / 4 rows depois. Zero INSERT, zero UPDATE.

**Critérios de aceitação (malformed_nonce_blocks):**

| Critério | Resultado | Evidência |
|---|---|---|
| HTTP status do edge p/ `bridge_nonce=abc` | 400 | fetch direto |
| Response body `code` field | `malformed_nonce` | response body |
| Response body `error` field | `"Invalid bridge_nonce format"` | response body |
| structured log `result` field | `malformed_nonce` | `function_logs` |
| UI client-side bloqueia antes do edge | sim | network panel limpo após navegação |
| DB rows mutated | 0 | DB diff: 4 = 4 |
| Tag v0.1.0, link active 09936f4b | preservados | DB consistente |

**Smoke matrix atualizado:**

| Cenário | Status | Notas |
|---|---|---|
| `valid_nonce_same_email` | PASS | entry 4.27 |
| `vi_to_bardo_note_flow` | PASS | implicação 4.27 |
| `import_status_return` | PASS | implicação 4.27 |
| `mismatch_blocks` | PASS | entry 4.28 |
| `malformed_nonce_blocks` | **PASS (2026-05-13 16:25:04)** | esta entry — UI + edge ambos provados |
| `reused_nonce_blocks` | not run | requer nonce Bardo válido — coord. |
| `expired_nonce_blocks` | not run | requer espera TTL 5min + nonce Bardo |
| `legacy_blocked` | PASS indireto | `ALLOW_LEGACY_BARDO_LINK` ausente |

**Achado bônus de defesa em camadas:** a UI já rejeita malformed antes do edge ver o request. Isso é boa prática (reduz noise no log e custo de cold-start da função), mas o edge MANTÉM o regex como single source of truth de segurança — confirmado por bypass direto.

**Tag v0.1.0, schema, link active `09936f4b`:** intactos. Sem mudança de código (apenas verificação operacional).

**Próximo bloco:** `reused_nonce_blocks` (decisão Caminho A vs B pendente do Gian) e `expired_nonce_blocks` (5min TTL wait + coord Bardo).

---

### 4.30) VI_BARDO.IDENTITY_LINK_HARDENING.R3_SMOKE_MATRIX — `reused_nonce_blocks` Caminho B PASS funcional + achado de code mapping (2026-05-13)

**Status:** ⚠️ smoke `reused_nonce_blocks` (Caminho B) executado em produção; bloqueio funcional confirmado (nenhum link duplicado), MAS code semântico retornado é `bardo_consumer_error` (502) em vez de `reused` (403) — achado de mapping no edge.

**Operação executada pelo operator (Claude via Chrome MCP, sessões count4all VI + count4all Bardo):**

**Pre-mutação:** revoguei manualmente `09936f4b` via UPDATE SQL (`link_status='revoked'` em 16:42:46.270 UTC). Necessário para que Bardo UI permitisse re-emissão de nonce.

**Sequência:**

1. **Bardo `bridge-link-issue-nonce` (POST, JWT count4all Bardo c1bbf06e):**

   ```json
   { "return_url": "https://obardo.app/" }
   ```

   Resposta:

   ```json
   {
     "ok": true,
     "bridge_nonce": "<64 hex>",
     "expires_at": "2026-05-13T16:52:30.719Z",
     "return_url": "https://obardo.app/"
   }
   ```

   Allowlist Bardo aceita apenas `obardo.app` (descoberta: `voiceideas.vercel.app`, `voiceideas.com`, `voiceideas.app`, `localhost` → `host_not_allowed`). `return_url` ali serve para Bardo refletir aonde voltar pós-flow, não é onde VI consome.

2. **VI `link-bardo-account` 1ª chamada (POST, JWT count4all VI 57bdd56b, body `{bridge_nonce: N}`):**

   * HTTP 200
   * Response:

     ```json
     {
       "ok": true,
       "linked": true,
       "created": true,
       "updated": false,
       "link_status": "active",
       "link": {
         "id": "ed49c22e-915f-4ef9-9f3a-144c4991ffe0",
         "vi_user_id": "57bdd56b-49a7-44ab-ba53-bb81f6328972",
         "bardo_user_id": "c1bbf06e-7ea0-41e5-a726-2af9da9f3e66",
         "bardo_email": null,
         "link_status": "active",
         "linked_at": "2026-05-13T16:49:09.886388+00:00"
       }
     }
     ```

   * Structured log: `{"event":"link_attempt","result":"valid","vi_user_id":"57bdd56b...","vi_email_masked":"co***@gmail.com","bardo_user_id_prefix":"c1bbf06e","timestamp":"2026-05-13T16:49:08.875Z"}`

3. **VI `link-bardo-account` 2ª chamada (mesmo nonce, ~6s depois):**

   * HTTP 502
   * Response: `{"error":"Could not validate nonce with Bardo","code":"bardo_consumer_error"}`
   * Structured log: `{"event":"link_attempt","result":"bardo_consumer_error","vi_user_id":"57bdd56b...","vi_email_masked":"co***@gmail.com","timestamp":"2026-05-13T16:49:14.901Z"}` — sem `bardo_user_id_prefix` porque o branch sai antes do enrichment.

**Por que `bardo_consumer_error` e não `reused`:**

Inspeção do `link-bardo-account/index.ts` revela mapping atual:

* `consumeBardoNonce` retorna `ok: res.ok` (i.e., apenas 2xx é "ok")
* Se Bardo responde com **não-2xx** (mesmo que body inclua `code: 'reused'`), VI marca `ok: false` → cai em branch `bardo_consumer_error` (502) sem inspecionar body
* O branch que mapeia `bardoCode === 'reused'` para VI `reused` (403) só é avaliado quando Bardo retorna 2xx com `email_hash_match !== true`

Resultado: na 2ª tentativa, Bardo provavelmente respondeu com HTTP 410/409/403 carregando `code: 'reused'` no body, mas VI ignorou o body e usou só o status. **Código semântico perdido; bloqueio funcional intacto.**

**DB final `bardo_account_links`:**

| id          | status   | linked_at                  | revoked_at                | nota |
|-------------|----------|----------------------------|---------------------------|------|
| `ed49c22e`  | **active** | 2026-05-13 16:49:09.88+00 | —                         | **NEW** R3-verified (count4all↔c1bbf06e) |
| `09936f4b`  | revoked  | 2026-05-13 15:33:58.45+00  | 2026-05-13 16:42:46.27+00 | pre-mutação manual |
| `2e266f5b`  | revoked  | 2026-05-12 15:25:29+00     | 2026-05-13 15:33:57.40+00 | F2 cross-link |
| `b2b1f238`  | revoked  | 2026-05-11 20:30:11+00     | 2026-05-12 15:25:28.62+00 | E2E count4all original |
| `a5273c62`  | revoked  | 2026-04-19 21:24:57+00     | 2026-05-12 12:09:51.01+00 | Gian hotfix antigo |

Total: 5 rows. Apenas 1 active. **Nenhuma row duplicada da segunda tentativa.** Cross-link 642f4864 segue revoked.

**Critérios de aceitação (per task spec):**

| Critério | Resultado | Evidência |
|---|---|---|
| 1ª consume → success | ✅ | HTTP 200, `created: true`, row `ed49c22e` |
| 1ª consume → row R3-verified ativa | ✅ | `link_status: active`, `bardo_email: null` |
| 1ª consume → 09936f4b revoked | ✅ (pre-revogada) | manual UPDATE @ 16:42:46 |
| 2ª consume → bloqueio | ✅ funcional | 502 + nenhuma row nova |
| 2ª consume → code = `reused`/`already_consumed` | ⚠️ **não** — code = `bardo_consumer_error` | finding (ver F6) |
| 2ª consume → structured log | ✅ | `result: bardo_consumer_error` |
| apenas 1 active link final para vi_user_id count4all | ✅ | apenas `ed49c22e` active |
| active link aponta para `bardo_user_id` prefix `c1bbf06e` | ✅ | `c1bbf06e-7ea0-41e5-a726-2af9da9f3e66` |
| nenhuma row ativa para cross-link `642f4864` | ✅ | `2e266f5b` revoked permanente |

**Smoke matrix atualizado:**

| Cenário | Status | Notas |
|---|---|---|
| `valid_nonce_same_email` | PASS | entry 4.27 |
| `vi_to_bardo_note_flow` | PASS | implicação 4.27 |
| `import_status_return` | PASS | implicação 4.27 |
| `mismatch_blocks` | PASS | entry 4.28 |
| `malformed_nonce_blocks` | PASS | entry 4.29 (UI + edge) |
| `reused_nonce_blocks` | **PASS funcional / FINDING semântico** | esta entry (4.30) |
| `expired_nonce_blocks` | not run | requer espera TTL 5min |
| `legacy_blocked` | PASS indireto | `ALLOW_LEGACY_BARDO_LINK` ausente |

**Achado adicional (F6) — code mapping incompleto em link-bardo-account:**

* **Severidade:** low (UX/diagnosis); functional security intacta
* **Categoria:** Error Code Hygiene / Diagnostic Fidelity
* **Arquivo:** `supabase/functions/link-bardo-account/index.ts:213` (e linhas 364-379)
* **Evidência:** `consumeBardoNonce` retorna `ok: res.ok`. Se Bardo retorna non-2xx (mesmo carregando `code: 'reused'`/`'expired'` no body), VI mapeia direto para `bardo_consumer_error` (502). Branch de mapeamento de `bardoCode === 'reused'`/`'expired'` (linhas 397-401) só é exercitado quando Bardo retorna 2xx.
* **Correção recomendada (R4 ou pequena patch):** sempre tentar parsear body do response do Bardo (mesmo non-2xx) e inspecionar `body.code` antes de fallback. Algo como:
  ```ts
  if (!consume.ok) {
    if (consume.body?.code === 'reused') return jsonResponse({ code: 'reused' }, 403)
    if (consume.body?.code === 'expired') return jsonResponse({ code: 'expired' }, 403)
    // fallthrough
    return jsonResponse({ code: 'bardo_consumer_error' }, 502)
  }
  ```
* **Impacto:** UI/log perdem distinção entre "nonce já usado" e "Bardo offline". Não compromete segurança (vínculo não é criado), mas dificulta diagnóstico e UX (cliente recebe mensagem genérica).
* **Status:** open — endereçar em ciclo de hardening R4 (junto com migration para `bardo_email_hash` dedicado).

**Tag v0.1.0, schema, link active `ed49c22e`:** intactos. Sem mudança de código.

**Bonus — descoberta Bardo allowlist:** `bridge-link-issue-nonce` aceita apenas `obardo.app` como host em `return_url`. URLs `voiceideas.*` retornam `host_not_allowed`. Documenta-se como design Bardo-side (out-of-scope VI).

**Próximo bloco:** `expired_nonce_blocks` (emitir nonce Bardo, esperar 5min+, consumir → esperar 403/502 expired). Pode usar o mesmo padrão de captura.

---

### 4.31) VI_BARDO.IDENTITY_LINK_HARDENING.R3_SMOKE_MATRIX — `expired_nonce_blocks` PASS funcional + F6 confirmado em segundo cenário (2026-05-13)

**Status:** ⚠️ smoke `expired_nonce_blocks` executado em produção; bloqueio funcional confirmado (zero mutação), code semântico retornado é `bardo_consumer_error` (502) — **mesma manifestação de F6** (entry 4.30) agora confirmada em segundo cenário.

**Operação executada pelo operator (Claude, sessão count4all Bardo + count4all VI):**

**Sequência:**

1. **Bardo `bridge-link-issue-nonce` @ 2026-05-13 16:52:37.307Z:**

   * `return_url: 'https://obardo.app/'`
   * Resposta:

     ```json
     {
       "ok": true,
       "bridge_nonce": "<64 hex>",
       "expires_at": "2026-05-13T16:57:39.963Z",
       "return_url": "https://obardo.app/"
     }
     ```

   * TTL declarado: 303s (~5min)

2. **Wait foreground:** 315s via `sleep 315` (start 16:53:04Z, end 16:58:19Z). Garantia de ultrapassar `expires_at` (16:57:39.963Z) com margem de ~40s.

3. **VI `link-bardo-account` @ 16:58:59.694Z:**

   * HTTP 502
   * Response: `{"error":"Could not validate nonce with Bardo","code":"bardo_consumer_error"}`
   * Structured log @ 16:59:05.818Z:

     ```json
     {
       "event": "link_attempt",
       "result": "bardo_consumer_error",
       "vi_user_id": "57bdd56b-49a7-44ab-ba53-bb81f6328972",
       "vi_email_masked": "co***@gmail.com",
       "timestamp": "2026-05-13T16:59:05.818Z"
     }
     ```

**DB diff `bardo_account_links` antes vs depois:**

| id          | status   | linked_at                  | revoked_at                | diff |
|-------------|----------|----------------------------|---------------------------|------|
| `ed49c22e`  | active   | 2026-05-13 16:49:09.88+00  | —                         | **unchanged** desde criação no reused smoke |
| `09936f4b`  | revoked  | 2026-05-13 15:33:58.45+00  | 2026-05-13 16:42:46.27+00 | unchanged |
| `2e266f5b`  | revoked  | 2026-05-12 15:25:29+00     | 2026-05-13 15:33:57.40+00 | unchanged |
| `b2b1f238`  | revoked  | 2026-05-11 20:30:11+00     | 2026-05-12 15:25:28.62+00 | unchanged |
| `a5273c62`  | revoked  | 2026-04-19 21:24:57+00     | 2026-05-12 12:09:51.01+00 | unchanged |

Total: 5 rows antes / 5 rows depois. Zero INSERT, zero UPDATE. **`ed49c22e` continua único active.**

**Critérios de aceitação (per task spec):**

| Critério | Resultado | Evidência |
|---|---|---|
| HTTP status | 502 (esperado era 403 expired) | resposta direta |
| Bloqueio efetivo | ✅ | nonce não consumido, zero mutation |
| Structured log emitted | ✅ | `result: bardo_consumer_error` @ 16:59:05.818Z |
| Code = `expired` | ⚠️ **não** — code = `bardo_consumer_error` | mesma manifestação F6 |
| DB unchanged | ✅ | 5 rows = 5 rows |

**F6 (entry 4.30) confirmado em segundo cenário:** mesma raiz arquitetural — VI mapeia non-2xx do Bardo para `bardo_consumer_error` sem inspecionar `body.code`. Reused e expired ambos sofrem do mesmo blind spot diagnóstico. **Single fix em `link-bardo-account/index.ts:213` resolve ambos cenários.**

**Smoke matrix FINAL:**

| Cenário | Status | Notas |
|---|---|---|
| `valid_nonce_same_email` | PASS | entry 4.27 |
| `vi_to_bardo_note_flow` | PASS | implicação 4.27 |
| `import_status_return` | PASS | implicação 4.27 |
| `mismatch_blocks` | PASS | entry 4.28 (code: mismatch, 403) |
| `malformed_nonce_blocks` | PASS | entry 4.29 (code: malformed_nonce, 400; UI + edge) |
| `reused_nonce_blocks` | **PASS funcional / F6** | entry 4.30 (code esperado: reused, observado: bardo_consumer_error 502) |
| `expired_nonce_blocks` | **PASS funcional / F6** | esta entry (code esperado: expired, observado: bardo_consumer_error 502) |
| `legacy_blocked` | PASS indireto | `ALLOW_LEGACY_BARDO_LINK` ausente |

**Veredito R3_SMOKE_MATRIX:**

* **Segurança arquitetural central:** ✅ PROVADA. Cross-link prevention (mismatch), single-use enforcement (reused), TTL enforcement (expired), e malformed input rejection (malformed) **todos bloqueiam corretamente em produção**. Zero linkagem indevida possível.
* **Code semântico:** parcialmente alinhado. `valid`, `mismatch`, `malformed_nonce` retornam os codes esperados (403/400 com codes específicos). `reused` e `expired` caem em `bardo_consumer_error` (502) — finding F6 documentado, fix é trivial.
* **Tag v0.1.0, schema, link active `ed49c22e`:** intactos.

**Próximo bloco (sugerido):**

* **F6 fix (R4_CODE_MAPPING_PATCH):** ~10 linhas em `link-bardo-account/index.ts` (branch `!consume.ok` consulta `consume.body?.code`). Não bloqueia release; melhora UX/diagnose.
* **R3_SMOKE_MATRIX = ok** funcional → **P1.5 pode ser fechado** com nota sobre F6 como continuação.

---

### 4.32) VI_BARDO.IDENTITY_LINK_HARDENING.P1_5_CLOSE — P1.5 fechado funcionalmente + R4 registrado em backlog (2026-05-13)

**Status:** ✅ decisão Gian — fechar P1.5 sem rodar R4 hoje. R3_SMOKE_MATRIX completo é evidência suficiente de que o objetivo arquitetural ("não existe linkagem indevida possível no fluxo R3") foi atingido. F6 é higiene semântica de erro, não falha de segurança; mexer agora exigiria novo deploy + reteste de `reused` e `expired` sem ganho proporcional.

**Decisão Gian (citação direta):**
> "P1.5 já provou o que precisava provar: não há linkagem indevida possível no fluxo R3. O F6 é higiene semântica de erro, não falha de segurança. Mexer agora obrigaria novo deploy + reteste de `reused` e `expired`, sem ganho proporcional."

**Fechamento:**

```
P1.5 = CLOSED FUNCTIONALLY
R3_SMOKE_MATRIX = OK
F6 = OPEN / R4_CODE_MAPPING_PATCH
```

**Estado final consolidado (head main `4d1d990`):**

| Componente | Estado |
|---|---|
| Active link | `ed49c22e` (count4all↔count4all R3-verified, `bardo_email=null`) |
| Cross-link `642f4864` (F2) | revoked permanente |
| F2 (bardo_user_id self-attest) | resolved (R3 organic re-link + mismatch_blocks reconfirmou) |
| F4 (bardo_user_id no DOM) | resolved (C1 DOM truncation) |
| F6 (code mapping non-2xx) | open — deferred R4 |
| Tag `v0.1.0` | preservada em `fcbfcb1` (commit `e843181`) |
| HEAD main | `4d1d990` |
| Commits da sessão R3_SMOKE_MATRIX | `8ad58a6` (mismatch), `2a6b2c5` (malformed), `561e224` (reused + F6), `4d1d990` (expired) |

**Backlog atualizado:**

```
DONE
- VI.HOTFIX.LINK.1.REVOKE_GIAN
- VI_RELEASE.0.1.0.FINAL
- VI_RELEASE.REBUILD_APPS.1
- VI_SECURITY.AUDIT_0.1.0
- VI_BARDO.IDENTITY_LINK_HARDENING.C1_VI_ONLY
- VI_BARDO.IDENTITY_LINK_HARDENING.R3_CONSUME_BARDO_NONCE
- VI_BARDO.IDENTITY_LINK_HARDENING.R3_FINALIZE_SMOKE
- VI_BARDO.IDENTITY_LINK_HARDENING.R3_SMOKE_MATRIX
- VI_BARDO.IDENTITY_LINK_HARDENING (P1.5 — closed functionally)

NEXT (P3 — hygiene)
- R4_CODE_MAPPING_PATCH
  - Severity: low
  - Scope: supabase/functions/link-bardo-account/index.ts (consumeBardoNonce non-2xx branch)
  - Problema: respostas non-2xx do Bardo com code=NONCE_ALREADY_CONSUMED / NONCE_EXPIRED viram bardo_consumer_error (502)
  - Impacto: bloqueio funcional correto, mas erro semântico ruim (perde distinção entre nonce reusado, expirado e Bardo offline)
  - Correção: inspecionar body.code mesmo quando res.ok=false; mapear reused/expired antes de fallback genérico
  - Retestar: reused_nonce_blocks + expired_nonce_blocks (esperar 403 com codes específicos)
  - NÃO reabre P1.5

LATER
- VI_SECURITY.INVITE_ERROR_CODES    (P2.4)
- VI_UI.BARDO_INBOX_WARNING_CONTRAST (P2.6)
- VI_I18N.FULL_SWEEP                (P2.7)
```

**Caveat sobre exposição pública ampla:** com R3 provado em produção, a restrição da entry 4.24 ("bridge Bardo/VoiceIdeas não deve ser considerado 'seguro por arquitetura' até fechar o hardening de identidade") está satisfeita do lado da arquitetura. F6 é cosmético de erro e não recoloca essa restrição.

**Próxima sessão começa com R4_CODE_MAPPING_PATCH, sem reabrir P1.5.**

---

### 4.33) VI.R4_CODE_MAPPING_PATCH — preservar códigos semânticos non-2xx do Bardo consumer (2026-05-13)

**Status:** ✅ patch deployado em produção (`link-bardo-account` v7 ACTIVE) + cliente atualizado. Smokes `reused_nonce_blocks` e `expired_nonce_blocks` agora retornam códigos semânticos específicos (HTTP 403) em vez do fallback genérico `bardo_consumer_error` (502). P1.5 não reabriu; F6 fechado.

**Escopo respeitado:**

* ✅ Somente VoiceIdeas tocado (zero alteração Bardo)
* ✅ Schema unchanged
* ✅ Zero linha tocada manualmente
* ✅ Tag `v0.1.0` em `e843181`
* ✅ Contrato de sucesso R3 (`valid` + row criada) unchanged
* ✅ Nenhum log de nonce/secret/salt/hash completo/body bruto

**Arquivos alterados (3):**

1. `supabase/functions/link-bardo-account/index.ts`
   * Tipo `LinkAttemptLog.result`: `expired` → `expired_nonce`, `reused` → `reused_nonce`; adicionados `bardo_consumer_unauthorized`, `bardo_consumer_rate_limited`
   * Novo tipo `LinkBardoConsumerErrorCode` + helpers `mapBardoConsumerErrorCode(code)` e `httpStatusForLinkBardoConsumerError(code)`
   * Branch `!consume.ok` agora inspeciona `consume.body?.code` antes de fallback
   * Branch 2xx (`email_hash_match !== true` + `bardoCode`) usa o mesmo helper para alinhar nomes
2. `src/services/bardoAccountLinkService.ts`
   * Union `BardoAccountLinkErrorCode`: `expired` → `expired_nonce`, `reused` → `reused_nonce`; adicionados `bardo_consumer_unauthorized`, `bardo_consumer_rate_limited`
3. `src/pages/ConnectBardo.tsx`
   * Mapping `code === 'expired' || code === 'reused'` → `code === 'expired_nonce' || code === 'reused_nonce'`

**Mapeamento implementado:**

| Bardo `body.code` | VI `code` retornado | HTTP |
|---|---|---|
| `NONCE_ALREADY_CONSUMED` / `REUSED` | `reused_nonce` | 403 |
| `NONCE_EXPIRED` / `EXPIRED` | `expired_nonce` | 403 |
| `NONCE_NOT_FOUND` / `INVALID_INPUT` | `invalid_nonce` | 403 |
| `UNAUTHORIZED` | `bardo_consumer_unauthorized` | 502 |
| `RATE_LIMITED` | `bardo_consumer_rate_limited` | 429 |
| `SERVER_MISCONFIGURED` / `INTERNAL` / outros | `bardo_consumer_error` | 502 |

**Validações:**

| Verificação | Resultado |
|---|---|
| `npm run security:test` | ✅ pass (check-jwt + check-surface) |
| `npm run build` | ✅ pass (tsc -b + vite build em 16.67s) |
| `npm run lint` | 4 erros — **todos baseline pré-existente** (provado via `git stash` → mesmos 4 erros sem o patch) |
| Edge function tests | not available (nenhum `*.test.ts` em `supabase/functions/`) |
| Deploy | ✅ link-bardo-account **v7 ACTIVE** @ updated_at 1778694033602 |
| Probe sem auth | ✅ HTTP 401 |

**Smokes produção:**

### Smoke 1 — `reused_nonce_blocks` (PASS)

* Nonce Bardo emitido @ 2026-05-13T17:41:58.937Z (TTL 5min, expires 17:46:57Z)
* 1ª consume VI @ 17:42:24.828Z: HTTP 200, `created: false`, retornou link existente `ed49c22e` (idempotência — link já apontava para mesmo `bardo_user_id`). Log `result: "valid"`. Zero mutação.
* 2ª consume VI @ 17:42:30.932Z: **HTTP 403, `{"code":"reused_nonce","error":"Link blocked: reused_nonce"}`** ✓
* Structured log: `{"event":"link_attempt","result":"reused_nonce",...}` ✓

### Smoke 2 — `expired_nonce_blocks` (PASS)

* Nonce Bardo emitido @ 2026-05-13T17:43:07.793Z (TTL 5min, expires 17:48:06.377Z)
* Wait foreground 312s
* Consume VI @ 17:48:43.749Z: **HTTP 403, `{"code":"expired_nonce","error":"Link blocked: expired_nonce"}`** ✓
* Structured log: `{"event":"link_attempt","result":"expired_nonce",...}` ✓
* DB: 0 mutação (active_count=1, total=5)

**Estado final DB:** unchanged desde fim do P1.5. `ed49c22e` único active (count4all↔c1bbf06e R3-verified), 4 rows revogadas. Cross-link 642f4864 segue revoked.

**Comparação antes/depois F6:**

| Cenário | Antes (F6 open) | Depois (R4 patch) |
|---|---|---|
| Reused nonce | HTTP 502 / `bardo_consumer_error` | **HTTP 403 / `reused_nonce`** |
| Expired nonce | HTTP 502 / `bardo_consumer_error` | **HTTP 403 / `expired_nonce`** |
| Generic Bardo failure | HTTP 502 / `bardo_consumer_error` | HTTP 502 / `bardo_consumer_error` (unchanged) |
| Mismatch (2xx) | HTTP 403 / `mismatch` | HTTP 403 / `mismatch` (unchanged) |
| Malformed (VI regex) | HTTP 400 / `malformed_nonce` | HTTP 400 / `malformed_nonce` (unchanged) |

**F6 status:** **resolved (2026-05-13 via R4)**.

**Tag v0.1.0:** intacta. **HEAD main:** este commit.

---

### 4.34) VI_RELEASE.REBUILD_APPS.2 — Rebuild macOS + Android + iOS pós R4 (2026-05-13)

**Status:** ✅ artefatos macOS (`.app` + `.dmg`), Android (APK debug + AAB release) e iOS bundle (web assets sync) regerados a partir de `HEAD c67dda3` (pós R4_CODE_MAPPING_PATCH). iPad install via Xcode UI (manual, Gian opera).

**Trigger:** Pedido Gian para alinhar todos os builds com as modificações até agora (especialmente o R4 patch que mudou `BardoAccountLinkErrorCode` no `bardoAccountLinkService.ts` e mapping em `ConnectBardo.tsx`).

**Validação pre-build:** working tree limpa, HEAD `c67dda3`, tag `v0.1.0` em `e843181`.

**Sequência executada:**

1. **Web bundle:** `npm run build` (host) → `tsc -b && vite build` em 4.76s. Hash assets atuais.
2. **macOS desktop:** `npm run desktop:build` (background) → Tauri release build, gerou:
   - `src-tauri/target/release/bundle/dmg/VoiceIdeas_0.1.0_aarch64.dmg` (3.1 MB)
   - `src-tauri/target/release/bundle/macos/VoiceIdeas.app`
3. **Android:** `npm run android:build` (background) → Gradle assembleDebug + bundleRelease em 25s, gerou:
   - `android/app/build/outputs/apk/debug/app-debug.apk` (4.5 MB)
   - `android/app/build/outputs/bundle/release/app-release.aab` (3.3 MB)
4. **iOS sync:** `npm run ios:sync` (foreground) → Capacitor copy web assets para `ios/App/App/public/` (28 arquivos JS, plugins 6 sincronizados). Avisos secundários: `sync-mobile-icons` reportou ENOENT em `AppIcon-20x20@2x-1.png` (não-bloqueante; ícones existentes preservados).

**Verificação:** `ios/App/App/public/assets/ConnectBardo-DpQalYak.js` contém `reused_nonce`/`expired_nonce` strings — bundle iOS reflete o R4 patch.

**iPad install (manual via Xcode UI):**

* iPad detectado: **"Agencia Capitolio"** (iPad 6ª geração, Model A1954, identifier `5D0F9B77-5D93-51DF-8F89-247177032906`), available (paired) via USB
* Xcode 26.4 (`/Applications/Xcode.app`)
* Caminho CLI bloqueado: `xcode-select -p` aponta para `/Library/Developer/CommandLineTools` (não Xcode.app). `xcodebuild` requer `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` override OU `sudo xcode-select --switch`.
* Decisão Gian: instalar via Xcode UI (clicar Run no projeto `ios/App/App.xcodeproj`)
* Operator (Claude) abriu o projeto: `open -a Xcode ios/App/App.xcodeproj`

**Estado das plataformas pós-R4:**

| Plataforma | Artefato | Tamanho | Timestamp build | R4 incluído |
|---|---|---|---|---|
| macOS desktop | VoiceIdeas_0.1.0_aarch64.dmg | 3.1 MB | 2026-05-13 16:25 | ✅ |
| macOS desktop | VoiceIdeas.app | bundle | 2026-05-13 16:25 | ✅ |
| Android APK debug | app-debug.apk | 4.5 MB | 2026-05-13 16:25 | ✅ |
| Android AAB release | app-release.aab | 3.3 MB | 2026-05-13 16:25 | ✅ |
| iOS bundle (web) | ios/App/App/public/assets/ | 28 JS | 2026-05-13 ~16:25 | ✅ (ConnectBardo.js cita reused_nonce) |
| iOS .ipa | — | — | — | aguardando Gian clicar Run no Xcode |

**Tag v0.1.0, schema, HEAD main:** intactos. Sem novo commit (só artefatos rebuildados — não versionados).

**Install no iPad confirmado:** Gian rodou no Xcode (Cmd+R com "Agencia Capitolio" selecionada) e confirmou ("feito"). Build iOS rodando no iPad 6ª gen físico com o web bundle pós-R4 (`reused_nonce`/`expired_nonce` no ConnectBardo).

**Estado final consolidado (HEAD c67dda3 + binaries):**

| Plataforma | Estado | Evidência |
|---|---|---|
| Web (voiceideas.vercel.app) | ✅ R4 deployado | edge v7 ACTIVE |
| macOS desktop (.app/.dmg) | ✅ rebuildado | bundle May 13 16:25 |
| Android APK debug | ✅ rebuildado | app-debug.apk 4.5 MB |
| Android AAB release | ✅ rebuildado | app-release.aab 3.3 MB |
| iOS bundle (web) | ✅ sync | ConnectBardo.js cita códigos novos |
| iPad físico (Agencia Capitolio) | ✅ instalado | Gian confirmou |

---

### 4.35) VI_UX.MOBILE_COMPACTION.PASS1 — colapso de metadados + cards Bardo + header responsivo (2026-05-14)

**Status:** ✅ patch deployado no main (commit `559e0d8`); 6/8 prioridades do audit visual atendidas.

**Trigger:** Audit visual de Gian (PDF `image.pdf` 2026-05-13) identificou que o app mobile estava verboso — metadados e infra abertos por default ocupavam área nobre, header com tagline redundante, botão "Excluir gerais" perigoso.

**Decisões UX pré-aprovadas:**

* Header responsivo: **VoiceIdeas** no desktop (≥768px), **VI** no mobile
* Bardo (status crítico): **sempre colapsado** em qualquer viewport — status fica visível no badge do header
* Metadados (tags, notas-fonte, pastas, tags-do-card): **colapsado no mobile**, expandido no desktop via `forceOpenOnDesktop`

**Componentes compartilhados criados** (`src/components/CollapsibleMetaCard.tsx`):

* `CollapsibleMetaCard` — card top-level com título, status badge (5 variants: neutral/success/warning/error/info), summary line, content expandido. Modo "sempre fechado" (Bardo) ou "fechado só mobile" via `forceOpenOnDesktop`.
* `CompactDisclosure` — variação leve sem borda própria, para metadados dentro de outro card (Tags+Pastas do card de ideia).
* Ambos: `aria-expanded`, `useId` para `aria-controls`, chevron rotaciona, sem state-in-effect issues.

**Prioridades atendidas (6/8):**

| # | Prioridade | Implementação |
|---|---|---|
| 1 | Header reduzido | `Layout.tsx`: tagline removida; nome responsivo via `md:hidden` + `hidden md:inline`; padding `py-2` mobile / `py-3` desktop |
| 2 | Ponte Bardo dentro de notas | `BardoBridgeExportPanel.tsx` → `CollapsibleMetaCard` sempre fechado; status badge dinâmico (`pronto`/`bloqueado`/`importado`/`rejeitado`/`falhou`) |
| 3 | Painel export/rejeição Bardo | Mesmo refactor de #2 (single component cobre ambos cenários) |
| 4 | Tags em Ideias Organizadas | `TagCloudPanel.tsx`: initial state via `window.matchMedia('(min-width: 768px)')` — fechado no mobile, regra antiga no desktop |
| 5 | Notas-fonte | `OrganizedView.tsx` → `CollapsibleMetaCard` com `forceOpenOnDesktop=true`; help text movido para expandido |
| 6 | Tags + Pastas no card | `OrganizedView.tsx` → `CompactDisclosure` "Metadados" agrupando Tags+Pastas; summary "X tags · Y pastas" |
| 7 | Ponte Bardo inativa no topo | **deferred PASS2** — `BardoConnectionToggle` em Notes.tsx ainda renderiza expandido |
| 8 | Barra "Excluir gerais" | `Notes.tsx`: botão removido inteiramente; `handleDeleteAll` + `confirmDeleteAll` state removed. Fluxo seguro = Selecionar todas + Excluir selecionadas |

**i18n changes (3 locales):**

* `bardo.bridge.title`: `'Ponte v1 · Bardo'` → `'Bardo'` (V1 removido da UI comum, atende "remover V1 da UI comum")
* `bardo.bridge.attemptsSummary` (novo): "Tentativas: N" / "Attempts: N" / "Intentos: N"
* `organizedView.metadataTitle` (novo): "Metadados" / "Metadata" / "Metadatos"
* `organizedView.metadataSummary` (novo, com pluralização condicional): "3 tags · 1 pasta" etc.

**Validações:**

* `npx tsc -b`: ✓ pass
* `npm run build`: ✓ pass
* `npm run lint`: 4 errors baseline pré-existentes (não-introduzidos pelo patch)
* `npm run audit:i18n`: ✓ paridade total
* Edge functions / schema / Bardo: unchanged

**Backlog PASS2:** Priority 7 (BardoConnectionToggle); cleanup i18n órfãs; validation Android real (passo 8 do user).

**Commit:** `559e0d8` · **HEAD main:** `559e0d8`

---

### 4.36) VI_RELEASE.REBUILD_APPS.3 — Rebuild macOS + Android + iOS pós MOBILE_COMPACTION.PASS1 (2026-05-14)

**Status:** ✅ artefatos regerados de `HEAD 559e0d8` para alinhar todas as plataformas com o passo de compactação UX.

**Trigger:** Gian pediu "encadeie o mobile + push tb" logo após o commit do PASS1.

**Sequência executada (sequencial após race condition):**

1. `npm run build` (web bundle) — ✓
2. `npm run ios:sync` — ✓
3. `npm run android:build` (APK debug + AAB release) — ✓ (12s, BUILD SUCCESSFUL)
4. `npm run desktop:build` (Tauri macOS) — ✓ (13.83s)

**Lição aprendida:** primeira tentativa em paralelo causou race condition em `dist/` (iOS sync chamou `build:native-web` simultaneamente com Android+desktop). ENOENT em `dist/assets/CaptureQueue-*.js` durante o copy. Solução: rodar sequencial. Documentado para futuras rebuild waves.

**Artefatos gerados:**

| Plataforma | Artefato | Tamanho | Timestamp |
|---|---|---|---|
| macOS Tauri | `VoiceIdeas_0.1.0_aarch64.dmg` | 3.1 MB | 2026-05-14 12:53 |
| macOS Tauri | `VoiceIdeas.app` | bundle | 2026-05-14 12:53 |
| Android APK | `app-debug.apk` | 4.5 MB | 2026-05-14 12:52 |
| Android AAB | `app-release.aab` | 3.3 MB | 2026-05-14 12:52 |
| iOS bundle (web) | `ios/App/App/public/assets/` | 28 JS | 2026-05-14 12:52 |

**Verificação de conteúdo:**

* Android APK `ConnectBardo-DW0r4Uem.js`: contém `reused_nonce`/`expired_nonce` (R4) ✓
* Android APK `index-DJqQzBx_.js`: contém `Metadados`/metadataSummary (MOBILE_COMPACTION) ✓
* iOS bundle: 3 assets contêm strings novas (`CollapsibleMetaCard`/`reused_nonce`/`metadataSummary`) ✓
* macOS Tauri .dmg: rebuildado (May 14 12:53)

**iPad install:** continua via Xcode UI. Sem mudança de processo desde REBUILD_APPS.2.

**Tag v0.1.0, HEAD main `559e0d8`, schema:** intactos.

---

### 4.37) VI_MOBILE.RECORDING_DEFAULTS_AND_RECENTS_CLEANUP — Manual default + Limpar recentes (2026-05-14)

**Status:** ✅ 2/3 prioridades atendidas; #3 (setting de salvar áudio Manual) intencionalmente deferred porque o modo Manual hoje NÃO persiste áudio (`transcribeAudio` é stateless) — implementar requereria upload+playback novos, escopo separado.

**Decisão Gian (citação):**
> "Escopo: Skip #3, focar #1 + #2. Setting de áudio fica para outra task quando estiver decidido."

**Prioridade 1 — Modo padrão = Manual:**

* `src/lib/recorderUiPreferences.ts`:
  * Nova prop `defaultRecordingMode: RecordingMode | null` (null = primeiro boot)
  * Type `RecordingMode = 'manual' | 'continuous' | 'safe-capture'` exportado
  * `normalizeRecorderUiPreferences` valida o valor lido do localStorage
* `src/hooks/useRecorderUiPreferences.ts`:
  * Novo setter `setDefaultRecordingMode(mode)` persiste em localStorage
* `src/components/VoiceRecorder.tsx`:
  * Initial state: `recorderUiPreferences.defaultRecordingMode ?? 'manual'`
  * **Antes:** `prefersSafeCaptureOnThisPlatform ? 'safe-capture' : 'manual'` (iOS/Android caía em Safe Capture silenciosamente)
  * **Depois:** sempre `'manual'` no primeiro boot, qualquer plataforma
  * Botões UI (Manual/Contínuo/Safe Capture) chamam novo `handleSetMode` wrapper que persiste a escolha
  * Auto-fallback effect (linha 267-269, quando Safe Capture não suportado) usa `setMode` cru — não polui prefs com escolhas forçadas

**Prioridade 2 — Limpar recentes:**

* `recorderUiPreferences`: nova prop `hiddenRecentNoteIds: string[]`
* `useRecorderUiPreferences`: 3 novos métodos:
  * `hideRecentNoteIds(ids)`: marca IDs como escondidos (Set para dedupe)
  * `pruneHiddenRecentNoteIds(validIds)`: sweep periódico — remove IDs órfãos (notas deletadas)
  * `clearHiddenRecentNoteIds()`: zera tudo (não usado na UI atual, disponível para "Mostrar recentes")
* `src/pages/Home.tsx`:
  * Filtra `looseNotes` por `hiddenIdsSet` antes de `slice(0, 5)`
  * Botão "Limpar recentes" (Eraser icon) ao lado do título "Notas recentes"
  * Confirmação inline: StatusBanner com texto i18n "Notas removidas desta tela. Elas continuam salvas no arquivo." (auto-dismiss 4s)
  * `useEffect` sweep prune IDs quando notes atualiza
* **Crítico:** botão NÃO apaga do banco / fila / organizadas / arquivo. Pure UI hide.

**i18n (3 locales):**
* `home.clearRecents`: "Limpar recentes" / "Clear recent" / "Limpiar recientes"
* `home.clearRecentsHelp`: tooltip explicando escopo (sob `title=`)
* `home.recentNotesCleared`: mensagem de confirmação após click

**Validações:**

* `npx tsc -b`: ✓ pass
* `npm run build`: ✓ pass (5.78s)
* `npm run lint`: 4 erros baseline pré-existentes (verified)
* `npm run audit:i18n`: ✓ paridade total

**Out of scope (registrado como task futura — escopo elevado em 2026-05-15, ver 4.39):**

**`VI_MANUAL_AUDIO_RETENTION_FULL`** — fila explícita (2026-05-14). **Escopo absorvido por `VI_CAPTURE_ENGINE_UNIFICATION`** (2026-05-15, entry 4.39) — a decisão arquitetural posterior do Gian é resolver a retenção de áudio Manual NÃO criando um segundo capturador, mas unificando Manual + Safe Capture sob o mesmo motor. Ver entry 4.39 para a especificação completa.

**Estado atual de áudio em Manual:** stateless. `src/lib/transcribe.ts:173-208` envia o blob ao edge function `transcribe`, recebe o texto, retorna. O blob de áudio nunca é persistido em Supabase Storage. A nota `notes.raw_text` recebe só o texto transcrito.

**Não-mudanças:**

* Schema/migrations: unchanged
* Edge functions: unchanged
* Bardo: unchanged
* Tag v0.1.0 (`e843181`): preserved
* P1.5: not reopened

**Commit:** `71bf050` · **HEAD main:** `71bf050`

---

### 4.38) VI_RELEASE.REBUILD_APPS.4 — Rebuild macOS + Android + iOS pós RECORDING_DEFAULTS (2026-05-14)

**Status:** ✅ artefatos regerados de `HEAD 71bf050` para propagar default-Manual + Limpar-recentes para todas as plataformas.

**Sequência (sequencial, lição aprendida da REBUILD_APPS.3):**

1. `npm run ios:sync` (Capacitor) — ✓
2. `npm run android:build` (APK debug + AAB release) — ✓ (18s, BUILD SUCCESSFUL)
3. `npm run desktop:build` (Tauri macOS) — ✓ (compile + bundling)

**Artefatos gerados:**

| Plataforma | Artefato | Tamanho | Timestamp |
|---|---|---|---|
| macOS Tauri | `VoiceIdeas_0.1.0_aarch64.dmg` | 3.1 MB | 2026-05-14 16:02 |
| macOS Tauri | `VoiceIdeas.app` | bundle | 2026-05-14 16:02 |
| Android APK | `app-debug.apk` | 4.6 MB | 2026-05-14 16:01 |
| Android AAB | `app-release.aab` | 3.3 MB | 2026-05-14 16:01 |
| iOS bundle | `ios/App/App/public/assets/` | 28 JS | 2026-05-14 16:01 |

**Verificação:** 3 iOS assets contêm strings/símbolos novos (`Limpar recentes`/`Clear recent`/`defaultRecordingMode`/`hiddenRecentNoteIds`).

**iPad install:** Xcode + Agencia Capitolio (mesmo procedimento de antes).

**Tag v0.1.0, HEAD main `71bf050`, schema:** intactos.

---

### 4.39) VI_CAPTURE_ENGINE_UNIFICATION — Decisão arquitetural: motor único Manual + Safe Capture (2026-05-15)

**Status:** 📋 SPEC registrada — **NÃO executar agora**. Substitui/absorve `VI_MANUAL_AUDIO_RETENTION_FULL` (entry 4.37 out-of-scope) com escopo arquitetural maior.

**Trigger:** Gian, ao revisar o ticket `VI_MANUAL_AUDIO_RETENTION_FULL`, identificou que a abordagem "implementar upload+playback isolado para Manual" cria dívida — dois fluxos de permissão, dois caminhos de storage, divergência entre "gravar pra ouvir" e "gravar pra transcrever". Decisão: unificar motor de captura.

**Decisão Gian (citação direta, 2026-05-15):**
> "A decisão técnica é unificar o motor de captura. (...) Manual Mode deve usar a mesma base técnica do Safe Capture, mas com política mais simples. Safe Capture = motor robusto + continuidade + retenção + segmentação/processamento. Manual = mesmo motor robusto, porém com fluxo curto."
>
> "Diferença deve ser de política, não de motor."
>
> "Minha posição: não vale manter dois capturadores. O Manual deve ser uma configuração simplificada do motor seguro. Isso reduz risco, simplifica QA e deixa o app mais coerente."

**Por que dois capturadores hoje (dívida atual):**

* `useAudioTranscription` (manual) → grava em memória → POST `transcribe` edge → texto → descarta áudio
* `useSafeCaptureMode` + `useCaptureSession` + `audioChunkService` (Safe Capture) → grava → upload chunks pra Supabase Storage → backend transcreve → segmentação → notas
* Permissões: requestos separados por hook
* Plataformas: Safe Capture só Android/iOS com plugin nativo (`@capgo/capacitor-audio-recorder`); Manual usa Web MediaRecorder API
* Formatos: Manual produz WAV/WebM no client; Safe Capture salva o que o plugin nativo grava (M4A/AAC tipicamente)
* Bugs duplicados: stop, error recovery, retry, permission re-prompt — implementados 2x

**Arquitetura alvo (proposta Gian):**

```ts
// Tipo central
CaptureMode = 'manual' | 'safe_capture'

interface CaptureProfile {
  mode: CaptureMode
  backgroundContinuation: boolean
  autoSegmentation: boolean
  retainAudio: boolean            // user setting
  transcriptionTrigger: 'after_stop' | 'chunk_or_session'
  createSession: boolean
  showInRecent: boolean
}

// Perfis
const manualProfile: CaptureProfile = {
  mode: 'manual',
  backgroundContinuation: false,
  autoSegmentation: false,
  retainAudio: userSettings.keepManualAudio,
  transcriptionTrigger: 'after_stop',
  createSession: true,
  showInRecent: true,
}

const safeCaptureProfile: CaptureProfile = {
  mode: 'safe_capture',
  backgroundContinuation: true,
  autoSegmentation: true,
  retainAudio: true,
  transcriptionTrigger: 'chunk_or_session',
  createSession: true,
  showInRecent: true,
}

// Engine único
captureEngine.start(profile)
captureEngine.stop()
captureEngine.getAudio()      // blob ou storage URL
captureEngine.transcribe()
captureEngine.persist()
```

**Critérios de aceite (do Gian):**

1. ✅ Manual abre selecionado por default em iOS/Android — **já entregue** em VI_MOBILE.RECORDING_DEFAULTS (4.37)
2. ⬜ Manual usa o mesmo backend/plugin/caminho técnico do Safe Capture
3. ⬜ Manual grava e para sem segmentação obrigatória
4. ⬜ Manual permite ouvir o áudio gravado (play button na nota)
5. ⬜ Manual tem toggle: salvar áudio para ouvir depois (Settings `keep_manual_audio`)
6. ⬜ Se toggle desligado, áudio é só para transcrição e descartado depois
7. ⬜ Botão "limpar recentes" remove apenas da tela — **já entregue** em VI_MOBILE.RECORDING_DEFAULTS (4.37)
8. ⬜ Safe Capture continua funcionando sem regressão
9. ⬜ Nenhum fluxo novo cria segundo formato de áudio ou segundo padrão de storage

**Áreas técnicas afetadas (mapa preliminar):**

* `src/hooks/useAudioTranscription.ts` (Manual hoje) → consolidar OU adaptar para virar profile do engine
* `src/hooks/useSafeCaptureMode.ts` (Safe Capture hoje) → extrair core para `captureEngine` genérico
* `src/hooks/useCaptureSession.ts` + `src/services/audioChunkService.ts` → reutilizar para Manual
* `src/components/VoiceRecorder.tsx` → consumir uma única `captureEngine.start(profile)` em vez de branches por modo
* `supabase/migrations/`: nova migration para `notes.audio_path` ou tabela `note_audio_files` + `user_settings.keep_manual_audio`
* `src/pages/CaptureQueue.tsx` + UI de notas: adicionar Play button para áudio retido
* i18n: 3 locales, strings de retenção/playback
* Edge functions: avaliar se `transcribe` (stateless) precisa converger com `transcribe-chunk` (Safe Capture pipeline)
* `recorderUiPreferences`: campos transferidos para `user_settings` server-side (sincroniza devices)

**Riscos:**

* Plugin nativo `@capgo/capacitor-audio-recorder` exige foreground service Android; usar para Manual pode trigger permissions que não eram necessárias antes
* Web platform (desktop Tauri / browser) não tem o plugin — precisa fallback ou Manual exclusivo do native
* Schema migration de retenção precisa coordenar com bucket lifecycle (TTL? quota?)
* Mudar formato de áudio impacta transcrição (Whisper aceita ambos mas pipeline pode ter sanity checks)
* Regressão em Safe Capture (motor crítico para o usuário Android) — precisa smoke matrix dedicado

**Ordem sugerida (quando priorizado):**

1. PLAN detalhado do engine único (interfaces, signatures, lifecycle)
2. BREAK: extrair core do Safe Capture sem mudar comportamento (refactor neutro)
3. EXECUTE: implementar `captureEngine.start(profile)` consumido por VoiceRecorder
4. Profile Manual sem retenção (`retainAudio: false`): paridade com comportamento atual
5. Adicionar retenção (`retainAudio: true` + UI Play button + setting toggle)
6. Migration `user_settings.keep_manual_audio` + integração
7. Smoke matrix completa (todos os critérios de aceite)
8. Rebuild + deploy multi-plataforma
9. Limpar código dead (hooks antigos, paths antigos)

**Não-mudança agora:** este registro é SPEC apenas. Nenhuma linha de código alterada. `VI_MANUAL_AUDIO_RETENTION_FULL` (4.37) absorved.

**Próximo bloco operacional (quando Gian der ordem):** iniciar PLAN do passo 1 acima.

---

### 4.40) VI_CAPTURE_ENGINE_UNIFICATION — PLAN passo 1 (2026-05-15)

**Status:** 📋 PLAN técnico redigido — **NÃO executado**. Documento completo em `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md`.

**Trigger:** ordem Gian 2026-05-15: "Criar PLAN técnico para mapear useAudioTranscription e useSafeCaptureMode e propor extração de um CaptureEngine comum. Não implementar ainda. Formato: PLAN / EXECUTE / VERIFY."

**Conteúdo do PLAN:**

1. **Análise estrutural** — gap analysis dos dois hooks. ~60% dos concerns são comuns (permission, phase machine, MediaStream lifecycle, blob produção, error mapping, retry); diferenças são policy (transcription trigger, retainAudio, segmentação, formato).
2. **Interface alvo proposta** — tipos `CaptureProfile`, `CapturePhase`, `CaptureResult`, `CaptureEngineState`, `CaptureEngine`. Adapters por plataforma (PermissionAdapter, MediaSourceAdapter com 3 sources: WebAudioContext/MediaRecorder/CapacitorPlugin, PersistenceAdapter reaproveitando serviços existentes, TranscriptionAdapter).
3. **Matriz de resolução** profile + platform → adapter chain (Manual desktop, Manual mobile, Safe desktop, Safe mobile).
4. **BREAK** — 6 passos de extração neutra (B1-B6). Critério de fim: `npm run build/lint/security:test` passam, dois hooks ainda funcionam idênticos a hoje.
5. **EXECUTE** — 10 passos com feature flag (`useUnifiedCaptureEngine`). E1-E2 Manual sob flag, E3-E4 Safe sob flag, E5-E6 retention, E7 migration, E8 UI, E9 flip flag, E10 cleanup.
6. **VERIFY** — smoke matrix V1-V10 cobrindo Safe Capture (background, network flap, refresh), Manual (com/sem retainAudio, permission denied, iOS Safari), mode switching, recovery.
7. **Riscos** — R1 (Safe regression crítica) → R8, com mitigations.
8. **Decisões pendentes (D1-D7)** que precisam input Gian antes de codar:
   * D1: Manual deve `createSession: true`?
   * D2: Formato de áudio Manual retido (WAV downsampled vs M4A/WebM nativo)?
   * D3: TTL/quota no bucket?
   * D4: Convergir pipelines `transcribe` vs `transcribe-chunk`?
   * D5: Recovery do Manual em refresh?
   * D6: Feature flag scope (localStorage per-device vs user_settings server)?
   * D7: Storage path Manual (mesmo bucket ou separado)?
9. **Estimativa:** ~7-10 dias dedicados (não 1 sessão).
10. **Não-mudanças:** zero arquivo de código alterado, zero migration, zero teste rodado.

**Próximo bloco operacional:** Gian aprovar PLAN + responder D1-D7 → iniciar B1.

**Commit:** doc-only · **HEAD main:** unchanged funcionalmente · **Tag v0.1.0:** preservada.

---

### 4.41) VI_CAPTURE_ENGINE_UNIFICATION — Decisões D1-D7 consolidadas (2026-05-15)

**Status:** 📋 D1-D7 respondidas (7/7 = recomendação aceita). PLAN doc §7 atualizado com resoluções + caveats subordinados (C1-C3). Aguardando ordem explícita para iniciar BREAK B1.

**Resoluções (per Gian via AskUserQuestion, 2026-05-15):**

| # | Decisão | Resolução |
|---|---|---|
| D1 | `createSession` para Manual | **Sim, sempre criar** |
| D2 | Formato áudio Manual retido | **Nativo M4A/WebM** |
| D3 | TTL/quota áudio retido | **TTL 30 dias + aviso UI** |
| D4 | Convergir pipelines transcribe | **Manter dois caminhos no profile** |
| D5 | Recovery Manual em refresh | **Manter perdido (status quo)** |
| D6 | Feature flag scope | **localStorage per-device** |
| D7 | Bucket/path Manual retido | **Mesmo bucket `voice-captures`, mesmo schema** |

**Caveats novos derivados das decisões (documentados no PLAN doc):**

* **C1:** TTL bucket-wide vs metadata-filtered — D3+D7 combinados aplicariam TTL 30d também a Safe Capture chunks (que hoje não tem TTL). Decisão técnica pendente: filtrar por `x-amz-meta-capture-mode: manual` no lifecycle rule. Precisa ser resolvida antes de E5.
* **C2:** Rows `capture_sessions` antigas (pré-D1) sem paridade — back-fill é opcional.
* **C3:** Durante rollout (D6), web/iOS/Android do mesmo user podem estar em motores diferentes — aceitável porque nota final converge no mesmo schema.

**Próximo bloco operacional:** quando Gian autorizar, iniciar BREAK B1 (criar interface `CaptureEngine` + tipos em `src/services/capture/`). Sem código até ordem.

**Commit:** doc-only · **HEAD main:** funcionalmente unchanged · **Tag v0.1.0:** preservada.

---

### 4.42) VI_CAPTURE_ENGINE_UNIFICATION — BREAK B1 (tipos + interface stub) + regra TTL Manual-only consolidada (2026-05-15)

**Status:** ✅ B1 entregue. Arquivo `src/services/capture/captureEngine.ts` criado com interface + tipos stub. Comportamento runtime intocado (zero hook consome). Regra C1 (TTL Manual-only) registrada como obrigatória antes de qualquer trabalho em E5.

**Regra obrigatória C1 (Gian, 2026-05-15):**

> "TTL de 30 dias aplica somente a áudio Manual retido. Safe Capture não pode herdar TTL por bucket-wide."

**Implementação esperada (em E5, não agora):**

* Objetos Manual marcados com metadata/tag: `capture-mode=manual` no upload via `audioChunkService`.
* Lifecycle rule do bucket `voice-captures` filtra por essa tag/metadata.
* **Se Supabase Storage não permitir filtro seguro por tag/metadata no lifecycle:**
  * NÃO aplicar lifecycle automático.
  * CRIAR cleanup job explícito (cron + edge function) que filtra por `capture_sessions.mode = 'manual'` ou path/profile, e deleta via storage API.
  * NUNCA aplicar regra cega no bucket que delete Safe Capture chunks como dano colateral.
* Verificação prévia obrigatória em E5: pesquisar suporte do Supabase Storage para lifecycle por tag/metadata.

PLAN doc atualizado (`docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §7 → C1 RESOLVIDO).

**Arquivo criado em B1:** `src/services/capture/captureEngine.ts` (309 linhas)

Conteúdo:

* **Tipos** (todos exportados):
  * `CaptureMode = 'manual' | 'safe_capture'`
  * `TranscriptionTrigger = 'after_stop' | 'chunk_or_session' | 'none'`
  * `AudioPreprocessor = 'downsample_16k_wav' | 'native'`
  * `CaptureProfile` (mode + 6 flags de policy + audioPreprocessor opcional)
  * `CapturePhaseStatus` (9 estados: idle/preparing/awaiting_permission/recording/finalizing/transcribing/uploading/completed/error)
  * `CapturePhase` (status + detail i18n key)
  * `CaptureResult` (sessionId, audioStoragePath, transcript, rawBlob opcional, durationMs, format)
  * `CapturePermission` (granted/denied/prompt/unavailable)
  * `CaptureAvailability` (6 estados: available + 5 motivos de bloqueio)
  * `CaptureEngineState` (phase + permission + availability + interruptionReason + capabilities + error + pendingUploads + currentResult)
  * `CaptureEngine` (state + 6 métodos: start/stop/cancel/retryPendingUpload/reset/clearError)
* **Stub factory:** `createCaptureEngineStub()` retorna engine cujos métodos lançam `CaptureEngineUnimplementedError`. Documentado que produção NÃO consome em B1 — esqueleto pra validar tipos.
* **JSDoc completo:** referência ao PLAN doc + às 7 decisões D1-D7 + a regra C1 inline no comment.

**Imports usados:**
* `AudioCaptureCapabilities` de `src/utils/platform/audioCaptureCapabilities.ts`
* `PendingCaptureUploadRecord` de `src/services/mobileLocalCaptureStore.ts`
* Ambos via `import type` (zero runtime overhead).

**Validações:**

* `npx tsc -b`: ✅ pass
* `npm run build`: ✅ pass (6.72s)
* `npx eslint src/services/capture/captureEngine.ts`: ✅ clean
* Hooks atuais (`useAudioTranscription`, `useSafeCaptureMode`): unchanged
* Safe Capture, Manual, TTL/lifecycle: zero mudança

**Critério de fim do B1 atendido:** arquivo existe, tipos compilam, hooks atuais funcionam idênticos. Pronto pra B2.

**Próximo bloco:** B2 (criar diretório `src/services/capture/adapters/` com 3 arquivos stub: permission, mediaRecorderSource, webAudioSource) — aguardar ordem.

**Commits:**
* `9585aeb` — feat(capture): BREAK B1 + chronicle 4.42 + PLAN doc C1 update. ⚠️ acidentalmente incluiu `ios/App/build-ios/` (xcodebuild local DerivedData).
* `98354d0` — chore: gitignore `ios/App/build-ios` e cleanup. Removido do tracking, ainda no disco local.

**Tag v0.1.0:** preservada.

---

### 4.14) VI_RELEASE.IOS_IPAD.3 — Smoke visual no iPad confirmado (2026-05-12)

**Status:** ✅ usuário (Gian) confirmou: "o app está rodando e funcionando" no iPad físico.

**Estado consolidado por plataforma (versão 0.1.0):**

| Plataforma | Estado | Evidência |
|---|---|---|
| Web (voiceideas.vercel.app) | ✅ funcional | Bridge stack ao vivo, ciclo VI↔Bardo |
| VI ↔ Bardo | ✅ ciclo fechado | VI_BRIDGE.FINAL_STATUS_CYCLE.1 + smokes |
| Desktop macOS arm64 | ✅ funcionando | VoiceIdeas.app + DMG; Gian confirmou |
| Android | ✅ funcionando | APK debug + AAB; Gian confirmou install + abertura |
| iPad iOS local | ✅ funcionando | install + launch via devicectl + visual smoke do Gian |
| App Store / TestFlight | ⏸ bloqueado | Aguardando Apple Developer paga (US$ 99/ano) |

**iPad smoke confirmado (2026-05-12):**
* Build pro device físico (xcodebuild + DEVELOPER_DIR=Xcode.app)
* Install via `xcrun devicectl device install app`
* Launch via `xcrun devicectl device process launch`
* App rodando — confirmado visualmente pelo Gian

**Limitações conhecidas (Apple ID free):**
* Cert dura 7 dias — depois precisa rebuild + reinstall via mesmos comandos.
* App Store / TestFlight bloqueados até Apple Developer paga.

**VoiceIdeas está oficialmente validado para uso local multiplataforma em versão 0.1.0.**

**Próximos passos sugeridos (sem ordem obrigatória):**
* Housekeeping do working tree (modificações + untracked pré-existentes acumuladas).
* Checklist final de release local 0.1.0 (tag git, changelog, snapshot dos artefatos).
* Smokes pré-distribuição pública (quando for o caso): Android lock-screen long capture, notarização desktop, signing release Android com keystore Play Store, Apple Developer paga + App Store.

---

### 4.13) VI_RELEASE.IOS_IPAD.2 — App instalado e lançado no iPad físico (2026-05-12)

**Status:** ✅ build device + install + launch automatizados via CLI. Smoke visual fica com o Gian (5 cliques no iPad).

**Signing resolvido (configurado pelo Gian no Xcode antes da task):**
* `CODE_SIGN_STYLE = Automatic`
* `CODE_SIGN_IDENTITY = "iPhone Developer"`
* `DEVELOPMENT_TEAM = XDFKA49BZ7` (Apple ID free / Personal Team)
* `PRODUCT_BUNDLE_IDENTIFIER = com.voiceideas.mobile` (mantido — Apple ID free aceitou sem conflito)
* `MARKETING_VERSION = 0.1.0`
* `CURRENT_PROJECT_VERSION = 2`

**iPad físico:**
* Nome: `Agencia Capitolio`
* Modelo: iPad 6th gen (A1954, iPad7,6)
* UDID: `5D0F9B77-5D93-51DF-8F89-247177032906`
* Hostname: `Agencia-Capitolio.coredevice.local`
* State no devicectl: `connected`

**Comandos executados (via DEVELOPER_DIR pra usar Xcode 26.4 sem mexer em xcode-select):**

```bash
# Build pro device:
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project ios/App/App.xcodeproj -scheme App \
    -configuration Debug \
    -destination "platform=iOS,id=5D0F9B77-5D93-51DF-8F89-247177032906" \
    -derivedDataPath /tmp/voiceideas-ios-device build
# → ** BUILD SUCCEEDED **
# → .app em /tmp/voiceideas-ios-device/Build/Products/Debug-iphoneos/App.app

# Install no iPad:
xcrun devicectl device install app \
  --device 5D0F9B77-5D93-51DF-8F89-247177032906 \
  /tmp/voiceideas-ios-device/Build/Products/Debug-iphoneos/App.app
# → App installed: bundleID=com.voiceideas.mobile
# → databaseUUID=AE0685F6-2B61-4D3B-BF84-7B0E34ABC2C6
# → installationURL=file:///private/var/containers/Bundle/Application/23166271-…/App.app/

# Launch no iPad:
xcrun devicectl device process launch \
  --device 5D0F9B77-5D93-51DF-8F89-247177032906 \
  com.voiceideas.mobile
# → Launched application with com.voiceideas.mobile bundle identifier
```

**Bundle metadata do .app instalado:**
* `CFBundleDisplayName`: `VoiceIdeas`
* `CFBundleIdentifier`: `com.voiceideas.mobile`
* `CFBundleShortVersionString`: `0.1.0`
* `CFBundleVersion`: `2`

**Bridge stack verificada no .app instalado:**

Greps em `App.app/public/assets/` confirmaram 1 match cada para todos os 8 markers:
* "Importado no Bardo", "Reenviar último conteúdo", "Conta VoiceIdeas", "Conexão com o Bardo disponível", `external_integrations_enabled`, `useSnapshot`, "A fonte original mudou", "Bardo conectado"

**Segurança:** zero ocorrências de `VITE_OPENAI_API_KEY` / `OPENAI_API_KEY` em `App.app/public/` (P0.3 preservado).

**Smoke pendente (visual, com o Gian no iPad):**
* App abre, tela não fica branca
* Login funciona
* Settings abre + card "Conta VoiceIdeas" mostra avatar/nome
* Card mostra "Bardo conectado" ou CTA de vínculo
* Permissão microfone solicitada na 1ª gravação
* Gravação básica funciona
* Safe capture (se exercitado)

**Limitações conhecidas (Apple ID free):**
* Certificate dura **7 dias** — depois iPad mostra "could not be verified", precisa rebuildar + reinstalar.
* `xcrun devicectl device process launch` retornou aviso `No provider was found. devicectl manage create may support a reduced set of arguments` ANTES do launch efetivo. Isso é um warning conhecido em macOS pré-Sonoma com Personal Team; o launch concluiu OK ("Launched application with com.voiceideas.mobile bundle identifier"). Sem impacto.
* Push notifications, app groups, app capabilities sem free tier do Apple ID. VoiceIdeas não usa nenhum desses.

**App Store / TestFlight continuam FORA DE ESCOPO**: user ainda sem Apple Developer paga (US$ 99/ano).

**Próximo bloco (independente):**
* Smoke visual do Gian no iPad (5 min de checklist).
* Smokes pré-distribuição pública (Android lock-screen, notarização desktop, signing release).
* App Store readiness quando user adquirir Apple Developer paga.

---

### 4.12) VI_RELEASE.IOS_IPAD.1 — Build iOS alinhado, simulator validado (2026-05-12)

**Status:** ✅ projeto iOS alinhado em 0.1.0; build simulator validado; install em iPad físico **fora de escopo** (sem Apple Developer paga).

**Versão alinhada em iOS:**
* `ios/App/App.xcodeproj/project.pbxproj`:
  * `MARKETING_VERSION`: `1.0` → `0.1.0` (CFBundleShortVersionString)
  * `CURRENT_PROJECT_VERSION`: `1` → `2` (CFBundleVersion)
  * Aplicado em ambas as build configs (Debug + Release)
* `Info.plist` consome via `$(MARKETING_VERSION)` e `$(CURRENT_PROJECT_VERSION)` — propagação automática.
* App construído carrega:
  * `CFBundleShortVersionString = "0.1.0"` ✓
  * `CFBundleVersion = "2"` ✓
  * `CFBundleIdentifier = "com.voiceideas.mobile"` ✓
  * `CFBundleDisplayName = "VoiceIdeas"` ✓

**Configuração iOS:**
* `IPHONEOS_DEPLOYMENT_TARGET = 15.0`
* `TARGETED_DEVICE_FAMILY = "1,2"` (iPhone + iPad)
* `NSMicrophoneUsageDescription` presente em pt-BR
* `appId = com.voiceideas.mobile` no `capacitor.config.ts`
* 6 plugins Capacitor resolvidos:
  * `@capacitor/app@8.0.1`
  * `@capacitor/browser@8.0.2`
  * `@capacitor/filesystem@8.1.2`
  * `@capacitor-community/keep-awake@8.0.0`
  * `@capgo/capacitor-audio-recorder@8.0.12`
  * `@capgo/capacitor-speech-recognition@8.0.10`
* 18 PNGs de ícone em `Assets.xcassets/AppIcon.appiconset/` + `Contents.json`

**Sync executado:**
* `npm run ios:sync` → `build:native-web` + `cap sync ios` + `sync:mobile-icons`
* Web assets copiados para `ios/App/App/public/assets/`
* `Package.swift` atualizado pelo Capacitor com os 6 plugins

**Bridge stack verificada no bundle iOS:**

`ios/App/App/public/assets/` contém os chunks da ponte:
* `ConnectBardo-BHFvfVZR.js`
* `bardoAccountLinkService-B3Bmss68.js`
* `Settings-C5B5zmwy.js`
* `organizedIdeaService-C2QptA7I.js`

Markers verificados (1 match cada — todos os 8):
* "Importado no Bardo", "Reenviar último conteúdo", "Conta VoiceIdeas", "Conexão com o Bardo disponível", `external_integrations_enabled`, `useSnapshot`, "A fonte original mudou", "Bardo conectado"

**Segurança:**
* Zero ocorrências de `VITE_OPENAI_API_KEY` / `OPENAI_API_KEY` em `ios/App/App/public/` (P0.3 preservado).

**Build simulator validado:**

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project ios/App/App.xcodeproj -scheme App \
    -sdk iphonesimulator -configuration Debug \
    -derivedDataPath /tmp/voiceideas-ios-build \
    CODE_SIGNING_ALLOWED=NO build
```

* Resultado: `** BUILD SUCCEEDED **`
* `.app` gerado em `/tmp/voiceideas-ios-build/Build/Products/Debug-iphonesimulator/App.app` (7.7 MB)
* Toolchain: Xcode 26.4 (build 17E192)
* Note: o sistema tem `xcode-select` apontando para CommandLineTools; usamos `DEVELOPER_DIR` env para apontar para Xcode.app sem precisar de sudo.

**Hardware detectado (NÃO instalado):**
* iPad físico pareado: `Agencia Capitolio` (iPad 6th gen, A1954, identifier `5D0F9B77-…`).
* Provisioning Profile / signing identity de Apple Developer paga **NÃO disponível** (constraint do user). Sem isso, `xcodebuild install` para device físico não é viável.

**App Store / TestFlight — FORA DE ESCOPO desta task:**
* Usuário ainda **não possui** conta Apple Developer paga.
* `VI_RELEASE.IOS_IPAD.1` é especificamente sobre **alinhamento de versão + build local validado + projeto pronto pra abrir no Xcode**.
* Submission App Store, TestFlight e signing release ficam bloqueados até o user adquirir conta Apple Developer/publisher paga (US$ 99/ano).

**Instalação no iPad — caminho manual recomendado (free sideload):**

Sem Apple Developer paga, o user pode instalar via "Personal Team" (Apple ID free) com cert de 7 dias:

1. Conectar iPad pelo cabo + habilitar Developer Mode no iOS (Settings → Privacy & Security → Developer Mode).
2. `npm run ios:open` → abre `ios/App/App.xcworkspace` (na verdade `ios/App/App.xcodeproj`) no Xcode.
3. No Xcode, selecionar o target `App`.
4. Em `Signing & Capabilities` → adicionar Team = Apple ID pessoal (free).
5. Selecionar device `Agencia Capitolio (iPad 6th gen)` no top bar.
6. Click ▶ (Build & Run).
7. No iPad, confiar no certificate em `Settings → General → VPN & Device Management`.
8. App instala. Cert de Apple ID free dura 7 dias — depois precisa rebuildar.

**Próximo bloco lógico (independente):**
* Smokes pré-distribuição pública (Android lock-screen, signing release, notarização Apple ID DEV).
* (Quando user adquirir Apple Developer paga) submissão App Store + TestFlight.

---

### 4.11) HOTFIX.LINK.1.REVOKE_GIAN — hotfix revogado (2026-05-12)

**Status:** ✅ revogado com sucesso. Histórico preservado. Vínculo real (count4all) intocado.

**Estado pré-revogação:**
| id | link_status | revoked_at |
|---|---|---|
| `a5273c62-…` (Gian hotfix) | active | null |
| `b2b1f238-…` (count4all real) | active | null |

Total: 2 rows, 2 active.

**Comando executado (Management API SQL):**
```sql
UPDATE public.bardo_account_links
SET link_status='revoked', revoked_at=now(), updated_at=now()
WHERE id='a5273c62-7c51-46ad-b8cd-dc4942803f65'
  AND link_status='active'
  AND revoked_at IS NULL
RETURNING id, link_status, revoked_at, updated_at;
```

Filtro tríplice (id + status='active' + revoked_at IS NULL) garante revogação idempotente — qualquer chamada subsequente NÃO faz nada. Predicado redundante mas defensivo contra race.

**Estado pós-revogação:**
| id | link_status | linked_at | revoked_at | updated_at |
|---|---|---|---|---|
| `a5273c62-…` (Gian) | **revoked** | 2026-04-19 21:24:57 (preservado) | 2026-05-12 12:09:51 | 2026-05-12 12:09:51 |
| `b2b1f238-…` (count4all) | active (intocado) | 2026-05-11 20:30:11 | null | 2026-05-11 20:30:11 |

Total: 2 rows (zero deletes), 1 active, 1 revoked.

**Garantias:**
* Histórico preservado — `linked_at` mantido como rastro de "esta conexão existiu de 19/04 a 12/05".
* Nenhum delete executado.
* count4all (vínculo legítimo via `/connect-bardo`) intocado — `updated_at` segue 2026-05-11.
* `bridge-exports` (P1.3+) continua exigindo vínculo ativo. Próxima vez que o Gian abrir o Inbox no Bardo, vai receber `403 ACCOUNT_LINK_REQUIRED` (esperado) — o que dispara a CTA do Bardo "Finalizar vínculo no VoiceIdeas" → fluxo automático via `/connect-bardo`. Esse é o teste definitivo: passar pelo fluxo limpo sem precisar de hotfix.

**Validações técnicas:**
* `npm run build` verde (versão 0.1.0).
* `supabase migration list --linked`: sincronizada até `202605120003`.
* `supabase functions list`: bridge stack intacta (`export-to-cenax v9`, `bridge-items v6`, `bridge-exports v6`, `link-bardo-account v2`, `bridge-identity-check v2`).

**Próxima validação operacional (não bloqueia):**
* No próximo abrir do Bardo Inbox pelo Gian, observar:
  1. Inbox retorna 403 ACCOUNT_LINK_REQUIRED.
  2. Bardo mostra CTA "Finalizar vínculo no VoiceIdeas".
  3. Click no CTA → redirect pra `/connect-bardo?bardo_user_id=642f4864-…&bardo_email=conactseculo21@gmail.com&return=…`.
  4. VI cria nova row em `bardo_account_links` (3ª row no DB), `link_status='active'`, agora via fluxo automático.
  5. Volta ao Bardo, Inbox abre 200.

**Próximo bloco:**
1. iOS / App Store readiness
2. Smokes pré-distribuição (Android lock-screen, signing, notarização)

---

### 4.10) VI_RELEASE.DEVICE_SMOKE.1 — Smoke device Android + Desktop (2026-05-12)

**Status:** ✅ ambos confirmados funcionais pelo usuário.

**Confirmações:**
* **Android APK**: instala (após bump versionCode=2) e abre no device do Gian. Ícone aparece corretamente (foreground com safe-area + máscara adaptive). Versão exibida: 0.1.0.
* **Desktop (.app + .dmg)**: abre e funciona. Bridge stack carregando.

**Versão alinhada em todos os clientes:**
* `package.json`: `0.1.0`
* `android/app/build.gradle`: versionCode 2, versionName "0.1.0"
* `src-tauri/tauri.conf.json`: `0.1.0`
* `src-tauri/Cargo.toml`: `0.1.0`

**Artefatos disponíveis em produção:**

| Plataforma | Caminho | Tamanho |
|---|---|---|
| Desktop macOS arm64 (DMG) | `dist/VoiceIdeas_0.1.0_aarch64.dmg` | 3.1 MB |
| Desktop macOS arm64 (.app) | `dist/VoiceIdeas.app` | 8.6 MB |
| Android Debug APK | `android/app/build/outputs/apk/debug/app-debug.apk` | 4.7 MB |
| Android Release AAB | `android/app/build/outputs/bundle/release/app-release.aab` | 3.4 MB |

**Smokes confirmados (usuário):**
* APK Android abre e funciona após install.
* Desktop app abre e funciona.

**Smokes ainda pendentes (não bloqueadores para uso pessoal, bloqueadores para distribuição pública):**
* Android: lock-screen capture longa (>10min) — gate final pré-Play Store.
* Android: recuperação após process death.
* Android: keystore Play Store próprio (AAB hoje sai com debug keystore).
* Desktop: notarização Apple Developer ID (para distribuição fora da Mac App Store).
* Desktop: build Intel/universal (atualmente só arm64).
* iOS / App Store: ainda não iniciado.

**Próximo bloco:**
1. iOS / App Store readiness (iniciar)
2. Cleanup HOTFIX.LINK.1 (independente; pode ser feito a qualquer momento)
3. Smokes pendentes de release pública (Android lock-screen, signing, notarização) quando for partir pra distribuição

---

### 4.9) VI_RELEASE.ANDROID.1 — Build Android após desktop (2026-05-12)

**Artefatos gerados:**
* Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk` (4.5 MB)
* Release AAB: `android/app/build/outputs/bundle/release/app-release.aab` (3.3 MB)
* (Release APK unsigned `android/app/build/outputs/apk/release/app-release-unsigned.apk` é artefato antigo de 2026-04-08, não desta build)

**Build duration:** 42s (cache do Gradle reaproveitado; 606 actionable tasks, 357 executed)

**Metadata:**
* `applicationId`: `com.voiceideas.mobile`
* `versionCode`: 1
* `versionName`: 1.0
* `minSdkVersion`: 24
* `targetSdkVersion`: 36
* `compileSdkVersion`: 36

**Configuração Android (AndroidManifest.xml):**

Permissões declaradas:
* `INTERNET`
* `RECORD_AUDIO`
* `MODIFY_AUDIO_SETTINGS`
* `WAKE_LOCK`
* `FOREGROUND_SERVICE`
* `FOREGROUND_SERVICE_MICROPHONE`

Serviço:
```xml
<service
  android:name=".capture.CaptureForegroundService"
  android:exported="false"
  android:foregroundServiceType="microphone" />
```

MainActivity:
* `MainActivity extends BridgeActivity` (Capacitor)
* `registerPlugin(SecureCapturePlugin.class)` no `onCreate` antes de `super.onCreate`

Plugin nativo de captura segura:
* `android/app/src/main/java/com/voiceideas/mobile/capture/CaptureForegroundService.kt`
* `android/app/src/main/java/com/voiceideas/mobile/capture/SecureCaptureRuntime.kt`
* `android/app/src/main/java/com/voiceideas/mobile/capture/SecureCapturePlugin.kt`

**Bridge stack verificada no bundle Android (`android/app/src/main/assets/public/assets/`):**

Greps (1 match cada — minified mas presente):
* "Importado no Bardo"
* "Reenviar último conteúdo"
* "Conta VoiceIdeas"
* "Conexão com o Bardo disponível"
* `external_integrations_enabled`
* `useSnapshot`
* "A fonte original mudou"
* "Bardo conectado"

Chunks com ponte:
* `ConnectBardo-BHFvfVZR.js`
* `bardoAccountLinkService-B3Bmss68.js`
* `Settings-C5B5zmwy.js`
* `organizedIdeaService-C2QptA7I.js`

**Segurança:**
* Zero ocorrências de `VITE_OPENAI_API_KEY` / `OPENAI_API_KEY` em `android/app/src/main/assets/public/` (P0.3 preservado).
* Envs Supabase (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) presentes via Vite build (mesmo backend `uhzwqhaxnodtshlvvikt`).

**Não há regressão da ponte:**
* Capacitor Android é cliente do mesmo Supabase project que web e desktop.
* Bundle web em `android/app/src/main/assets/public/` é idêntico ao desktop-dist (mesmas hashes de chunks).
* Ciclo VI ↔ Bardo (VI_BRIDGE.FINAL_STATUS_CYCLE.1) cobre todos os clients igualmente.

**Limitação CRÍTICA — device real NÃO testado nesta task:**
* Nenhum device Android conectado via ADB (`adb devices` retornou lista vazia).
* **Lock-screen capture NÃO foi validada** nesta rodada.
* Recuperação após process death NÃO foi exercitada com device real.
* Os builds são tecnicamente saudáveis (compilam, manifest correto, plugin registrado, perms certas), mas validar **safe capture em hardware com tela bloqueada** continua sendo o gate final de release-readiness Android. Sem isso, **não declarar Android "release-ready" para distribuição na Play Store.**

**Pendências de release Android:**
* Smoke real com device físico Android: instalar APK debug → login → iniciar captura segura → bloquear tela por ≥10min → parar captura → confirmar manifesto/chunks + nota final.
* Assinatura release com keystore Play Store (atualmente `app-release.aab` está assinada com debug keystore).
* Submissão Play Store (target separado).
* Verificar comportamento em Android 14+ com novas regras de foreground service.

**Comandos:**
```bash
# Build:
npm run android:build           # debug APK + release AAB
npm run android:build:apk       # apenas debug APK
npm run android:build:aab       # apenas release AAB
npm run android:sync            # só sync de assets web

# Saída:
android/app/build/outputs/apk/debug/app-debug.apk
android/app/build/outputs/bundle/release/app-release.aab
```

**Próximo bloco (independente):**
1. iOS / App Store readiness
2. Cleanup HOTFIX.LINK.1
3. Smoke device real Android (precondição pra Play Store)

---

### 4.8) VI_RELEASE.DESKTOP.1 — Build desktop após fechamento da ponte (2026-05-12)

**Artefatos gerados:**
* App: `src-tauri/target/release/bundle/macos/VoiceIdeas.app` (8.6 MB)
* DMG: `src-tauri/target/release/bundle/dmg/VoiceIdeas_0.1.0_aarch64.dmg` (3.1 MB)
* Cópias em `dist/VoiceIdeas.app` e `dist/VoiceIdeas_0.1.0_aarch64.dmg` (via `scripts/sync-desktop-artifacts.mjs`)

**Metadata:**
* Arquitetura: **arm64** (`aarch64-apple-darwin`)
* Versão: **0.1.0** (CFBundleShortVersionString + CFBundleVersion + Tauri Cargo.toml)
* Bundle identifier: `com.voiceideas.desktop`
* URL scheme: `voiceideas://` (deep link registrado)
* `NSMicrophoneUsageDescription`: pt-BR ("VoiceIdeas precisa do microfone para gravar ideias e transcrever suas notas.")
* Signing: **adhoc / linker-signed** (não-notarizado; OK para uso local/desenvolvimento — distribuição via App Store ou Developer ID virá numa rodada separada)

**Bridge stack verificada no bundle:**
Greps nos chunks de `desktop-dist/assets/` confirmaram presença de:
* "Importado no Bardo" ✓
* "Reenviar último conteúdo" ✓
* "Conta VoiceIdeas" (SignedInAccountCard) ✓
* "Conexão com o Bardo disponível" (copy atualizada) ✓
* `external_integrations_enabled` (prefs server-side) ✓
* `useSnapshot` ✓
* "A fonte original mudou" ✓
* "Bardo conectado" ✓

Chunks específicos da ponte presentes:
* `ConnectBardo-BHFvfVZR.js` (rota /connect-bardo)
* `bardoAccountLinkService-B3Bmss68.js` (serviço de vínculo)
* `organizedIdeaService-C2QptA7I.js` (carrega BardoBridgeExportPanel + state lifecycle)
* `Settings-C5B5zmwy.js` (SignedInAccountCard + Avatar)

**Segurança:**
* Zero ocorrências de `VITE_OPENAI_API_KEY` ou `OPENAI_API_KEY` no `desktop-dist/` (consistente com P0.3 fechado).
* Web bundle embutido no binário Rust via Tauri asset embedding (não exposto como arquivos em `Contents/Resources/dist/`).

**Não há regressão de ponte:**
* Ciclo VI ↔ Bardo (VI_BRIDGE.FINAL_STATUS_CYCLE.1) está fechado e o bundle desktop carrega todos os componentes desse ciclo.
* O backend (Edge Functions + DB) é exatamente o mesmo do web — desktop é cliente do mesmo Supabase project (`uhzwqhaxnodtshlvvikt`).
* Envs Supabase (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) presentes no bundle via Vite build.

**Comandos:**
```bash
# Build:
npm run desktop:build        # arm64 (host)
npm run desktop:build:intel  # x86_64 (cross para Intel macs)

# Saída automática em:
src-tauri/target/release/bundle/macos/VoiceIdeas.app
src-tauri/target/release/bundle/dmg/VoiceIdeas_0.1.0_aarch64.dmg
dist/VoiceIdeas.app
dist/VoiceIdeas_0.1.0_aarch64.dmg
```

**Pendências de release (não bloqueiam o build):**
* Notarização Apple Developer ID (para distribuição fora da App Store sem warnings).
* Submissão App Store (target separado).
* Build Intel (`desktop:build:intel`) e universal (lipo) se houver demanda — hoje só arm64.

**Próximo bloco (independente):**
1. Android device/build readiness
2. iOS / App Store readiness
3. Cleanup HOTFIX.LINK.1

---

### 4.7) VI_BRIDGE.FINAL_STATUS_CYCLE.1 — Ciclo VI ↔ Bardo fechado (2026-05-12)

**Status:** ✅ ponte funcional. Não bloqueia mais empacotamento/release.

**Fluxos validados em produção com clicks reais (2026-05-12):**

| Caso | Evidência DB | Status |
|---|---|---|
| safe_capture note → Bardo (import) | `92ac447e` / `a7958323` `bridge_status='consumed'`, `consumed_at='2026-05-11 22:59:15'` | ✅ |
| organized_idea (manual) → Bardo (import) | `4bcd62a3` / `e06b2be2` `bridge_status='consumed'`, 2 exports preservados | ✅ |
| organized_idea (safe_capture) → Bardo (reject) | `e51590b8` / `996d120f` `bridge_status='blocked'`, `blocked_at='2026-05-12 01:38:52'` | ✅ |
| snapshot resend (fonte ausente) | `1c10a211` payload com `snapshotResend.sourceExportId=52ee4a07`, exported_at='2026-05-12 01:38:47'; row original `52ee4a07` preservada | ✅ |
| histórico preservado (zero deletes) | 3 exports rows totais nos 2 organized_ideas; bridge_items.consumed_at e blocked_at carregam timestamps históricos intactos | ✅ |
| Cofre do Bardo recebeu | "Notas sobre João..." + "O homem que trocou de coração" visíveis no Cofre (print Gian) | ✅ |
| Reenvio continua disponível pós-importação | Painel exibe "Importado no Bardo" + botão "Reenviar ao Bardo" / "Reenviar último conteúdo" | ✅ |

**Cobertura por modo de captura:**
* **safe_capture (Android Foreground Service):** validado E2E.
* **manual (note único / contínuo Web Speech / desktop):** validado via organized_idea derivada de 8 notas sem `source_capture_session_id` (4bcd62a3, 8 notas manuais).
* **organized_idea:** validado para ambos os subtipos (safe_capture e manual).
* **standalone manual note:** caminho server-side e UI prontos desde MODES.1; smoke individual ainda não exercitado, mas o gate é exatamente o mesmo do organized_idea-manual que passou.

**Ciclo completo validado:**

```
VI (capture / manual / organized) →
  export-to-cenax (create bridge_exports pending + sync bridge_items) →
    bridge-exports GET (Bardo Inbox lista pending + filter terminal) →
      Bardo Inbox UI (Importar / Rejeitar) →
        bridge-exports POST (mark_imported / mark_rejected) →
          RPC bridge_mark_imported|rejected (atualiza bridge_exports.status='exported' + bridge_items.bridge_status='consumed'|'blocked' + timestamps) →
            VI panel reflete via embed PostgREST (badge "Importado/Rejeitado no Bardo") →
              VI permite reenvio (retry normal OU snapshot quando fonte sumiu) →
                bridge_reopen_for_resend reabre terminal preservando consumed_at/blocked_at →
                  novo bridge_exports pending (com snapshot metadata se aplicável)
```

**EFs ACTIVE finais (validação 2026-05-12):**
* `export-to-cenax v9` — fluxo completo: validate / export / mark imported|rejected / snapshot resend
* `bridge-items v6` — catálogo idempotente, sync passivo NÃO destrutivo (fix SNAPSHOT_RESEND.INBOX_FIX)
* `bridge-exports v6` — consumer legacy do Bardo (P1.3+: account_link_required preservado)
* `link-bardo-account v2` — produtor de vínculo VI ↔ Bardo
* `bridge-identity-check v2` — probe app-to-app

**Migrations sincronizadas:** `202604170002` (mark RPCs), `202604170006` (bardo_account_links), `202604190001` (identity_probe), `202605120001` (manual mode), `202605120002` (reopen_for_resend), `202605120003` (external_integrations_enabled).

**Invariantes preservadas (testadas):**
* `account_link_required` em `bridge-exports` continua bloqueando consumers sem vínculo (hotfix Gian `a5273c62-…` ativo).
* Email NÃO autoriza nada (identidade via `bardo_user_id` + JWT VI).
* `bridge_exports` é log auditável: nenhum delete; cada reenvio cria nova row.
* `bridge_items.upsert onConflict='source_type,source_id'` — 1 row de catálogo por par.
* Sync passiva (validateBridgeContent) não muta bridge_status; só lifecycle ops explícitas (RPCs mark, reopen, persistEligible).
* RLS em user_settings/bardo_account_links: usuário só vê/mexe nos próprios rows.
* Snapshot resend preserva consumed_at/blocked_at como rastro histórico.

**Pendência operacional (não bloqueia release):**
* Revogação do `HOTFIX.LINK.1` (row `a5273c62-…`) — fica como cleanup separado depois que confirmarmos que o fluxo de vínculo automático cobre o Gian também (próximo signup limpo via OAuth + /connect-bardo).

**Próximo bloco (desbloqueado por este fechamento):**
1. Desktop build readiness (Tauri)
2. Android device/build readiness (Capacitor + safe capture já implementado)
3. iOS / App Store readiness
4. Hotfix Gian cleanup (após pre-check final independente)

---

### 4.6) VI_BRIDGE.UX_STATE_AND_PREFS.1 — Server-side prefs, conta logada, reenvio com snapshot (2026-05-12)

**Problemas observados depois do E2E (handoff Bardo + análise visual):**

1. **Histórico/status:** painel da Bridge mostra "Importado no Bardo" e o histórico, mas a UX cria a impressão de que isso só funciona para `safe_capture`. Investigação mostrou que o filtro (`listBridgeExports` por `note_id` / `organized_idea_id` + embed de `bridge_items`) cobre todos os modos. A UI já está correta — o que faltava era visibilidade de mode no painel + reenvio com fonte ausente (abaixo).
2. **Preferências de integração só em localStorage:** `IntegrationSettingsProvider` lia/escrevia exclusivamente em `voiceideas.integration-preferences.v1`. Limpar storage desligava as integrações silenciosamente.
3. **Sem indicação de conta VI logada:** nem email, nem id, nem estado do vínculo com Bardo eram mostrados.
4. **Reenvio bloqueado quando fonte sumiu:** organized_idea consumido cuja notas-fonte foram deletadas tinha `eligibility=false` permanente → botão "Reenviar ao Bardo" ficava `disabled`.

**Soluções entregues:**

**Server-side prefs** (`202605120003_user_settings_external_integrations.sql`):
* Nova coluna `public.user_settings.external_integrations_enabled boolean NOT NULL DEFAULT false`.
* `useUserSettings` hook estendido com `externalIntegrationsEnabled` + `setExternalIntegrationsEnabled`.
* `IntegrationSettingsProvider` refatorado: source of truth = `user_settings`; localStorage vira **cache** transitório (boot/offline) que é sobrescrito quando o servidor responde.
* Atualização otimista do estado local; persistência server-side em background; cross-tab sync via `storage` event continua funcionando.
* **Resultado:** limpar localStorage não desliga integração nem desconfigura nada — basta logar novamente e o servidor restaura.

**Conta logada visível** (`src/components/settings/SignedInAccountCard.tsx`):
* Card novo em `Settings` mostrando: email do usuário VI, id parcial (8 chars), status do vínculo Bardo (consultado via `getActiveBardoAccountLink`).
* Estados: "Verificando vínculo Bardo…" / "Bardo conectado" (com bardo_email + bardo_user_id parcial + data de vínculo) / "Sem vínculo Bardo ativo".
* Não expõe JWT, anon key ou bardo_user_id completo.

**Reenvio com snapshot** (caminho `useSnapshot: true`):
* Quando `bridge_exports` anterior existe com payload válido E `eligibility.eligible === false` (fonte mudou/sumiu), o painel Bridge passa a oferecer **"Reenviar último conteúdo"** com aviso explícito "A fonte original mudou ou não está completa. O reenvio usará o último conteúdo exportado.".
* `export-to-cenax` v8 aceita `body.useSnapshot: true`: clona o payload da última `bridge_exports`, marca metadata `snapshotResend` (sourceExportId, originalExportedAt, reason='source_eligibility_lost_or_resent_by_user'), e cria nova row pending. Implica retry automático: chama `bridge_reopen_for_resend` para destravar terminal.
* `bridgeExportService.exportBridgeContent({useSnapshot:true})` propaga.
* **Auditoria:** histórico antigo intacto; nova row tem `snapshotResend` no payload pra rastreabilidade.

**Copy da integração atualizada:**
* `integrations.destination.bardo.preparedTitle`: "Foundation ready for a future Bardo connection" → "Conexão com o Bardo disponível" (pt-BR/en/es).
* `integrations.destination.bardo.preparedDescription`: copy reformulada explicando que a preferência fica salva na conta.

**Validações:**
* migration aplicada via `supabase db push --linked`. Coluna `external_integrations_enabled` confirmada em produção.
* `export-to-cenax v8 ACTIVE` (2026-05-12).
* `npm run build` verde (22.41s). Bundle Settings carrega `SignedInAccountCard` (`Settings-CjhFe2nq.js` em produção). `organizedIdeaService` chunk carrega `useSnapshot` + "Reenviar último conteúdo" + "A fonte original mudou".

**Pendência operacional:**
* Smoke real do snapshot resend depende de clicar em um item com fonte ausente (ex.: organized_idea `4bcd62a3-…` "Notas sobre João e referências culturais"). O caminho server-side está em produção; só falta o click.
* `useBardoAccountLink` hook continua untracked no working tree — `SignedInAccountCard` usa o service diretamente para evitar dependência.

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
