/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B5 (2026-05-15)
 *
 * Factory de composição neutra do CaptureEngine. Conecta:
 *   - tipos do engine (`captureEngine.ts`)
 *   - profiles/policies (`captureProfiles.ts`)
 *   - adapters stubs (`adapters/index.ts`)
 *   - feature flag (`captureEngineFeatureFlag.ts`)
 *
 * **Status (B5):** APENAS composição. ZERO comportamento runtime real.
 *   - Engine retornado usa adapters stub por default — todos os
 *     métodos lançam `*UnimplementedError` se chamados.
 *   - Nenhum hook consome.
 *   - Nenhuma gravação iniciada.
 *   - Feature flag é LIDA via helper exportado, mas o resultado não
 *     ativa nada — quem decide consumir é o caller (futuro B6+).
 *
 * **Critério duro:** se algum hook ou componente importar este módulo
 * em B5, ainda não vai funcionar (engine throws). Isso é intencional —
 * detecta consumidores prematuros antes da implementação real.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §4 BREAK + §10.
 */

import type {
  CaptureEngine,
  CaptureEngineState,
  CaptureMode,
} from './captureEngine'
import {
  CaptureEngineUnimplementedError,
} from './captureEngine'
import type {
  CaptureProfileBundle,
  GetCaptureProfileOptions,
} from './captureProfiles'
import { getCaptureProfile } from './captureProfiles'
import type {
  MediaRecorderSource,
  PermissionAdapter,
  WebAudioSource,
} from './adapters'
import {
  createMediaRecorderSourceStub,
  createPermissionAdapterStub,
  createWebAudioSourceStub,
} from './adapters'
import { isUnifiedCaptureEngineEnabled } from '../../lib/captureEngineFeatureFlag'

// ─── Adapter slot ────────────────────────────────────────────────────

/**
 * Conjunto de adapters consumidos pelo engine. Slots opcionais quando
 * a plataforma não suporta um determinado source (ex: Tauri desktop
 * sem CapacitorPluginSource).
 *
 * **B5 — futuros adapters faltantes:**
 *   - `capacitorPluginSource`: ainda não modelado nem stubado (B3
 *     criou apenas web-side: permission + mediaRecorder + webAudio).
 *     Será adicionado em iteração futura quando a implementação real
 *     entrar.
 */
export interface CaptureEngineAdapters {
  permission: PermissionAdapter
  webAudioSource: WebAudioSource
  mediaRecorderSource: MediaRecorderSource
}

/**
 * Modo de seleção de engine. Lido da feature flag
 * `useUnifiedCaptureEngine` em localStorage per-device.
 *   - `unified`: futuro consumidor deve usar este engine.
 *   - `legacy`: continuar com `useAudioTranscription` /
 *     `useSafeCaptureMode` (comportamento atual).
 *
 * Em B5 a função é exposta mas ninguém consome.
 */
export type CaptureEngineSelectedMode = 'unified' | 'legacy'

// ─── Factory principal ───────────────────────────────────────────────

/**
 * Cria um `CaptureEngine` para o profile bundle dado. Em B5 retorna
 * sempre o stub: state inicial mínimo + métodos throw.
 *
 * Adapters são opcionais — se omitidos, usa stubs (B2). Quando B6+
 * trouxer implementações reais, o caller passará adapters concretos
 * aqui.
 *
 * **Resolução do snapshot inicial de permission/availability:**
 * usamos o snapshot do PermissionAdapter passado (ou stub). Em B5
 * o stub responde `unavailable` — totalmente esperado, sinaliza que
 * nenhuma permissão real foi checada.
 */
