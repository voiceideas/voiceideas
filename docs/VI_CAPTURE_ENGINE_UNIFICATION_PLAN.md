# VI_CAPTURE_ENGINE_UNIFICATION — PLAN (passo 1)

**Status:** PLAN apenas — sem execução de código.
**Data:** 2026-05-15
**Origem:** entry 4.39 (VOICEIDEAS_CURRENT_STATE.md)
**Escopo deste documento:** mapear `useAudioTranscription` (Manual) e `useSafeCaptureMode` (Safe Capture), propor extração de um `CaptureEngine` comum + adapters por plataforma, listar BREAK/EXECUTE/VERIFY, riscos, e decisões pendentes que precisam input do Gian antes de codificar.

---

## 1) Análise estrutural — o que é comum vs específico

### Concerns COMUNS aos dois hooks (= candidatos a virar core do engine)

| Concern | Manual (`useAudioTranscription`) | Safe Capture (`useSafeCaptureMode`) |
|---|---|---|
| Permission management | `getUserMedia` reject → setError; Android via `CapacitorAudioRecorder.requestPermissions()` | `refreshBrowserPermissionState()` / `refreshMobilePermissionState()`; track granted/denied/prompt/unavailable |
| Platform detection | `isAudioRecordingSupported()` + `shouldPreferNativeFileCapture()` | `canUseMobileNativeAudioCapture()` + capabilities |
| Phase machine | idle/selecting/recording/transcribing | ready/recording/saving-session/saved/error |
| MediaStream lifecycle | start, stop, cleanup tracks | start, stop, cleanup tracks, recovery após interruption |
| Blob produção | downsample 16kHz + WAV encode no client (Web Audio API) | chunks via MediaRecorder OU plugin native; sem downsample |
| Error mapping | DOMException → i18n key | error states + interruptionReason |
| Retry | `canRetry` flag + manual `retry()` | `retryPendingUpload()` para sessions com upload failed |

**Conclusão:** ~60% dos concerns são comuns. Diferenças críticas: o que faz com o blob depois (transcrever-e-descarta vs upload-chunked-com-recovery), o formato bruto (WAV downsampled vs WebM/Opus/M4A), e a presença de segmentação.

### Concerns ESPECÍFICOS Manual (precisam virar profile/policy, não código diferente)

* `transcriptionTrigger = 'after_stop'` (sincronia)
* `retainAudio = false` por default → descarta blob após transcrever
* Sem `createSession` em DB hoje (mas profile pode dizer `createSession: true` no futuro, alinhando)
* Downsample 16kHz + WAV — está acoplado a otimizar payload para `transcribeAudio` edge (limite 10MB). Se Safe Capture aceitar WAV 16kHz pra suas chunks, podemos descartar essa lógica. Caso contrário, esse path fica como pré-processador opcional.

### Concerns ESPECÍFICOS Safe Capture (precisam virar profile/policy)

* `backgroundContinuation = true` → requer foreground service Android via plugin nativo
* `autoSegmentation = true` (lógica está em `useMobileCaptureSession`, não em `useSafeCaptureMode` diretamente)
* `transcriptionTrigger = 'chunk_or_session'` (assíncrono via pipeline edge `transcribe-chunk` + `segment-audio-session`)
* `retainAudio = true` (sempre); bucket `voice-captures`, path `{userId}/sessions/{sessionId}/chunks/{chunkId}.{ext}`
* Pending upload queue + recovery (`pendingCaptureUploadService`)
* `capabilities`/`availabilityState`/`interruptionReason` — surface UX rica para o usuário entender por que não está disponível

### Concerns que NÃO devem virar profile (são infra compartilhada hoje)

* `useCaptureSession` (CRUD de metadados em `capture_sessions` table) — já consumível pelos dois
* `audioChunkService` (`uploadAudioChunkFile`, `createAudioChunk`, `deleteAudioChunk`) — já abstrai bucket
* `captureSessionService` — same

---

## 2) Interface alvo proposta

### Tipos centrais

