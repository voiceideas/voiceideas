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

## Observacoes

- O Android usa o identificador `com.voiceideas.app` em [src-tauri/tauri.android.conf.json](/Users/capitolio/Documents/New%20project/voice-ideas-macos/src-tauri/tauri.android.conf.json).
- O projeto desktop continua com o identificador `com.voiceideas.desktop` em [src-tauri/tauri.conf.json](/Users/capitolio/Documents/New%20project/voice-ideas-macos/src-tauri/tauri.conf.json).
- Para login por deep link no app Android, o Supabase tambem deve permitir `voiceideas://auth` nas Redirect URLs.