export function createCaptureEngine(
  profileBundle: CaptureProfileBundle,
  adapters?: Partial<CaptureEngineAdapters>,
): CaptureEngine {
  const resolvedAdapters: CaptureEngineAdapters = {
    permission: adapters?.permission ?? createPermissionAdapterStub(),
    webAudioSource: adapters?.webAudioSource ?? createWebAudioSourceStub(),
    mediaRecorderSource:
      adapters?.mediaRecorderSource ?? createMediaRecorderSourceStub(),
  }

  // Snapshot inicial puramente reflexivo do que o PermissionAdapter
  // já tem. Nenhum side-effect (não dispara request, não grava, não
  // sobe nada). State de capabilities/pendingUploads fica null/[]
  // até o engine real ser implementado em B6+.
  const initialState: CaptureEngineState = {
    phase: { status: 'idle' },
    permission: resolvedAdapters.permission.snapshot.permission,
    availability: resolvedAdapters.permission.snapshot.availability,
    interruptionReason: resolvedAdapters.permission.snapshot.reason,
    capabilities: null,
    error: null,
    pendingUploads: [],
    currentResult: null,
  }

  // Marca o profile bundle como consumido — referência guardada para
  // o engine real (B6+) validar profile.start vs bundle no momento
  // certo. B5 não usa a referência além desse hint.
  void profileBundle

  // Métodos abaixo omitem parâmetros porque B5 não os usa — o tipo
  // do `CaptureEngine` (interface contextual) garante que o engine
  // ainda satisfaz a assinatura exigida pelos callers. Quando B6+
  // implementar de verdade, params são reintroduzidos com nomes reais.
  return {
    state: initialState,
    start: async () => {
      throw new CaptureEngineUnimplementedError('start')
    },
    stop: async () => {
      throw new CaptureEngineUnimplementedError('stop')
    },
    cancel: async () => {
      throw new CaptureEngineUnimplementedError('cancel')
    },
    retryPendingUpload: async () => {
      throw new CaptureEngineUnimplementedError('retryPendingUpload')
    },
    reset: async () => {
      throw new CaptureEngineUnimplementedError('reset')
    },
    clearError: async () => {
      throw new CaptureEngineUnimplementedError('clearError')
    },
  }
}

// ─── Atalhos por mode ────────────────────────────────────────────────

/**
 * Atalho para criar engine no profile Manual. Aceita as mesmas
 * opções de `getCaptureProfile('manual', options)` (`retainAudio`,
 * `audioPreprocessor`).
 */
export function createManualCaptureEngine(
  options?: GetCaptureProfileOptions,
  adapters?: Partial<CaptureEngineAdapters>,
): CaptureEngine {
  const bundle = getCaptureProfile('manual', options)
  return createCaptureEngine(bundle, adapters)
}

/**
 * Atalho para criar engine no profile Safe Capture. Safe Capture
 * ignora `options.retainAudio` (sempre retém — ver `captureProfiles.ts`).
 */
export function createSafeCaptureEngine(
  options?: GetCaptureProfileOptions,
  adapters?: Partial<CaptureEngineAdapters>,
): CaptureEngine {
  const bundle = getCaptureProfile('safe_capture', options)
  return createCaptureEngine(bundle, adapters)
}

/**
 * Atalho semântico para casos onde o caller decide o mode em runtime
 * (ex: VoiceRecorder lendo profile selecionado pela UI).
 */
export function createCaptureEngineForMode(
  mode: CaptureMode,
  options?: GetCaptureProfileOptions,
  adapters?: Partial<CaptureEngineAdapters>,
): CaptureEngine {
  return mode === 'manual'
    ? createManualCaptureEngine(options, adapters)
    : createSafeCaptureEngine(options, adapters)
}

// ─── Feature flag bridge ─────────────────────────────────────────────

/**
 * Retorna qual motor o caller deve usar baseado na feature flag.
 * NÃO instancia engine. NÃO altera estado. Pure read.
 *
 * Em B5: sempre retorna `'legacy'` por default (flag default false).
 * Quem consome a decisão é responsabilidade do caller futuro.
 */
export function getSelectedCaptureEngineMode(): CaptureEngineSelectedMode {
  return isUnifiedCaptureEngineEnabled() ? 'unified' : 'legacy'
}