```ts
type CaptureMode = 'manual' | 'safe_capture'

type TranscriptionTrigger = 'after_stop' | 'chunk_or_session' | 'none'

interface CaptureProfile {
  mode: CaptureMode
  /** Permite gravação continuar com app em background (foreground service Android). */
  backgroundContinuation: boolean
  /** Pipeline server-side detecta silêncios longos e segmenta em sub-notas. */
  autoSegmentation: boolean
  /** Salva áudio em Supabase Storage para playback posterior. */
  retainAudio: boolean
  transcriptionTrigger: TranscriptionTrigger
  /** Cria row em `capture_sessions` mesmo para gravações curtas. */
  createSession: boolean
  /** Aparece na lista de "notas recentes" da Home. */
  showInRecent: boolean
  /** Pré-processador opcional aplicado ao blob antes de upload/transcribe. */
  audioPreprocessor?: 'downsample_16k_wav' | 'native'
}

interface CapturePhase {
  status:
    | 'idle' | 'preparing' | 'awaiting_permission' | 'recording'
    | 'finalizing' | 'transcribing' | 'uploading' | 'completed' | 'error'
  /** Detalhe legível para UX (mensagem i18n key). */
  detail?: string
}

interface CaptureResult {
  sessionId: string | null      // null se createSession=false (raro)
  audioStoragePath: string | null // null se retainAudio=false
  transcript: string            // vazio se transcriptionTrigger=none
  rawBlob?: Blob                // só disponível imediatamente após stop (não persistido se retainAudio=false)
  durationMs: number
  format: 'wav' | 'webm' | 'opus' | 'm4a' | 'mp4'
}

interface CaptureEngineState {
  phase: CapturePhase
  permission: 'granted' | 'denied' | 'prompt' | 'unavailable'
  availability:
    | 'available' | 'permission-required' | 'permission-denied'
    | 'foreground-required' | 'interrupted' | 'unavailable'
  interruptionReason: string | null
  capabilities: AudioCaptureCapabilities  // reaproveita tipo existente
  error: string | null
  pendingUploads: PendingCaptureUpload[]  // só populado se retainAudio
  currentResult: CaptureResult | null
}

interface CaptureEngine {
  state: CaptureEngineState
  /** Inicia gravação com o profile dado. Idempotente se já recording. */
  start(profile: CaptureProfile): Promise<void>
  /** Para gravação. Retorna CaptureResult quando finalização completa. */
  stop(): Promise<CaptureResult>
  /** Cancela gravação corrente sem upload nem transcribe. */
  cancel(): Promise<void>
  /** Para sessões com retainAudio cuja upload falhou. */
  retryPendingUpload(sessionId?: string): Promise<void>
  /** Reset state machine sem mexer em sessões persistidas. */
  reset(): void
  clearError(): void
}
```

### Adapters por plataforma

```
CaptureEngine (orchestrator)
├── PermissionAdapter
│   ├── BrowserPermissionAdapter
│   └── CapacitorPermissionAdapter (Android/iOS)
├── MediaSourceAdapter
│   ├── WebAudioContextSource     (atual Manual; opcional pré-processador)
│   ├── MediaRecorderSource        (atual Safe web)
│   └── CapacitorPluginSource      (atual Safe native — @capgo/capacitor-audio-recorder)
├── PersistenceAdapter (compartilhado)
│   ├── createCaptureSession (já existe)
│   └── audioChunkService    (já existe)
└── TranscriptionAdapter
    ├── transcribeAudio (atual Manual — stateless edge fn)
    └── transcribeChunk + segment-audio-session (atual Safe pipeline)
```

**Princípio:** engine escolhe adapters baseado em `profile` + capabilities da plataforma. Manual em browser desktop usa `WebAudioContextSource` (ou `MediaRecorderSource` se aceitarmos abandonar downsample), upload skip, transcrição síncrona. Safe Capture em Android nativo usa `CapacitorPluginSource`, chunks + upload, transcrição assíncrona via pipeline.

### Resolução `profile + platform → adapters`

