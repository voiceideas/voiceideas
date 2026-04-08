import { useState } from 'react'
import { Download, Share2, X } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import { useInstallPrompt } from '../hooks/useInstallPrompt'

export function InstallBanner() {
  const { t } = useI18n()
  const { canPromptInstall, isInstalled, manualInstallMode, promptInstall } = useInstallPrompt()
  const [dismissed, setDismissed] = useState(false)
  const [showManualSteps, setShowManualSteps] = useState(false)
  const isManualInstallOnly = Boolean(manualInstallMode)

  if (isInstalled || dismissed || (!canPromptInstall && !isManualInstallOnly)) {
    return null
  }

  const dismiss = () => {
    setDismissed(true)
  }

  const handleInstallClick = async () => {
    if (canPromptInstall) {
      const installed = await promptInstall()

      if (installed) {
        setDismissed(false)
      }

      return
    }

    setShowManualSteps((current) => !current)
  }

  return (
    <div className="border-b border-black/6 bg-white/78 backdrop-blur-xl">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-2 text-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-primary">
          <Download className="h-4 w-4 shrink-0" />
          <p className="truncate font-medium">
            {canPromptInstall
              ? t('install.promptDefault')
              : manualInstallMode === 'android'
                ? t('install.promptAndroid')
                : t('install.promptApple')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleInstallClick()}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.16)] transition-colors hover:bg-primary-dark"
        >
          {canPromptInstall ? <Download className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
          {canPromptInstall ? t('install.button.install') : t('install.button.howTo')}
        </button>

        <button
          type="button"
          onClick={dismiss}
          className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-600"
          aria-label={t('install.dismiss')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {showManualSteps && (
        <div className="border-t border-black/6 bg-white/70">
          <p className="mx-auto max-w-2xl px-4 py-2 text-xs text-zinc-600">
            {manualInstallMode === 'android' ? (
              t('install.instructions.android')
            ) : (
              t('install.instructions.apple')
            )}
          </p>
        </div>
      )}
    </div>
  )
}
