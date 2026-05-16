/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B9D (2026-05-16)
 *
 * Atalhos `createManualCaptureEngine`, `createSafeCaptureEngine`,
 * `createCaptureEngineForMode` que injetam adapters reais B9B +
 * `resolveUserId` via Supabase auth.
 *
 * Este arquivo é o "with-defaults" — separado de
 * `createCaptureEngine.ts` (factory puro) para que o factory puro
 * possa rodar em ambientes Node neutros (smoke, tests) sem importar
 * Supabase e sem acionar `import.meta.env` Vite-specific.
 *
 * **Status (B9D):** zero consumidor em produção. Existe para callers
 * futuros (B9E+) que vão consumir o engine.
 */

import { supabase } from '../../lib/supabase'
import type { CaptureEngine, CaptureMode } from './captureEngine'
import type {
  CaptureProfileBundle,
  GetCaptureProfileOptions,
} from './captureProfiles'
import { getCaptureProfile } from './captureProfiles'
import {
  createMediaRecorderSource,
  createPermissionAdapter,
  createWebAudioSource,
} from './adapters'
import { createSupabaseCapturePersistence } from './captureSupabasePersistence'
import { createSupabaseCaptureStorage } from './captureSupabaseStorage'
import { createCaptureTranscriptionAdapter } from './captureTranscriptionAdapter'
import {
  CaptureEngineError,
  createCaptureEngine,
  type CaptureEngineAdapters,
  type CaptureEngineUserIdResolver,
} from './createCaptureEngine'

/**
 * Resolve userId via `supabase.auth.getUser()`. Lança
 * `CaptureEngineError('auth-error', ...)` se não houver usuário
 * autenticado.
 */
const supabaseUserIdResolver: CaptureEngineUserIdResolver = async () => {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user?.id) {
    throw new CaptureEngineError(
      'auth-error',
      'Usuário não autenticado — não é possível resolver userId para upload.',
    )
  }
  return data.user.id
}

/**
 * Constrói o conjunto completo de adapters reais. Merge com overrides
 * do caller (útil para tests pontuais que querem trocar só um slot).
 */
export function getDefaultCaptureAdapters(
  overrides?: Partial<CaptureEngineAdapters>,
): CaptureEngineAdapters {
  return {
    permission: overrides?.permission ?? createPermissionAdapter(),
    webAudioSource: overrides?.webAudioSource ?? createWebAudioSource(),
    mediaRecorderSource:
      overrides?.mediaRecorderSource ?? createMediaRecorderSource(),
    persistence: overrides?.persistence ?? createSupabaseCapturePersistence(),
    storage: overrides?.storage ?? createSupabaseCaptureStorage(),
    transcription:
      overrides?.transcription ?? createCaptureTranscriptionAdapter(),
    resolveUserId: overrides?.resolveUserId ?? supabaseUserIdResolver,
  }
}

/**
 * Atalho Manual. Aceita overrides via `Partial<CaptureEngineAdapters>`.
 */
export function createManualCaptureEngine(
  options?: GetCaptureProfileOptions,
  adapterOverrides?: Partial<CaptureEngineAdapters>,
): CaptureEngine {
  const bundle = getCaptureProfile('manual', options)
  const adapters = getDefaultCaptureAdapters(adapterOverrides)
  return createCaptureEngine(bundle, adapters)
}

/**
 * Atalho Safe Capture. Per B9D, profile com `chunk_or_session` lança
 * `safe-async-reserved` no `stop()` — caller deve usar caminho legacy.
 */
export function createSafeCaptureEngine(
  options?: GetCaptureProfileOptions,
  adapterOverrides?: Partial<CaptureEngineAdapters>,
): CaptureEngine {
  const bundle: CaptureProfileBundle = getCaptureProfile(
    'safe_capture',
    options,
  )
  const adapters = getDefaultCaptureAdapters(adapterOverrides)
  return createCaptureEngine(bundle, adapters)
}

export function createCaptureEngineForMode(
  mode: CaptureMode,
  options?: GetCaptureProfileOptions,
  adapterOverrides?: Partial<CaptureEngineAdapters>,
): CaptureEngine {
  return mode === 'manual'
    ? createManualCaptureEngine(options, adapterOverrides)
    : createSafeCaptureEngine(options, adapterOverrides)
}
