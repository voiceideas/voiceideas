# VoiceIdeas Android Secure Capture Runbook

## 1) Objetivo
Documentar a camada Android nativa de captura segura para que outro time consiga manter, depurar e evoluir sem regressao arquitetural.

## 2) Estado atual (fundacao existente)
- Foreground Service de microfone implementado (`CaptureForegroundService`).
- Plugin Capacitor dedicado (`SecureCapturePlugin`) implementado e registrado no `MainActivity`.
- Persistencia local real de sessao/chunks em storage privado do app.
- Manifesto local JSON por sessao.
- Chunking real em WAV (AudioRecord + rotacao por tamanho/duracao alvo).
- Recuperacao honesta ao reabrir app (sem continuidade falsa).

## 3) Arquivos principais

### 3.1 AndroidManifest
Arquivo: `android/app/src/main/AndroidManifest.xml`
- Service declarado:
- `.capture.CaptureForegroundService`
- `android:foregroundServiceType="microphone"`
- Permissoes:
- `RECORD_AUDIO`
- `FOREGROUND_SERVICE`
- `FOREGROUND_SERVICE_MICROPHONE`

### 3.2 Registro do plugin
Arquivo: `android/app/src/main/java/com/voiceideas/mobile/MainActivity.java`
- `registerPlugin(SecureCapturePlugin.class)`

### 3.3 Plugin Capacitor
Arquivo: `android/app/src/main/java/com/voiceideas/mobile/capture/SecureCapturePlugin.kt`
- Metodos expostos:
- `startCapture`
- `stopCapture`
- `getCaptureStatus`
- `getCaptureDiagnostics`
- Eventos para JS:
- `secureCaptureEvent` com `statusChanged`

### 3.4 Service nativo
Arquivo: `android/app/src/main/java/com/voiceideas/mobile/capture/CaptureForegroundService.kt`
- Acoes:
- `ACTION_START`
- `ACTION_STOP`
- sobe foreground imediatamente
- notifica estado por notificacao persistente
- lida com restart inesperado marcando interrupcao honesta

### 3.5 Persistencia
Arquivo: `android/app/src/main/java/com/voiceideas/mobile/capture/CaptureSessionRepository.kt`
- raiz local: `<filesDir>/secure_capture_sessions`
- ponteiro de sessao ativa: `active_session.txt`
- manifesto por sessao: `manifest.json`
- chunks: `chunk-000001.wav`, `chunk-000002.wav`, ...
- output mesclado final: `capture-merged.wav`

### 3.6 Engine de audio/chunk
Arquivo: `android/app/src/main/java/com/voiceideas/mobile/capture/ChunkedAudioCaptureEngine.kt`
- backend de audio: `AudioRecord` PCM 16kHz mono 16-bit
- writer: WAV por chunk
- rotacao por limite de bytes (equivalente a ~30s por chunk)
- persistencia progressiva de elapsed/status

### 3.7 Contrato TS do plugin
Arquivo: `src/plugins/secureCapture.ts`
- estados:
- `idle|starting|recording|stopping|error`
- metodos:
- `startCapture`
- `stopCapture`
- `getCaptureStatus`
- `getCaptureDiagnostics`
- listener:
- `secureCaptureEvent`

## 4) Formato do manifesto local
Representacao baseada em `CaptureSessionManifest`:
- `sessionId`
- `mode`
- `state`
- `startedAt`
- `updatedAt`
- `elapsedMs`
- `currentOutput`
- `mergedOutput`
- `currentChunkIndex`
- `currentChunkStartedAt`
- `userId`
- `provisionalFolderName`
- `platformSource`
- `error`
- `chunks[]` com:
- `index`
- `path`
- `startedAt`
- `endedAt`
- `durationMs`

## 5) Fluxo de vida da sessao (alto nivel)
1. UI chama `SecureCapture.startCapture`.
2. Plugin inicia `CaptureForegroundService`.
3. Service cria sessao/manifesto via repository.
4. Engine inicia AudioRecord, abre chunk 1, grava e rotaciona chunks.
5. Estado e elapsed sao persistidos periodicamente.
6. UI consulta status via `getCaptureStatus` (fonte nativa/persistida).
7. `stopCapture` fecha chunk atual, concatena chunks em `capture-merged.wav`, seta estado `idle`.
8. Se processo morre no meio, ao retomar o repository marca sessao interrompida com `error` (sem continuidade inventada).

## 6) Integracao frontend
Arquivos:
- `src/hooks/mobile/useMobileAudioCapture.ts`
- `src/hooks/mobile/useMobileCaptureSession.ts`
- `src/hooks/useSafeCaptureMode.ts`

Comportamento:
- Android usa engine `android-secure-capture`.
- Estado visivel da UI de safe capture passa pelo status nativo.
- Resultado final continua entrando no pipeline do backend apos encerramento.

## 7) Como validar em hardware Android real

### 7.1 Build + sync
```bash
npm run android:sync
cd android && ./gradlew assembleDebug
```

### 7.2 Cenarios obrigatorios
1. Iniciar captura com app em foreground.
2. Bloquear tela e aguardar > 60s.
3. Desbloquear e confirmar estado ainda coerente.
4. Parar captura.
5. Verificar manifesto/chunks/merged por `getCaptureDiagnostics`.
6. Reabrir app e confirmar que status reconstruiu sem fake continuity.

### 7.3 Evidencia minima
- Sessao ativa sobreviveu ao lock screen no teste.
- `manifest.json` coerente com chunks gravados.
- `elapsedMs` plausivel.
- Sessao encerrou com estado honesto.

## 8) Limites atuais (nao esconder)
- Ainda nao ha mecanismo completo de auto-recuperacao de gravacao apos process death real em todos os cenarios.
- Sync/upload posterior ainda depende do pipeline de app/backend.
- Formato atual de chunking e WAV local (otimo para robustez, pode ser otimizado depois).

## 9) Riscos tecnicos
- Pressao de armazenamento local para sessoes longas sem limpeza.
- Concorrencia de sessao se chamadas de start/stop em sequencia rapida (hoje parcialmente mitigada).
- Necessidade de consolidar estrategia de retry/upload quando houver rede instavel.

## 10) Proxima fase recomendada (sem abrir escopo gigante)
1. consolidar politicas de limpeza de sessoes/chunks locais.
2. endurecer testes de interrupcao extrema (process death, reboot, low memory).
3. acoplar pipeline de sync robusto com marcacao de progresso por chunk.
4. adicionar telemetria operacional minima (sem PII) para falhas de captura.
