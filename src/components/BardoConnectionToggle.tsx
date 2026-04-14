/**
 * Toggle de consentimento para a ponte Bardo.
 * Quando desabilitado, o botão "Enviar ao Bardo" não aparece nos cards.
 *
 * Identidade: email verificado é a ponte — não há account linking.
 * Consentimento: este toggle = aceite explícito do usuário.
 */

import { Loader2 } from 'lucide-react'

interface BardoConnectionToggleProps {
  enabled: boolean
  loading: boolean
  onToggle: (enabled: boolean) => Promise<boolean | undefined>
}

export function BardoConnectionToggle({ enabled, loading, onToggle }: BardoConnectionToggleProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Carregando...</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <button
        role="switch"
        aria-checked={enabled}
        onClick={() => onToggle(!enabled)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 ${
          enabled ? 'bg-purple-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      <div>
        <p className="text-sm font-medium text-gray-700">
          Ponte Bardo {enabled ? 'ativa' : 'inativa'}
        </p>
        <p className="text-xs text-gray-500">
          {enabled
            ? 'Você pode enviar notas para o Bardo Script App'
            : 'Ative para enviar notas ao Bardo'}
        </p>
      </div>
    </div>
  )
}
