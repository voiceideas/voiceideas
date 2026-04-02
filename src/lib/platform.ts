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

export function isAndroidTauriApp() {
  if (typeof navigator === 'undefined' || !isTauriApp()) return false
  return navigator.userAgent.toLowerCase().includes('android')
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
