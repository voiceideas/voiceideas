/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B7 (2026-05-15)
 *
 * Detecção pura e SSR-safe das capabilities de captura no host atual.
 * Sem side-effects (não pede permission, não abre MediaStream, não
 * importa Capacitor SDK).
 *
 * **Status (B7):** APENAS detecção pura.
 *   - Nenhum hook consome.
 *   - Não acessa plugin nativo (per guardrail).
 *   - Tipos retornados são determinísticos para uma chamada — não
 *     reagem a mudanças runtime (browser permission revocation, etc).
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §4 BREAK
 * (extração de detection de `useAudioTranscription` + `useSafeCaptureMode`
 * + `src/utils/platform/audioCaptureCapabilities.ts`).
 *
 * **Distinção:** este módulo NÃO substitui `AudioCaptureCapabilities`
 * de `src/utils/platform/`. Aquele cobre concerns mais amplos (foreground
 * service, plugin native, etc) que dependem de Capacitor. Este é
 * estritamente browser-side, sem importar Capacitor.
 */

// ─── Tipos retornados ────────────────────────────────────────────────

/**
 * Classificação ampla da plataforma host. Heurística leve, sem
 * acessar Capacitor SDK.
 *
 * - 'ssr': sem `window` (Node, build SSR).
 * - 'native-capacitor': `window.Capacitor.isNativePlatform()` retorna true.
 * - 'web-mobile': UA contém iPhone/iPad/Android.
 * - 'web-desktop': default web.
 * - 'unknown': erro inesperado durante detecção.
 */
export type CapturePlatform =
  | 'ssr'
  | 'native-capacitor'
  | 'web-mobile'
  | 'web-desktop'
  | 'unknown'

export interface MediaRecorderCapability {
  available: boolean
  /** MIME types detectados como suportados via `isTypeSupported`. */
  supportedMimeTypes: ReadonlyArray<string>
}

export interface GetUserMediaCapability {
  available: boolean
}

export interface AudioContextCapability {
  available: boolean
  /** True se a única fonte for `webkitAudioContext` (Safari antigo). */
  webkitFallback: boolean
}

export interface ScriptProcessorCapability {
  available: boolean
}

export interface PermissionsApiCapability {
  available: boolean
  /**
   * `true` se `permissions.query` existe; nunca consultamos
   * 'microphone' aqui (síncrono não-bloqueante) — apenas reportamos
   * que a API base existe.
   */
  supportsMicrophoneName: 'unknown'
}

export interface CaptureCapabilities {
  platform: CapturePlatform
  mediaRecorder: MediaRecorderCapability
  getUserMedia: GetUserMediaCapability
  audioContext: AudioContextCapability
  scriptProcessorNode: ScriptProcessorCapability
  permissionsApi: PermissionsApiCapability
}

// ─── Sentinelas SSR-safe ─────────────────────────────────────────────

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function hasNavigator(): boolean {
  return typeof navigator !== 'undefined'
}

// ─── Detection helpers individuais ───────────────────────────────────

/**
 * Heurística leve para Capacitor native shell. NÃO importa o SDK
 * Capacitor — checa apenas a presença da global esperada e o flag
 * `isNativePlatform()`. Falha silenciosa para web puro.
 */
export function isNativeCapacitorShell(): boolean {
  if (!hasWindow()) return false
  try {
    const cap = (window as unknown as { Capacitor?: unknown }).Capacitor
    if (!cap || typeof cap !== 'object') return false
    const isNativeFn = (cap as { isNativePlatform?: () => unknown })
      .isNativePlatform
    if (typeof isNativeFn !== 'function') return false
    return isNativeFn() === true
  } catch {
    return false
  }
}

export function detectCapturePlatform(): CapturePlatform {
  if (!hasWindow()) return 'ssr'
  try {
    if (isNativeCapacitorShell()) return 'native-capacitor'
    if (!hasNavigator()) return 'web-desktop'
    const ua = navigator.userAgent.toLowerCase()
    if (/iphone|ipad|ipod|android/.test(ua)) return 'web-mobile'
    return 'web-desktop'
  } catch {
    return 'unknown'
  }
}

