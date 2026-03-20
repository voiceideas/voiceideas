export function isTauriApp() {
  if (typeof window === 'undefined') return false

  const browserWindow = window as Window & { __TAURI_INTERNALS__?: unknown }
  return Boolean(browserWindow.__TAURI_INTERNALS__)
}

export function getDefaultAuthRedirectUrl() {
  if (typeof window === 'undefined') {
    return 'voiceideas://auth'
  }

  return isTauriApp() ? 'voiceideas://auth' : window.location.origin
}
