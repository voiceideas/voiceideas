import { useState } from 'react'
import { Download, Share2, X } from 'lucide-react'
import { useInstallPrompt } from '../hooks/useInstallPrompt'

const DISMISS_KEY = 'voiceideas-install-banner-dismissed'

export function InstallBanner() {
  const { canPromptInstall, isInstalled, manualInstallMode, promptInstall } = useInstallPrompt()
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false

    return window.sessionStorage.getItem(DISMISS_KEY) === '1'
  })
  const [showManualSteps, setShowManualSteps] = useState(false)
  const isManualInstallOnly = Boolean(manualInstallMode)

  if (isInstalled || dismissed || (!canPromptInstall && !isManualInstallOnly)) {
    return null
  }

  const dismiss = () => {
    setDismissed(true)
    window.sessionStorage.setItem(DISMISS_KEY, '1')
  }

  const handleInstallClick = async () => {
    if (canPromptInstall) {
      const installed = await promptInstall()

      if (installed) {
        window.sessionStorage.removeItem(DISMISS_KEY)
      }

      return
    }

    setShowManualSteps((current) => !current)
  }

  return (
    <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-primary">
            <Download className="h-4 w-4" />
            <p className="text-sm font-semibold">Instalar app</p>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {canPromptInstall
              ? 'Instale o VoiceIdeas para abrir mais rapido e usar com cara de app.'
              : manualInstallMode === 'android'
                ? 'No Android, voce pode instalar pelo menu do navegador mesmo quando o prompt automatico nao aparecer.'
                : 'No Safari, a instalacao e manual usando o menu do proprio navegador.'}
          </p>
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-white hover:text-gray-600"
          aria-label="Fechar aviso de instalacao"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
        >
          {canPromptInstall ? <Download className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
          {canPromptInstall ? 'Instalar agora' : 'Ver como instalar'}
        </button>
      </div>

      {showManualSteps && (
        <p className="mt-3 text-sm text-gray-600">
          {manualInstallMode === 'android' ? (
            <>
              No Android, abra o menu do navegador e use <span className="font-medium">Instalar app</span>.
              Se essa opcao nao aparecer, use <span className="font-medium">Adicionar a tela inicial</span>.
            </>
          ) : manualInstallMode === 'mac-safari' ? (
            <>
              No Safari do Mac, use <span className="font-medium">Arquivo</span> e depois
              <span className="font-medium"> Adicionar ao Dock</span>.
            </>
          ) : (
            <>
              No Safari do iPhone, toque em <span className="font-medium">Compartilhar</span> e depois em
              <span className="font-medium"> Adicionar a Tela de Inicio</span>.
            </>
          )}
        </p>
      )}
    </div>
  )
}