export function isMediaRecorderAvailable(): boolean {
  if (!hasWindow()) return false
  return typeof (window as { MediaRecorder?: unknown }).MediaRecorder === 'function'
}

/**
 * Lista MIME types comumente usados em audio capture web. Testa cada
 * um via `MediaRecorder.isTypeSupported`. Idempotente, sem side-effect.
 */
const PROBED_MIME_TYPES: ReadonlyArray<string> = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/wav',
]

export function detectSupportedMimeTypes(): ReadonlyArray<string> {
  if (!isMediaRecorderAvailable()) return []
  const result: string[] = []
  for (const candidate of PROBED_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) {
        result.push(candidate)
      }
    } catch {
      // Algumas implementações throw em isTypeSupported — ignorar.
    }
  }
  return result
}

export function isGetUserMediaAvailable(): boolean {
  if (!hasNavigator()) return false
  return typeof navigator.mediaDevices?.getUserMedia === 'function'
}

export function detectAudioContextCapability(): AudioContextCapability {
  if (!hasWindow()) {
    return { available: false, webkitFallback: false }
  }
  const standard = typeof AudioContext !== 'undefined'
  const webkit =
    typeof (window as { webkitAudioContext?: unknown }).webkitAudioContext ===
    'function'
  return {
    available: standard || webkit,
    webkitFallback: !standard && webkit,
  }
}

/**
 * `ScriptProcessorNode` é deprecated mas ainda disponível em todos os
 * browsers modernos. Verificamos pela presença do método no AudioContext
 * sem instanciar contexto real.
 */
export function isScriptProcessorAvailable(): boolean {
  if (!hasWindow()) return false
  const audioCtx = detectAudioContextCapability()
  if (!audioCtx.available) return false
  // O método createScriptProcessor existe no protótipo do AudioContext.
  // Verificar sem instanciar (mais barato e zero side-effect).
  try {
    const Ctor = (typeof AudioContext !== 'undefined'
      ? AudioContext
      : (window as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext) as typeof AudioContext | undefined
    if (!Ctor) return false
    return (
      typeof (Ctor.prototype as { createScriptProcessor?: unknown })
        .createScriptProcessor === 'function'
    )
  } catch {
    return false
  }
}

export function isPermissionsApiAvailable(): boolean {
  if (!hasNavigator()) return false
  const perms = (navigator as { permissions?: { query?: unknown } }).permissions
  return typeof perms?.query === 'function'
}

// ─── Snapshot consolidado ────────────────────────────────────────────

/**
 * Compose all capability detections in one call. Idempotente,
 * SSR-safe, sem side-effects.
 */
export function detectCaptureCapabilities(): CaptureCapabilities {
  const platform = detectCapturePlatform()
  const mediaRecorderAvailable = isMediaRecorderAvailable()
  const getUserMediaAvailable = isGetUserMediaAvailable()
  const audioContext = detectAudioContextCapability()
  const scriptProcessorAvailable = isScriptProcessorAvailable()
  const permissionsAvailable = isPermissionsApiAvailable()

  return {
    platform,
    mediaRecorder: {
      available: mediaRecorderAvailable,
      supportedMimeTypes: mediaRecorderAvailable
        ? detectSupportedMimeTypes()
        : [],
    },
    getUserMedia: {
      available: getUserMediaAvailable,
    },
    audioContext,
    scriptProcessorNode: {
      available: scriptProcessorAvailable,
    },
    permissionsApi: {
      available: permissionsAvailable,
      supportsMicrophoneName: 'unknown',
    },
  }
}

/**
 * True se a plataforma suporta pelo menos um caminho de captura
 * (MediaRecorder OU WebAudio). Útil para early-exit em UX
 * ("microfone não disponível").
 */
export function hasAnyCaptureSource(capabilities: CaptureCapabilities): boolean {
  return (
    capabilities.getUserMedia.available &&
    (capabilities.mediaRecorder.available ||
      (capabilities.audioContext.available &&
        capabilities.scriptProcessorNode.available))
  )
}