```
Manual desktop browser  → WebAudioContextSource + transcribeAudio + skip-upload
Manual iOS/Android      → CapacitorPluginSource + transcribeAudio + skip-upload (ou upload se retainAudio=true)
Safe Capture iOS/Android → CapacitorPluginSource + chunks + transcribe-chunk pipeline
Safe Capture desktop    → MediaRecorderSource + chunks + transcribe-chunk pipeline (já é o caso hoje)
```

---

## 3) BREAK — passos de extração neutra (não muda comportamento)

Objetivo: ter `CaptureEngine` no codebase, mas ainda não consumido pelos hooks. Smoke matrix dos dois modos atuais continua passando.

* **B1.** Criar `src/services/capture/captureEngine.ts` com a interface acima (apenas tipos + stubs). Sem implementação real ainda.
* **B2.** Criar `src/services/capture/adapters/` com 3 arquivos vazios (browserPermission.ts, mediaRecorderSource.ts, webAudioSource.ts) — só tipos e signatures.
* **B3.** Extrair `permission` logic de `useSafeCaptureMode` para `permissionAdapter` (sem deletar do hook ainda — duplicação temporária aceita).
* **B4.** Extrair `phase machine` para um reducer puro testável (`captureEngine.reducer.ts`). Os hooks atuais continuam usando seus reducers próprios.
* **B5.** Extrair detection (`isAudioRecordingSupported`, `canUseMobileNativeAudioCapture`, `shouldPreferNativeFileCapture`) para `src/services/capture/platformDetection.ts`. Hooks passam a importar daqui.
* **B6.** Criar pacote de TESTS de unidade do reducer (Vitest/Jest se houver, ou docs com cenários se não houver infra de teste).

**Critério de fim do BREAK:** `npm run build` + `npm run lint` + `npm run security:test` passam. Os dois hooks ainda funcionam exatamente como hoje. Smoke Safe Capture + Manual continuam passando.

---

## 4) EXECUTE — passos de consumo do engine (muda comportamento gradativamente)

* **E1.** Implementar `WebAudioContextSource` no engine reproduzindo lógica atual do Manual (downsample WAV). Adicionar feature flag `useUnifiedCaptureEngine: false` em `recorderUiPreferences`.
* **E2.** Sob feature flag: VoiceRecorder consome `captureEngine.start(manualProfile)` em vez de `useAudioTranscription`. Comportamento Manual idêntico ao atual (`retainAudio: false`, transcribe sync).
* **E3.** Implementar `MediaRecorderSource` (Safe web) + `CapacitorPluginSource` (Safe native) no engine.
* **E4.** Sob feature flag: VoiceRecorder consome `captureEngine.start(safeProfile)` em vez de `useSafeCaptureMode`. Smoke Safe Capture com flag on vs off — paridade.
* **E5.** Adicionar profile param `retainAudio: true` para Manual: implementar upload via `audioChunkService` reuse + criar row em `capture_sessions` mesmo para gravação curta.
* **E6.** Implementar Play button na UI da nota quando `audioStoragePath` presente. Reaproveita componente do Safe Capture já existente, se houver.
* **E7.** Migration `user_settings.keep_manual_audio` (boolean default true). `useUserSettings` ganha o getter/setter.
* **E8.** Settings UI: novo toggle "Salvar áudio das gravações manuais" (só visível quando `useUnifiedCaptureEngine=true`).
* **E9.** Flip feature flag para default `true`. Smoke matrix completa.
* **E10.** Cleanup: deletar `useAudioTranscription`, `useSafeCaptureMode`, types órfãos, paths antigos.

**Critério de fim do EXECUTE:** todos os 9 critérios de aceite da entry 4.39 verificados em iOS+Android+desktop.

---

## 5) VERIFY — smoke matrix obrigatório

