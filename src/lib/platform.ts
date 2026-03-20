import { Capacitor } from '@capacitor/core'

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
  if (typeof navigator === 'undefined' || !isNativeShellApp()) return false
  return navigator.userAgent.toLowerCase().includes('android')
}

export function isAndroidTauriApp() {
  if (typeof navigator === 'undefined' || !isTauriApp()) return false
  return navigator.userAgent.toLowerCase().includes('android')
}

export function getDefaultAuthRedirectUrl() {
  if (typeof window === 'undefined') {
    return 'voiceideas://auth'
  }

  return isNativeShellApp() ? 'voiceideas://auth' : window.location.origin
}
