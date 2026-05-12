# VoiceIdeas 0.1.0 — Release Notes

**Snapshot:** 2026-05-12
**Tag:** `v0.1.0`
**Status:** local release snapshot fechado. App Store / Play Store / TestFlight ficam para próximos blocos (dependem de Apple Developer pago, keystore Play Store dedicada e notarização Apple).

---

## Resumo

Primeira release formal do VoiceIdeas após:
- ciclo completo VI ↔ Bardo (ponte bidirecional com status retorno);
- build verde nas 4 plataformas (web, desktop macOS arm64+Intel, Android, iPad);
- i18n principal revisado em 3 locales com paridade total;
- working tree limpo, audit verde, build verde.

---

## 1. Ponte VI ↔ Bardo (canônica)

A ponte é o caminho operacional canônico de saída do VoiceIdeas para o Bardo. Substitui o caminho legado (`SendToBardoModal`, `owner_email` + `content_hash`), que continua presente no código mas marcado como **LEGACY BRIDGE PATH NÃO está montado** em Notes/Organized.

### Fluxo

1. **Account linking explícito** (`/connect-bardo`) — VoiceIdeas e Bardo trocam o identificador opaco `bardo_user_id` via edge function `link-bardo-account`. Persiste em `bardo_account_links` com `link_status='active'`. Email do Bardo é apenas auditoria — não autoriza nada. A própria existência do vínculo ativo é o que autoriza envios.
2. **Export** — `export-to-cenax` recebe o payload da nota / ideia organizada, valida elegibilidade server-side em `validateBridgeContent`, escreve em `bridge_exports` (log) e `bridge_items` (catálogo). O contrato físico:
   - `imported` → `bridge_exports.status='exported'` + `bridge_items.bridge_status='consumed'`
   - `rejected` → `bridge_exports.status='exported'` + `bridge_items.bridge_status='blocked'`
   - `pending`  → `bridge_exports.status='pending'` (item ainda na fila do Bardo)
   - `failed`   → `bridge_exports.status='failed'`
3. **Modos suportados** — `manual`, `continuous`, `safe_capture` (foreground service Android) para nota; `organized_idea` para ideia. Server decide por-modo se aceita.
4. **Status return** — `BardoBridgeExportPanel` deriva `BardoLifecycle` (`never_sent | pending | imported | rejected | failed | exported_unknown`) e mostra na UI badges + ações apropriadas.
5. **Snapshot resend** — quando item está em estado terminal (`imported`/`rejected`) e a fonte original mudou ou foi apagada, o botão **"Reenviar último conteúdo"** clona o `latestExport.payload` e adiciona metadata `snapshotResend: {sourceExportId, originalExportedAt, reason}`. RPC `bridge_reopen_for_resend` reabre o `bridge_item` preservando `consumed_at`/`blocked_at` (histórico).
6. **Retry** — para `failed`, o botão **"Tentar enviar de novo"** chama o mesmo `export-to-cenax` com `retry=true`, re-resolvendo a fonte.

### Componentes principais

- `src/components/BardoBridgeExportPanel.tsx` — orquestrador (status, badges, retry, snapshot resend)
- `src/components/IdeaBridgeExportButton.tsx` — botão de envio + status label
- `src/components/BardoConnectionToggle.tsx` — toggle de conexão em Settings (chama `link-bardo-account`, persiste `user_settings.bardo_bridge_enabled`)
- `src/components/settings/SignedInAccountCard.tsx` — exibe identidade VI + status do vínculo Bardo

### Edge functions ativas (Supabase `uhzwqhaxnodtshlvvikt`)

| Slug | Versão | Função |
|---|---|---|
| `bridge-items` | 6 | catálogo autenticado de items prontos para a ponte |
| `export-to-cenax` | 9 | exportação canônica VI→Bardo (suporta normal/retry/snapshot) |
| `bridge-exports` | 6 | log de exportações |
| `link-bardo-account` | 2 | account linking explícito (`bardo_account_links`) |
| `bridge-identity-check` | 2 | identity check com request IDs + sha256 digest visual + mask email |
| `accept-idea-invite` | 10 | aceitar convite de ideia compartilhada |
| `preview-idea-invite` | 5 | preview de convite |
| `share-idea` | 11 | gerar convite |
| `list-shared-ideas` | 9 | listar ideias compartilhadas |
| `transcribe`, `transcribe-chunk` | 10, 6 | pipeline de transcrição |
| `segment-audio-session` | 16 | segmentação automática |
| `materialize-idea` | 5 | materializar ideia organizada |
| `ingest-capture-session` | 4 | ingestão de sessão de captura |
| `delete-capture-session`, `delete-audio-chunk` | 5, 5 | deleção em cascata |
| `organize` | 12 | organização via IA |

---

