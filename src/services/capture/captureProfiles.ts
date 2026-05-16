/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B3 (2026-05-15)
 *
 * Camada de profiles/policies do CaptureEngine. Formaliza Manual e
 * Safe Capture como CONFIGURAÇÕES (data) — não como caminhos de
 * código separados. O engine (B4+) escolhe adapters baseado nestas
 * policies + capabilities da plataforma.
 *
 * **Status (B3):**
 *   - APENAS dados (constantes + factory). Zero side-effect, zero
 *     consumo de adapter.
 *   - Nenhum hook consome.
 *   - `useAudioTranscription` e `useSafeCaptureMode` permanecem
 *     intocados.
 *   - `CaptureProfile` minimalista de B1 (`captureEngine.ts`) NÃO é
 *     modificado — este módulo expõe `CaptureProfileBundle` que
 *     CONTÉM o `CaptureProfile` como `engineProfile` + policies
 *     estruturadas adicionais.
 *
 * **Decisões D1-D7 refletidas (Gian, 2026-05-15):**
 *   D1 — Manual SEMPRE cria capture_sessions row.
 *   D2 — formato áudio retido: native M4A/WebM (sem WAV downsample).
 *   D3 — Manual com retainAudio=true tem TTL 30 dias.
 *   D4 — pipelines transcribe separados (Manual sync, Safe async).
 *   D5 — Manual NÃO recupera gravação em refresh/crash
 *        (`backgroundContinuation: false`, `recovery.enabled: false`).
 *   D6 — feature flag `useUnifiedCaptureEngine` é localStorage
 *        per-device — NÃO faz parte do profile (vive em
 *        `recorderUiPreferences`).
 *   D7 — Manual usa MESMO bucket `voice-captures` + MESMO schema de
 *        path do Safe Capture.
 *
 * **C1 (regra obrigatória) refletida:**
 *   - `manualCaptureProfile.retain.storageMetadataTag = { key:
 *     'capture-mode', value: 'manual' }`. Lifecycle/cleanup futuro
 *     DEVE filtrar por essa tag.
 *   - `safeCaptureProfile.retain.ttlDays = 0` (sem TTL automático
 *     bucket-wide). Safe Capture NUNCA herda TTL Manual.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §2 + §7 (decisões + C1).
 */

import type {
  AudioPreprocessor,
  CaptureMode,
  CaptureProfile,
} from './captureEngine'

// ─── Policies estruturadas ───────────────────────────────────────────

/**
 * Política de retenção de áudio em Storage.
 * Por D2, default `format: 'native'`. Por D3, Manual com `enabled: true`
 * usa `ttlDays: 30`. Por C1, Manual marca metadata tag para lifecycle
 * filtrável.
 */
export interface RetainAudioPolicy {
  /** Se true, engine sobe blob para Storage e referencia em capture_sessions. */
  enabled: boolean
  /**
   * TTL em dias após o qual o objeto deve ser deletado.
   *   - Manual com enabled=true: 30 (per D3).
   *   - Safe Capture: 0 (sem TTL — per C1, Safe NUNCA herda TTL bucket-wide).
   *   - 0 = sem TTL automático.
   */
  ttlDays: number
  /**
   * Tag/metadata aplicada ao objeto no upload, usada para filtrar no
   * lifecycle rule. Per C1 é OBRIGATÓRIO em Manual quando enabled=true.
   * Safe Capture deixa undefined (sem tag = não cai em rule de Manual).
   */
  storageMetadataTag?: { key: string; value: string }
  /** Per D2, default 'native' para Manual com retain. */
  format: 'native' | 'wav_16k_mono'
}

/** Política de segmentação server-side via pipeline transcribe-chunk + segment-audio-session. */
export interface SegmentationPolicy {
  enabled: boolean
  /**
   * Quando segmentação roda:
   *   - 'on_chunk': cada chunk emitido durante gravação dispara segment.
   *   - 'on_session_complete': só após stop().
   *   - 'none': não roda.
   */
  trigger: 'on_chunk' | 'on_session_complete' | 'none'
}

/**
 * Política de recovery após refresh/crash.
 * Per D5: Manual não recupera; Safe Capture mantém pendingUploadStore.
 */
