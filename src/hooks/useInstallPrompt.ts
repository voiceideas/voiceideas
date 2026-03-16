import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

function detectIosSafari() {
  if (typeof navigator === 'undefined') return false

  const userAgent = navigator.userAgent.toLowerCase()
  const isIos = /iphone|ipad|ipod/.test(userAgent)
  const isSafari = userAgent.includes('safari') && !userAgent.includes('crios') && !userAgent.includes('fxios')

  return isIos && isSafari
}

function detectMacSafari() {
  if (typeof navigator === 'undefined') return false

  const userAgent = navigator.userAgent.toLowerCase()
  const isMac = userAgent.includes('macintosh')
  const isSafari = userAgent.includes('safari') && !userAgent.includes('chrome') && !userAgent.includes('crios') && !userAgent.includes('fxios')

  return isMac && isSafari
}

function detectAndroid() {
  if (typeof navigator === 'undefined') return false

  return navigator.userAgent.toLowerCase().includes('android')
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

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
  }, [])

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
    canPromptInstall: Boolean(deferredPrompt) && !isInstalled,
    isInstalled,
    manualInstallMode: !isInstalled
      ? (detectIosSafari()
          ? 'ios-safari'
          : detectMacSafari()
            ? 'mac-safari'
            : detectAndroid()
              ? 'android'
              : null)
      : null,
    promptInstall,
  }
}