## 2. Plataformas (versão 0.1.0)

| Plataforma | Estado | Artefato |
|---|---|---|
| **Web (Vercel)** | ✅ deployado | `voiceideas.vercel.app` (deploy via `docker:deploy`) |
| **Desktop macOS arm64** | ✅ buildado | `Distribuicao-Final/VoiceIdeas-macOS-AppleSilicon.dmg` (3.0 MB) + `src-tauri/target/release/bundle/macos/VoiceIdeas.app` |
| **Desktop macOS Intel** | ✅ buildado | `Distribuicao-Final/VoiceIdeas-macOS-Intel.dmg` (3.1 MB) |
| **Android (arm64)** | ✅ instalado + validado no device | `Distribuicao-Final/VoiceIdeas-Android-arm64.apk` (3.3 MB debug) + `Distribuicao-Final/VoiceIdeas-Android-arm64.aab` (3.1 MB release bundle) + `android/app/build/outputs/bundle/release/app-release.aab` |
| **iPad (Personal Team / Apple ID free)** | ✅ instalado + lançado | install via `xcrun devicectl device install app` + launch via `xcrun devicectl device process launch`. Confirmado visualmente por Gian: "o app está rodando e funcionando". |

**Alinhamento de versão (todas as 5 surfaces apontam para 0.1.0):**

- `package.json` → `"version": "0.1.0"`
- `src-tauri/tauri.conf.json` → `"version": "0.1.0"`
- `src-tauri/Cargo.toml` → `version = "0.1.0"`
- `android/app/build.gradle` → `versionName "0.1.0"`, `versionCode 2`
- `ios/App/App.xcodeproj/project.pbxproj` → `MARKETING_VERSION = 0.1.0`, `CURRENT_PROJECT_VERSION = 2`

---

## 3. i18n — 3 locales completos

Três blocos de message catalog em `src/lib/i18nMessages.ts`, paridade total `pt-BR` / `en` / `es` = **655 chaves cada**.

### Trajetória

- **VI_I18N.SWEEP.1A_1D** (commit `a665500`): completou locale `es` (era 103 explícitas + spread silencioso). 364 entradas auto-traduzidas via script PT→ES com sentinels contra cascades; ~50 hard-overrides para casos complexos; 10 entradas pré-existentes corrigidas (`Ouvindo`, `Pronto`, `edição`, `fim`, `pausa curta`, etc.).
- **VI_I18N.SWEEP.1B** (commit `eb98926`): extraiu hardcoded das telas principais (96 chaves novas × 3 locales). Refatorou `NoteCard`, `OrganizedView`, `IdeaBridgeExportButton`, `BardoBridgeExportPanel`, `AcceptInvite`, `ShareIdeaModal`, `CaptureQueue` (top-level), `i18nMessages`.
- **VI_I18N.SWEEP.1C** (commit `20e7b12`): sweep residual/admin/deep UI (81 chaves novas × 3 locales). Refatorou `CaptureQueue` deep operational, `IdeaDrafts`, `Admin`, `BardoConnectionToggle`, `VoiceSegmentationSettings`, `SignedInAccountCard`. `toLocaleDateString('pt-BR')` substituído por `formatDate` do hook (responde ao locale).
- **VI_I18N.SMOKE.1** (commit `ddd1f40`): smoke visual por idioma exposto leaks do backend supabase + 13 strings PT hardcoded em `AcceptInvite` / `ShareIdeaModal`. Corrigido com locale-aware suppression (em `locale !== 'pt-BR'` usa fallback i18n; em pt-BR retém especificidade do server).

### Audit script

`scripts/audit-i18n.mjs` + `npm run audit:i18n`:
- parsa os 3 blocos via regex robusta (aceita `Record<string,...>` E `Record<TranslationKey,...>`)
- **FAIL (exit 1)**: `missing-keys`, `extra-keys`, `spread-fallback`, `pt-residual` (heurística com whitelist)
- **WARN (exit 0)**: `identical-to-pt` (PT e ES compartilham vocabulário legitimamente: "Captura segura", "Markdown copiado", "Cancelar", "ajuste automático", etc.)
- Output JSON estruturado para CI.

### Resultado smoke

| Surface | pt-BR | en | es |
|---|---|---|---|
| `/auth` | ✅ | ✅ | ✅ |
| `/accept-invite` (com erro backend) | ✅ (mostra mensagem específica do server) | ✅ (suprime leak, mostra fallback i18n) | ✅ (suprime leak, mostra fallback i18n) |
| `/connect-bardo` | ✅ | ✅ | ✅ |

---

## 4. Outras mudanças relevantes