export interface RecoveryPolicy {
  enabled: boolean
}

/** Política de Storage. Per D7, Manual usa MESMO bucket + MESMO schema do Safe. */
export interface StoragePolicy {
  bucket: string
  /**
   * Template do path. Placeholders esperados: `{userId}`, `{sessionId}`,
   * `{chunkId}`, `{ext}`. O upload service substitui no momento do put.
   */
  pathTemplate: string
  /** Quando subir o blob para Storage. */
  uploadTrigger: 'on_chunk' | 'on_session_complete' | 'never'
}

/**
 * Hints de plataforma — qual adapter source o engine deve preferir.
 * Engine pode override se capabilities indicarem que o preferred não
 * está disponível (ex: WebAudio em iOS Safari sem AudioContext).
 */
export interface PlatformHints {
  /** Source preferido em browser/desktop (não-Capacitor). */
  preferredWebSource: 'web-audio' | 'media-recorder'
  /** Source preferido em Capacitor native shell (iOS/Android). */
  preferredCapacitorSource: 'capacitor-plugin' | 'media-recorder'
  /**
   * Implica foreground service Android (notification, ongoing). Per D5,
   * Manual = false; Safe Capture = true.
   */
  requiresAndroidForegroundService: boolean
}

// ─── Bundle: engineProfile + policies ────────────────────────────────

/**
 * Profile completo consumido pela aplicação.
 *
 * - `engineProfile`: subset minimalista que vai pra `CaptureEngine.start()`
 *   (compatível com `CaptureProfile` de B1 — não modificado).
 * - Demais campos: policies estruturadas que adapters/services consultam
 *   diretamente (storage path, TTL, tag de metadata, etc).
 */
export interface CaptureProfileBundle {
  engineProfile: CaptureProfile
  retain: RetainAudioPolicy
  segmentation: SegmentationPolicy
  recovery: RecoveryPolicy
  storage: StoragePolicy
  platformHints: PlatformHints
}

// ─── Constantes Manual ───────────────────────────────────────────────

const MANUAL_DEFAULT_AUDIO_PREPROCESSOR: AudioPreprocessor = 'native'

/**
 * Profile canônico do Manual Mode.
 *
 * - D1: `createSession: true` — cria row mesmo gravação curta.
 * - D2: `audioPreprocessor: 'native'` + `retain.format: 'native'`.
 * - D3+C1: `retain.ttlDays: 30` + `storageMetadataTag: capture-mode=manual`.
 *   Por default `retain.enabled: false` (usuário liga via setting futuro).
 *   Quando ligado pelo `getCaptureProfile('manual', { retainAudio: true })`,
 *   TTL e tag se aplicam automaticamente.
 * - D4: `transcriptionTrigger: 'after_stop'` (síncrono via edge `transcribe`).
 * - D5: `backgroundContinuation: false`, `recovery.enabled: false`,
 *   `requiresAndroidForegroundService: false`.
 * - D7: `bucket: 'voice-captures'`, mesmo `pathTemplate` do Safe.
 */
export const manualCaptureProfile: CaptureProfileBundle = {
  engineProfile: {
    mode: 'manual',
    backgroundContinuation: false,
    autoSegmentation: false,
    retainAudio: false,
    transcriptionTrigger: 'after_stop',
    createSession: true,
    showInRecent: true,
    audioPreprocessor: MANUAL_DEFAULT_AUDIO_PREPROCESSOR,
  },
  retain: {
    enabled: false,
    ttlDays: 30,
    storageMetadataTag: { key: 'capture-mode', value: 'manual' },
    format: 'native',
  },
  segmentation: {
    enabled: false,
    trigger: 'none',
  },
  recovery: {
    enabled: false,
  },
  storage: {
    bucket: 'voice-captures',
    pathTemplate: '{userId}/sessions/{sessionId}/chunks/{chunkId}.{ext}',
    uploadTrigger: 'on_session_complete',
  },
  platformHints: {
    preferredWebSource: 'media-recorder',
    preferredCapacitorSource: 'capacitor-plugin',
    requiresAndroidForegroundService: false,
  },
}

// ─── Constantes Safe Capture ─────────────────────────────────────────

