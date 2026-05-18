# Release Versioning — VoiceIdeas

> Processo de bump de versão. Fonte primária: `package.json`.
>
> Ordem: `VI_VERSION_VISIBILITY_STANDARD` (2026-05-18, chronicle 4.73).

---

## 1. Fonte primária

**`package.json` → `version`** é a única fonte de verdade da versão
semver do produto. Todos os outros arquivos que carregam versão
**replicam** esse valor. Mudou aqui, atualizar nos lugares listados
abaixo.

```bash
# Versão atual
node -p "require('./package.json').version"
```

## 2. Onde a versão precisa estar sincronizada

| Arquivo | Campo | Quando atualizar |
|---|---|---|
| `package.json` | `version` | **PRIMÁRIA** — bump aqui primeiro |
| `src-tauri/tauri.conf.json` | `version` | release com mudança visível no app desktop |
| `src-tauri/Cargo.toml` | `[package].version` | release com mudança visível no app desktop |
| `android/app/build.gradle` | `versionName` + bump `versionCode` | release com mudança no APK/AAB |
| `ios/App/App.xcodeproj` MARKETING_VERSION | via Xcode UI ou xcconfig | release com mudança no IPA |

**Atenção:** o `versionCode` do Android é INTEIRO MONOTÔNICO — sempre
incrementa em +1 a cada release publicada (Google Play exige). NÃO é
semver.

## 3. Padrão semver simplificado

VoiceIdeas usa semver flexível: `MAJOR.MINOR.PATCH`.

| Tipo | Quando bumpar | Exemplo |
|---|---|---|
| `PATCH` | bug fix, copy fix, melhorias internas sem impacto user | `0.1.0` → `0.1.1` |
| `MINOR` | nova feature visível, mudança de fluxo sem quebrar fluxo antigo | `0.1.0` → `0.2.0` |
| `MAJOR` | mudança disruptiva no produto, breaking change na superfície | `0.1.0` → `1.0.0` |

Pré-`1.0.0` (estado atual em 2026-05-18): MINOR pode quebrar coisas se
documentado na chronicle. Após `1.0.0`, regra rígida.

## 4. Onde a versão é exibida ao usuário

| Lugar | Componente | Fonte runtime |
|---|---|---|
| Settings → "Sobre o VoiceIdeas" | `src/components/settings/AboutCard.tsx` | `src/lib/appVersion.ts` |
| macOS menu nativo "Sobre o VoiceIdeas" | configurado em `src-tauri/src/lib.rs` | `env!("CARGO_PKG_VERSION")` (lê do `Cargo.toml`) |
| iOS Settings nativo (Info.plist auto) | Xcode MARKETING_VERSION via Capacitor sync | n/a (loja) |
| Android "About" do sistema | `versionName` no build.gradle | n/a (loja) |

**Em runtime:** o `appVersion.ts` helper lê de `import.meta.env.APP_VERSION`
que é injetado pelo Vite no build time a partir do `package.json`. Plus
`APP_COMMIT` (git short hash) e `APP_CHANNEL` (mode).

## 5. Procedimento de release (resumo)

### 5.1 Bump de versão

```bash
# 1. Atualizar package.json (manual, edite o campo "version")
#    OU usar npm version (cuidado: cria tag git automaticamente)
$ vim package.json   # version: "0.1.0" → "0.2.0"

# 2. Sincronizar Tauri
$ vim src-tauri/tauri.conf.json    # "version": "0.2.0"
$ vim src-tauri/Cargo.toml         # version = "0.2.0"

# 3. Sincronizar Android
$ vim android/app/build.gradle
#    versionCode 3   ← bump +1 SEMPRE
#    versionName "0.2.0"

# 4. Sincronizar iOS (via Xcode UI)
#    Xcode → App target → General → Identity → Version + Build
#    OU editar ios/App/App.xcodeproj/project.pbxproj diretamente

# 5. Verificar todos sincronizados
$ grep -h "version" package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml | head
$ grep -E "versionName|versionCode" android/app/build.gradle
```

### 5.2 Verificar antes de publicar

```bash
$ npx tsc -b
$ npm run build
$ npm run smoke:capture-engine
$ npm run smoke:web-manual-engine
$ npm run smoke:capture-engine-feature-flag
```

### 5.3 Build artefatos

```bash
# Web (Vercel auto-deploy via push)
$ git push origin main

# Desktop macOS (Apple Silicon)
$ npm run desktop:build
# → src-tauri/target/release/bundle/dmg/VoiceIdeas_<version>_aarch64.dmg

# Desktop macOS (Intel, opcional)
$ npm run desktop:build:intel

# iOS (precisa device pareado ou simulator)
$ npm run ios:sync
$ cd ios/App && xcodebuild ... build

# Android (debug APK)
$ JAVA_HOME=$(/usr/libexec/java_home -v 21) ANDROID_HOME=~/Library/Android/sdk \
  npm run android:build:apk
# → android/app/build/outputs/apk/debug/app-debug.apk

# Android release (AAB para Play Store, exige signing keystore)
$ npm run android:build:aab
```

### 5.4 Tag e push

```bash
$ git add -A
$ git commit -m "chore(release): bump 0.1.0 → 0.2.0"
$ git tag v0.2.0
$ git push origin main --tags
```

**⚠️ Tag `v0.1.0` está congelada por design (snapshot técnico inicial).
NÃO mover esta tag.** Para releases novas, criar tags incrementais.

## 6. Channels

Build pode rodar em diferentes "channels" via env var:

```bash
# Channel customizado (ex: staging)
$ VITE_APP_CHANNEL=staging npm run build

# Default: usa o mode do Vite (production em build, development em dev)
$ npm run build           # channel = 'production'
$ npm run dev             # channel = 'development'
```

UI exibe o channel no card "Sobre" em Settings. Útil para QA distinguir
build staging do build de produção em testes lado-a-lado.

## 7. Commits e auditoria

O `APP_COMMIT` injetado no bundle é obtido em build time via
`git rev-parse --short HEAD`. Cada build do Vite carrega o hash do
commit ativo no checkout — útil para suporte ("qual commit está
rodando nesse iPad?").

Fallback: se o build acontecer em ambiente sem `git` no PATH ou sem
checkout completo (CI minimal), o commit fica `'unknown'` sem quebrar.

## 8. Onde o helper é consumido

* `src/lib/appVersion.ts` (helper)
* `src/components/settings/AboutCard.tsx` (UI)

Qualquer outra UI que queira mostrar versão deve **importar** do helper.
Hardcode de versão em outros lugares (componentes, edge functions de
debug) é proibido por convenção — pull request será rejeitado se
introduzir.

## 9. Próximo bump (sugestão prática)

Quando você quiser sair do `0.1.0`:

* Bumpar para `0.2.0` faz sentido após qualquer release com nova
  feature consolidada (ex: VI_LGPD_DELETE_ACCOUNT entrega em 4.72).
* Tag `v0.1.0` permanece intocada (per ordem original — snapshot
  histórico).
* Crônicas futuras podem referenciar a nova versão ativa.

Mantenha o intervalo entre versões coerente — não bumpar a cada commit,
não esperar 6 meses entre bumps.