- **`scripts/sync-mobile-icons.mjs`** — ícones Android com safe-area de 66% (Material Design adaptive icon spec) via ffmpeg; fallback para sips se ffmpeg indisponível. Resolveu o problema do ícone "zoom-in" cortado pela máscara do sistema.
- **`useUserSettings.ts`** — fix boot race: `fetchSettings` agora reativo ao `useAuth().user` (refetch on auth change). Antes rodava só no mount com `deps=[]` quando `user` ainda era null.
- **`UserAvatar.tsx`** (novo) — avatar com `user_metadata.avatar_url`/`picture`, fallback para iniciais (2 primeiras letras), `onError` → graceful fallback, `referrerPolicy="no-referrer"`.
- **`Layout.tsx`** — header limpo (avatar + ícones de Settings/Logout). Email + nome movidos para `SignedInAccountCard` em Settings após iterações de UX com Gian.
- **Hotfix Gian revogado** — entry manual em `bardo_account_links` foi revogada preservando histórico (não deletada).

---

## 5. Limitações conhecidas

### App Store / TestFlight (iOS)
- Bloqueados até conta Apple Developer paga (US$99/ano). Atualmente Personal Team / Apple ID free.
- Certificado dura 7 dias — depois precisa rebuild + reinstall via `xcrun devicectl`.

### Google Play (Android)
- Precisa keystore dedicado (não o debug keystore atual).
- Lock-screen long capture ainda exige foreground service refinado para sobreviver Doze mode em sessões muito longas.

### macOS fora App Store
- Precisa notarização Apple para distribuição sem warning de "developer não verificado". DMG atual roda mas com prompt.

### i18n residual (opcional, deferred)
Não bloqueia tag 0.1.0. Total ~25 strings PT residuais em 3 categorias:

1. **Hook-level fallback strings** (~13 ocorrências, fired apenas quando `err.message` vazio):
   - `useSpeechRecognition.ts` (2)
   - `useAudioTranscription.ts` (5)
   - `useCaptureSession.ts` (1)
   - `useCaptureQueue.ts` (1)
   - `useMobileAudioCapture.ts` (2)
   - `useIdeaDrafts.ts` (1)
   - `useBridgeExport.ts` (1)
   - `AudioPlayer.tsx` (1)

2. **`src/utils/captureQueueErrorMessage.ts`** (~12 mensagens) — centralizador de erros de fila. Refactor exige passar `t()` como arg ou usar `useI18n` no consumer.

3. **Supabase edge functions** — mensagens em pt-BR fixas em `preview-idea-invite`, `accept-idea-invite`. Fora de escopo do refactor frontend. UI já suprime via locale-aware fallback nos componentes que renderizam essas mensagens (`AcceptInvite`, `ShareIdeaModal`).

Plano para fase futura (VI_I18N.SWEEP.1D ou similar): hooks aceitam `t` opcional via config OU usar context; `captureQueueErrorMessage` evolui para `(context, error, t) => string`; backend pode receber locale como header e responder localizado (escopo separado, envolve mudar edge functions).

---

## 6. Validações finais

- ✅ `git status --short` vazio (working tree limpo)
- ✅ `npm run audit:i18n` — paridade 655/655/655, sem spread, sem PT residual heurístico
- ✅ `npm run build:web` — verde (tsc + vite)
- ✅ `npx supabase migration list --linked` — 27 migrations alinhadas Local/Remote/Time
- ✅ `npx supabase functions list` — 17 functions ACTIVE
- ✅ Alinhamento de versão 0.1.0 em 5 surfaces (package.json / Tauri conf / Cargo / Android / iOS)
- ✅ Artefatos físicos confirmados em `Distribuicao-Final/` + `src-tauri/target/release/bundle/macos/` + `android/app/build/outputs/bundle/release/`

---

## 7. Comandos para reproduzir

```bash
# Web build
npm run build:web

# Audit i18n
npm run audit:i18n

# Desktop macOS (arm64)
npm run desktop:build

# Desktop macOS (Intel)
npm run desktop:build:intel

# Android debug APK
npm run android:build:apk

# Android release AAB
npm run android:build:aab

# iOS
npm run ios:sync && npm run ios:open

# Deploy web (via docker container, único caminho autorizado)
npm run docker:deploy
```

---

## 8. Próximos blocos sugeridos

- **App Store / TestFlight** quando Apple Developer paga estiver ativo.
- **Google Play** com keystore dedicado + refinamento do foreground service.
- **macOS notarization** para distribuição sem warnings.
- **VI_I18N.SWEEP.1D (opcional)** — limpar os ~25 residuais em hooks/utils/server-leaks.
- **Bardo bridge expansão** — métricas de sucesso/falha, retry exponencial, observabilidade no Inbox.
- **Bardo handoff doc** — manter `Bardo handoff/` atualizado a cada cut de versão.

---

*Snapshot fechado por Claude (operador técnico) sob orientação de Gian (product owner).*
