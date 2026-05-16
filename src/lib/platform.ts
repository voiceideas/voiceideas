import { Capacitor } from '@capacitor/core'

export type PlatformSource = 'web' | 'macos' | 'android' | 'ios'
type AuthRedirectOptions = {
  platform?: PlatformSource
  webUrl?: string
}

const DESKTOP_AUTH_REDIRECT_URL = 'voiceideas://auth'
const ANDROID_AUTH_REDIRECT_URL = 'voiceideas://auth'
const IOS_AUTH_REDIRECT_URL = 'voiceideasmobile://auth/callback'

export function isTauriApp() {
  if (typeof window === 'undefined') return false

  const browserWindow = window as Window & { __TAURI_INTERNALS__?: unknown }
  const hasInternals = Boolean(browserWindow.__TAURI_INTERNALS__)
  const isTauriHost = window.location.hostname.endsWith('tauri.localhost')
  const isTauriUserAgent = typeof navigator !== 'undefined'
    ? navigator.userAgent.toLowerCase().includes('tauri')
    : false

  return hasInternals || isTauriHost || isTauriUserAgent
}

export function isCapacitorApp() {
  return Capacitor.isNativePlatform() && !isTauriApp()
}

export function isNativeShellApp() {
  return isTauriApp() || isCapacitorApp()
}

export function isAndroidNativeShellApp() {
  if (!isNativeShellApp()) return false

  try {
    return Capacitor.getPlatform() === 'android'
  } catch {
    if (typeof navigator === 'undefined') return false
    return navigator.userAgent.toLowerCase().includes('android')
  }
}

/**
 * VI_WEB_MANUAL_ENGINE_NO_SYSTEM_RECORDER (2026-05-16):
 *
 * Detecta se o usuário está em **navegador mobile sem shell nativo** —
 * o cenário onde historicamente abríamos o gravador externo do sistema
 * via `<input type="file" accept="audio/*" capture="user">`.
 *
 * Retorna true quando:
 *   - NÃO está em Capacitor/Tauri (shell nativo);
 *   - UA contém android/iphone/ipad/ipod.
 *
 * Usado pelo `VoiceRecorder` para **forçar** o caminho CaptureEngine
 * (gravação MediaRecorder in-page) nesse cenário, independente da flag
 * `useUnifiedCaptureEngine`. Rollback explícito via flag continua valendo
 * para desktop web e shell Capacitor.
 */
export function isMobileWebBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  if (isNativeShellApp()) return false
  const userAgent = navigator.userAgent.toLowerCase()
  return /android|iphone|ipad|ipod/.test(userAgent)
}

export function isAndroidTauriApp() {
  if (typeof navigator === 'undefined' || !isTauriApp()) return false
  return navigator.userAgent.toLowerCase().includes('android')
}

export function isIOSNativeShellApp() {
  return getPlatformSource() === 'ios'
}

export function isIPadNativeShellApp() {
  if (!isIOSNativeShellApp() || typeof navigator === 'undefined') return false

  const userAgent = navigator.userAgent.toLowerCase()
  return userAgent.includes('ipad')
}

export function getPlatformSource(): PlatformSource {
  if (isTauriApp()) {
    if (isAndroidTauriApp()) return 'android'

    if (typeof navigator !== 'undefined') {
      const userAgent = navigator.userAgent.toLowerCase()
      if (/iphone|ipad|ipod/.test(userAgent)) {
        return 'ios'
      }
    }

    return 'macos'
  }

  if (isCapacitorApp()) {
    try {
      const platform = Capacitor.getPlatform()
      if (platform === 'android') return 'android'
      if (platform === 'ios') return 'ios'
    } catch {
      // Ignore capability probe failures and fall back to web.
    }
  }

  return 'web'
}

export function getAuthRedirectUrl(options: AuthRedirectOptions = {}) {
  const platform = options.platform ?? getPlatformSource()

  switch (platform) {
    case 'macos':
      return DESKTOP_AUTH_REDIRECT_URL
    case 'android':
      return ANDROID_AUTH_REDIRECT_URL
    case 'ios':
      return IOS_AUTH_REDIRECT_URL
    case 'web':
    default:
      if (options.webUrl) return options.webUrl
      if (typeof window !== 'undefined') return window.location.origin
      return 'http://localhost'
  }
}

export function isSupportedAuthRedirectUrl(incomingUrl: string) {
  const platform = getPlatformSource()
  const supportedPrefixes = new Set<string>([
    getAuthRedirectUrl({ platform }),
    DESKTOP_AUTH_REDIRECT_URL,
    ANDROID_AUTH_REDIRECT_URL,
    IOS_AUTH_REDIRECT_URL,
  ])

  return Array.from(supportedPrefixes).some((prefix) => incomingUrl.startsWith(prefix))
}
