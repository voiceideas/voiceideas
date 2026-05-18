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

### 5.1 Bump de versão — fluxo automatizado (recomendado)

A partir de `VI_VERSION_BUMP_AUTOMATION` (2026-05-18) existe um script
único que sincroniza os 5 arquivos com drift check antes/depois.

```bash
# Versão explícita
$ npm run version:bump 0.2.0

# OU bump semver relativo (a partir da versão atual)
$ npm run version:bump -- --patch    # 0.1.0 → 0.1.1
$ npm run version:bump -- --minor    # 0.1.0 → 0.2.0
$ npm run version:bump -- --major    # 0.1.0 → 1.0.0

# Com commit automático
$ npm run version:bump -- --minor --commit

# Com stub de chronicle apendado
$ npm run version:bump -- --minor --commit --chronicle

# Override do versionCode Android (default: atual+1)
$ npm run version:bump 0.2.0 -- --android-version-code 10

# Permitir downgrade (uso raro, ex: rollback)
$ npm run version:bump 0.0.9 -- --force-downgrade
```

**O que o script garante:**

1. **Drift check ANTES do bump.** Se os 5 arquivos não estiverem em
   sincronia, o script falha com mensagem clara listando qual arquivo
   está fora. Não corrige drift silenciosamente — exige correção manual
   antes.
2. **Aplica mudança nos 5 arquivos** (+ package-lock.json se existir).
3. **Drift check DEPOIS do bump.** Sanity para garantir consistência
   após a operação.
4. **Imprime resumo humano** (version antes → depois, versionCode
   antes → depois, CURRENT_PROJECT_VERSION antes → depois, lista de
   arquivos alterados).
5. **NUNCA cria git tag** (tagging segue manual e ordenado, ver §5.4).
6. **NUNCA usa `git add -A`** — lista arquivos explicitamente quando
   `--commit` for usado.
7. **Recusa downgrade** sem `--force-downgrade`.
8. **Recusa target version igual à atual** (sem op-no-op silencioso).

**Smoke:**

```bash
$ npm run smoke:version-bump   # 14 cenários, valida tudo
```

### 5.2 Bump manual — fallback documentado

Use APENAS se o script falhar por motivo não-óbvio (ex: arquivo em
estado anômalo). Em circunstâncias normais, prefira `npm run version:bump`.

```bash
# 1. Atualizar package.json (manual, edite o campo "version")
$ vim package.json   # version: "0.1.0" → "0.2.0"

# 2. Sincronizar package-lock.json (top-level + packages[""])
$ vim package-lock.json

# 3. Sincronizar Tauri
$ vim src-tauri/tauri.conf.json    # "version": "0.2.0"
$ vim src-tauri/Cargo.toml         # version = "0.2.0"

# 4. Sincronizar Android
$ vim android/app/build.gradle
#    versionCode N+1   ← bump +1 SEMPRE
#    versionName "0.2.0"

# 5. Sincronizar iOS (via Xcode UI ou editor direto)
$ vim ios/App/App.xcodeproj/project.pbxproj
#    substituir TODAS as ocorrências de MARKETING_VERSION = X.Y.Z;
#    substituir TODAS as ocorrências de CURRENT_PROJECT_VERSION = N;

# 6. Verificar todos sincronizados
$ grep -h "version" package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml | head
$ grep -E "versionName|versionCode" android/app/build.gradle
$ grep -E "MARKETING_VERSION|CURRENT_PROJECT_VERSION" ios/App/App.xcodeproj/project.pbxproj
```

### 5.3 Verificar antes de publicar

```bash
$ npx tsc -b
$ npm run build
$ npm run smoke:capture-engine
$ npm run smoke:web-manual-engine
$ npm run smoke:capture-engine-feature-flag
$ npm run smoke:version-bump          # valida que o script de bump continua íntegro
```

### 5.4 Build artefatos

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

### 5.5 Tag e push

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
