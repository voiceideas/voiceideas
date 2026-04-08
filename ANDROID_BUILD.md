# Android Build

Esta base do VoiceIdeas usa **Capacitor + Android nativo**.

O objetivo no Android nao e reimplementar o produto, e sim empacotar o que ja
funciona no fluxo principal:

- captura segura
- segmentacao no backend
- transcricao no backend
- notas automaticas com `Fazer magica`

## O que precisa estar instalado

- Java 21 ou superior
- Android Studio
- Android SDK
- `adb` no `PATH`

## Comandos principais

Se o projeto ainda nao tiver a pasta `android/`:

```bash
npm install @capacitor/android
npx cap add android
```

No dia a dia:

```bash
npm run build
npx cap sync android
npx cap open android
```

Ou usando os scripts do projeto:

```bash
npm run android:sync
npm run android:open
npm run android:build
```

## Decisoes importantes do app no Android

- O caminho principal do Android e **captura de audio bruto + pipeline server**.
- Nao dependemos de STT local para o fluxo principal.
- A captura segura e tratada como **foreground-first** no app instalado.
- Durante a gravacao, o app usa `@capacitor-community/keep-awake` para manter a
  tela ativa e reduzir interrupcoes por sleep.

## Permissoes nativas esperadas

No `AndroidManifest.xml`:

- `android.permission.RECORD_AUDIO`
- `android.permission.MODIFY_AUDIO_SETTINGS`
- `android.permission.WAKE_LOCK`
- `android.permission.INTERNET`

## Validacao real minima

Android so deve ser considerado pronto quando passar em aparelho real:

1. gravar um audio de 30 a 60 segundos
2. acionar `Fazer magica`
3. confirmar:
   - chunks criados
   - notas criadas
   - agrupamento inicial quando houver material
   - zero falha evitavel de captura

## Build de distribuicao

O script atual gera os artefatos Android via Gradle:

```bash
npm run android:build
```

Depois, no Android Studio:

- `Build > Generate Signed Bundle / APK`

Preferir `.aab` para distribuicao na Play Store.

## Observacoes

- O identificador atual do app e `com.voiceideas.mobile`.
- O fluxo principal do VoiceIdeas continua independente de Bardo e de outras
  integracoes externas.
- Antes de publicar, validar em multiplos devices Android reais, incluindo pelo
  menos um aparelho mais fraco.