/**
 * Profile canônico do Safe Capture.
 *
 * - `createSession: true` (já era o caso hoje).
 * - `backgroundContinuation: true` + `requiresAndroidForegroundService: true`.
 * - `autoSegmentation: true` + `segmentation.trigger: 'on_session_complete'`.
 * - `transcriptionTrigger: 'chunk_or_session'` (pipeline assíncrono via
 *   transcribe-chunk + segment-audio-session).
 * - `retainAudio: true` por default.
 * - **C1: `retain.ttlDays: 0` — Safe NUNCA herda TTL Manual.**
 * - **C1: `retain.storageMetadataTag: undefined` — sem tag = lifecycle
 *   de Manual NÃO atinge.**
 * - D7: `bucket: 'voice-captures'`, mesmo schema.
 * - `recovery.enabled: true` (mantém pendingUploadStore atual).
 */
export const safeCaptureProfile: CaptureProfileBundle = {
  engineProfile: {
    mode: 'safe_capture',
    backgroundContinuation: true,
    autoSegmentation: true,
    retainAudio: true,
    transcriptionTrigger: 'chunk_or_session',
    createSession: true,
    showInRecent: true,
    audioPreprocessor: 'native',
  },
  retain: {
    enabled: true,
    ttlDays: 0,
    storageMetadataTag: undefined,
    format: 'native',
  },
  segmentation: {
    enabled: true,
    trigger: 'on_session_complete',
  },
  recovery: {
    enabled: true,
  },
  storage: {
    bucket: 'voice-captures',
    pathTemplate: '{userId}/sessions/{sessionId}/chunks/{chunkId}.{ext}',
    uploadTrigger: 'on_chunk',
  },
  platformHints: {
    preferredWebSource: 'media-recorder',
    preferredCapacitorSource: 'capacitor-plugin',
    requiresAndroidForegroundService: true,
  },
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Overrides aceitos pelo factory. Permite ajuste local sem mutar
 * as constantes.
 */
export interface GetCaptureProfileOptions {
  /**
   * Override de `retain.enabled` + sincroniza `engineProfile.retainAudio`.
   * Útil para Manual: usuário liga "Salvar áudio das gravações manuais"
   * via setting futuro → `getCaptureProfile('manual', { retainAudio: true })`.
   * Para Safe Capture, ignorar — Safe sempre retém.
   */
  retainAudio?: boolean
  /**
   * Override do preprocessor. Usado quando precisamos forçar WAV legado
   * (ex: edge `transcribe` antiga não aceita formato nativo).
   */
  audioPreprocessor?: AudioPreprocessor
}

/**
 * Retorna o profile bundle correspondente ao mode + overrides.
 * Pure function — não muta as constantes; clona o bundle.
 */
export function getCaptureProfile(
  mode: CaptureMode,
  options?: GetCaptureProfileOptions,
): CaptureProfileBundle {
  const base =
    mode === 'manual' ? manualCaptureProfile : safeCaptureProfile

  // Clone superficial das partes mutáveis. Bundle inteiro é tratado
  // como imutável pelos consumers; este clone evita acidente se algum
  // consumer fizer override defensivo no objeto retornado.
  const cloned: CaptureProfileBundle = {
    engineProfile: { ...base.engineProfile },
    retain: { ...base.retain },
    segmentation: { ...base.segmentation },
    recovery: { ...base.recovery },
    storage: { ...base.storage },
    platformHints: { ...base.platformHints },
  }

  if (options?.retainAudio !== undefined && mode === 'manual') {
    cloned.retain.enabled = options.retainAudio
    cloned.engineProfile.retainAudio = options.retainAudio
    if (options.retainAudio) {
      // Garante a tag obrigatória C1 ao ligar retention no Manual.
      cloned.retain.storageMetadataTag = {
        key: 'capture-mode',
        value: 'manual',
      }
    }
  }

  if (options?.audioPreprocessor !== undefined) {
    cloned.engineProfile.audioPreprocessor = options.audioPreprocessor
    if (options.audioPreprocessor === 'downsample_16k_wav') {
      cloned.retain.format = 'wav_16k_mono'
    }
  }

  return cloned
}