| # | Caso | Plataforma | Esperado |
|---|---|---|---|
| V1 | Safe Capture grava sessão longa, pausa em background | Android nativo | sessão completa, chunks upload, transcrição via pipeline, **igual ao baseline pré-refactor** |
| V2 | Safe Capture grava com network flap mid-session | Android | pending uploads queued, retry resolve sem perda |
| V3 | Manual grava 30s no desktop browser | Web | transcrição texto retornado, **nenhuma row em `capture_sessions` se `createSession=false`** (decisão pendente — ver §7) |
| V4 | Manual grava 30s no Android com retainAudio=false | Android nativo | texto retornado, **zero objeto em bucket `voice-captures`** |
| V5 | Manual grava 30s no Android com retainAudio=true | Android nativo | texto + áudio em bucket, Play button funciona na nota |
| V6 | Manual permission denied | qualquer | erro UX claro, sem crash, retry possível |
| V7 | Mode switch Manual→Safe→Manual sem parar app | qualquer | engine reseta state corretamente entre profiles |
| V8 | Refresh page durante Safe recording | Web | recovery via pending upload store (baseline atual) |
| V9 | Refresh page durante Manual recording | Web | gravação perdida (mesmo comportamento de hoje, aceito) ou recovery (decisão pendente) |
| V10 | iOS Safari Manual | iOS Safari (web) | grava + transcreve (testar se Web Audio funciona, fallback se não) |

**Critério:** todos os V1-V10 passam antes de remover feature flag.

---

## 6) Riscos concretos + mitigations

| Risco | Severidade | Mitigation |
|---|---|---|
| **R1.** Refactor do Safe Capture quebra Android foreground service | crítico | Feature flag granular; smoke V1+V2 obrigatório antes de cada merge; rollback em 1 commit |
| **R2.** Web Audio API downsample não roda em iOS Safari | alto | Manter `audioPreprocessor: 'native'` como fallback; deixar AudioContext optional |
| **R3.** Migration `keep_manual_audio` aplicada antes do engine consumir → row default não respeitada | médio | Aplicar migration **depois** de E7 funcional sob flag; testar em staging |
| **R4.** Plugin Capacitor não disponível em Tauri desktop | médio | Manual desktop continua usando `WebAudioContextSource` ou `MediaRecorderSource`; profile especifica preferência |
| **R5.** Format converge (Manual em WAV vs Safe em WebM/M4A) cria pipeline ambíguo | médio | Decisão pendente §7; pode forçar single format ou suportar todos |
| **R6.** Pending upload queue acumula áudios Manual se retainAudio=true e usuário fica offline | baixo | Reusar lógica de Safe Capture (já existe) — sem trabalho novo |
| **R7.** Custo storage com retainAudio default true | médio | TTL no bucket (ex: 30 dias) OU toggle off por default; decisão pendente §7 |
| **R8.** Cleanup remove hook que outra parte do app importa | baixo | grep antes de deletar; testes E2E |

---

## 7) Decisões consolidadas (Gian, 2026-05-15)

Todas as 7 decisões abertas foram respondidas seguindo a recomendação proposta. Resoluções:

| # | Decisão | Resolução | Implicação técnica |
|---|---|---|---|
| **D1** | `createSession` para Manual | **Sim, sempre criar** | `manualProfile.createSession: true`. Toda gravação Manual gera row em `capture_sessions` (mesmo curtas). Padroniza telemetria, retry, recovery. |
| **D2** | Formato áudio Manual `retainAudio=true` | **Nativo M4A/WebM** | Sem pré-processador WAV/downsample para retenção. Whisper transcribe aceita o formato nativo. Alinha com Safe Capture — evita 2 formatos no bucket. |
| **D3** | TTL/quota áudio retido | **TTL 30 dias + aviso UI** | Lifecycle policy no bucket `voice-captures` (objects > 30d → delete). UI da nota exibe "Áudio expira em N dias". Sem quota por usuário. |
| **D4** | Convergir pipelines transcribe | **Manter dois caminhos no profile** | `transcriptionTrigger: 'after_stop'` (Manual) ainda usa edge `transcribe` síncrono; `transcriptionTrigger: 'chunk_or_session'` (Safe) usa `transcribe-chunk` + `segment-audio-session`. Engine escolhe baseado no profile. Edge `transcribe` NÃO aposentado. |
| **D5** | Recovery Manual em refresh | **Manter perdido (status quo)** | `manualProfile.backgroundContinuation: false`. Engine NÃO popula `pendingUploads` para Manual. Refresh/crash perde gravação corrente (comportamento atual). Safe Capture mantém seu pendingUploadStore intacto. |
| **D6** | Feature flag scope | **localStorage per-device** | `recorderUiPreferences.useUnifiedCaptureEngine: boolean` (default false durante rollout). Sem migration. Pode estar diferente entre web/iOS/Android do mesmo usuário. |
| **D7** | Bucket/path Manual retido | **Mesmo bucket `voice-captures`, mesmo schema** | Path `{userId}/sessions/{sessionId}/chunks/{chunkId}.{ext}` reutilizado. RLS, policies, audit unificados. TTL aplicado bucket-wide via lifecycle policy (impacta Safe Capture também — assumido aceitável; se não, revisar D3). |

