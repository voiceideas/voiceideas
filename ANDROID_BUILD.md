# Android Build

Esta base do VoiceIdeas foi preparada para gerar um app Android via Tauri 2.

## O que precisa estar instalado

- Java 17 ou superior
- Android Studio
- Android SDK
- `adb` no `PATH`
- Rust targets Android

## Comandos principais

```bash
npm run android:init
npm run android:dev
npm run android:build
```

## Comandos que funcionaram neste Mac

Depois do `android:init`, os artefatos arm64 foram gerados com:

```bash
env JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
  ANDROID_HOME="$HOME/Library/Android/sdk" \
  ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
  PATH="/opt/homebrew/opt/openjdk@21/bin:/opt/homebrew/bin:$HOME/Library/Android/sdk/platform-tools:$PATH" \
  npx @tauri-apps/cli@latest android build --apk --split-per-abi --target aarch64 -v

env JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
  ANDROID_HOME="$HOME/Library/Android/sdk" \
  ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
  PATH="/opt/homebrew/opt/openjdk@21/bin:/opt/homebrew/bin:$HOME/Library/Android/sdk/platform-tools:$PATH" \
  bash src-tauri/gen/android/gradlew --project-dir src-tauri/gen/android \
  :app:assembleArm64Release --no-daemon -x :app:rustBuildArm64Release

env JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
  ANDROID_HOME="$HOME/Library/Android/sdk" \
  ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
  PATH="/opt/homebrew/opt/openjdk@21/bin:/opt/homebrew/bin:$HOME/Library/Android/sdk/platform-tools:$PATH" \
  bash src-tauri/gen/android/gradlew --project-dir src-tauri/gen/android \
  :app:bundleArm64Release --no-daemon -x :app:rustBuildArm64Release
```

## Artefatos gerados

- APK arm64: [app-arm64-release-unsigned.apk](/Users/capitolio/Documents/New%20project/voice-ideas-macos/src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk)
- AAB arm64: [app-arm64-release.aab](/Users/capitolio/Documents/New%20project/voice-ideas-macos/src-tauri/gen/android/app/build/outputs/bundle/arm64Release/app-arm64-release.aab)

## Observacoes

- O Android usa o identificador `com.voiceideas.mobile` em [src-tauri/tauri.android.conf.json](/Users/capitolio/Documents/New%20project/voice-ideas-macos/src-tauri/tauri.android.conf.json).
- O projeto desktop continua com o identificador `com.voiceideas.desktop` em [src-tauri/tauri.conf.json](/Users/capitolio/Documents/New%20project/voice-ideas-macos/src-tauri/tauri.conf.json).
- O `APK` gerado em `release` ficou `unsigned`, entao ele ainda precisa ser assinado para distribuicao direta fora da Play Store.
- Para login por deep link no app Android, o Supabase tambem deve permitir `voiceideas://auth` nas Redirect URLs.
