import { useEffect, useState } from 'react'
import { isNativeShellApp } from '../lib/platform'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

function detectIosDevice() {
  if (typeof navigator === 'undefined') return false

  const userAgent = navigator.userAgent.toLowerCase()
  return /iphone|ipad|ipod/.test(userAgent)
}

function detectMacDesktop() {
  if (typeof navigator === 'undefined') return false

  const userAgent = navigator.userAgent.toLowerCase()
  return userAgent.includes('macintosh')
}

function detectAndroid() {
  if (typeof navigator === 'undefined') return false

  return navigator.userAgent.toLowerCase().includes('android')
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const isMacDesktop = detectMacDesktop()
  const isNativeApp = isNativeShellApp()

  useEffect(() => {
    if (typeof window === 'undefined' || isNativeApp) return

    const mediaQuery = window.matchMedia('(display-mode: standalone)')

    const syncInstalledState = () => {
      const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
      setIsInstalled(mediaQuery.matches || Boolean(navigatorWithStandalone.standalone))
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }

    const handleInstalled = () => {
      setDeferredPrompt(null)
      setIsInstalled(true)
    }

    syncInstalledState()

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    mediaQuery.addEventListener('change', syncInstalledState)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      mediaQuery.removeEventListener('change', syncInstalledState)
    }
  }, [isNativeApp])

  const promptInstall = async () => {
    if (!deferredPrompt) return false

    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice

    if (choice.outcome === 'accepted') {
      setDeferredPrompt(null)
      return true
    }

    return false
  }

  return {
    canPromptInstall: Boolean(deferredPrompt) && !isInstalled && !isMacDesktop,
    isInstalled,
    manualInstallMode: !isNativeApp && !isInstalled && !isMacDesktop
      ? (detectIosDevice()
          ? 'ios'
          : detectAndroid()
              ? 'android'
              : null)
      : null,
    promptInstall,
  }
}
