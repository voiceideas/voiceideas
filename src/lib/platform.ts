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

export function isAndroidTauriApp() {
  if (typeof navigator === 'undefined' || !isTauriApp()) return false
  return navigator.userAgent.toLowerCase().includes('android')
}

export function getDefaultAuthRedirectUrl() {
  if (typeof window === 'undefined') {
    return 'voiceideas://auth'
  }

  return isTauriApp() ? 'voiceideas://auth' : window.location.origin
}