**Citação Gian (2026-05-15):** todas as respostas marcadas como "(Recommended)" foram aceitas; resoluções acima refletem essa escolha por unanimidade.

**Caveats que emergem das decisões:**

* **C1 (D3 + D7) — RESOLVIDO (Gian, 2026-05-15):** **REGRA OBRIGATÓRIA.** TTL de 30 dias aplica **somente a áudio Manual retido**. Safe Capture **não pode herdar TTL bucket-wide**.

  **Implementação esperada (a executar em E5):**
  * Upload de objetos Manual marca com metadata/tag: `capture-mode=manual` (via `audioChunkService.uploadAudioChunkFile` modificado ou helper novo).
  * Lifecycle rule do bucket `voice-captures` DEVE filtrar por essa tag/metadata equivalente.
  * Se Supabase Storage (backend S3-compatível) **não permitir filtro seguro por tag/metadata** no lifecycle rule:
    * **NÃO** aplicar lifecycle automático. Bucket fica sem TTL automático.
    * **CRIAR** cleanup job explícito (cron + SQL/edge function) que filtra por `capture_sessions.mode = 'manual'` ou path/profile, e deleta objects via storage API.
    * **NUNCA** aplicar regra cega no bucket que delete Safe Capture chunks como dano colateral.
  * Verificação prévia obrigatória em E5: pesquisar se Supabase Storage suporta object lifecycle por tag/metadata. Se sim, lifecycle. Se não, cleanup job dedicado.
* **C2 (D1):** rows `capture_sessions` antigas (período sem unificação) não terão paridade com novas. Migration de back-fill é opcional — não impacta funcionalidade nova.
* **C3 (D6):** Manual + Safe Capture em devices diferentes do mesmo usuário podem estar em modos diferentes (engine novo vs antigo) durante o rollout. Aceitável porque o resultado (nota) converge no mesmo schema final.

---

## 8) Estimativa de complexidade

| Fase | Esforço | Risco |
|---|---|---|
| BREAK (B1-B6) | médio (2-3 dias dedicados) | baixo |
| EXECUTE Manual sob flag (E1-E2) | médio | baixo |
| EXECUTE Safe sob flag (E3-E4) | alto | crítico (R1) |
| EXECUTE retention (E5-E7) | médio | médio (R3, R7) |
| EXECUTE UI (E8-E9) | baixo | baixo |
| Cleanup (E10) | baixo | baixo |
| VERIFY | médio (precisa device físico iOS+Android) | médio |

**Total:** ~7-10 dias dedicados de trabalho focado. Não é refactor de 1 sessão.

---

## 9) Não-mudanças desta entrega (PLAN-only)

* Zero arquivo de código alterado
* Zero migration aplicada
* Zero teste rodado
* Edge functions intactas
* Tag v0.1.0 preservada
* HEAD main: sem mudança funcional, apenas documento adicionado

---

## 10) Próximo bloco operacional

**D1-D7 respondidas em 2026-05-15. Aguardando ordem explícita Gian para começar BREAK B1.**

Quando autorizado:

1. Iniciar B1 (criar interface `CaptureEngine` + tipos em `src/services/capture/`)
2. Criar entry chronicle por cada fase concluída (B1, B2, ...)
3. Cada commit = um BREAK step ou um EXECUTE step (atomicidade)
4. Feature flag `useUnifiedCaptureEngine` default OFF até V1-V10 completos
5. Endereçar C1 (TTL bucket-wide vs metadata-filtered) antes de E5 (E5 implementa retenção e precisa saber)
