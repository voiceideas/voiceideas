/**
 * Toggle de conexão com o Bardo.
 *
 * A partir de P1.4 o toggle deixou de ser puramente consentimento local.
 * Ele agora orquestra o produtor de vínculo explícito (bardo_account_links):
 *
 *   - Ligar o toggle abre um formulário onde o usuário informa o
 *     identificador opaco da conta Bardo (bardo_user_id) e, opcionalmente,
 *     o email Bardo para auditoria.
 *   - A gravação chama a edge function link-bardo-account, que persiste
 *     o vínculo com vi_user_id = auth.uid() e link_status='active'.
 *   - Desligar o toggle revoga todos os vínculos ativos do usuário VI.
 *   - O flag local bardo_bridge_enabled em user_settings continua sendo
 *     atualizado em paralelo para preservar o UX de "aceite explícito".
 *
 * Autorização da ponte passou a ser o vínculo — email não autoriza nada.
 */

import { useCallback, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useBardoAccountLink } from '../hooks/useBardoAccountLink'
import { useI18n } from '../hooks/useI18n'

interface BardoConnectionToggleProps {
  enabled: boolean
  loading: boolean
  onToggle: (enabled: boolean) => Promise<boolean | undefined>
}

export function BardoConnectionToggle({ enabled, loading, onToggle }: BardoConnectionToggleProps) {
  const { t } = useI18n()
  const {
    link,
    loading: linkLoading,
    saving,
    error,
    isLinked,
    linkAccount,
    revokeAccount,
  } = useBardoAccountLink()

  const [formOpen, setFormOpen] = useState(false)
  const [bardoUserId, setBardoUserId] = useState('')
  const [bardoEmail, setBardoEmail] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const busy = loading || linkLoading || saving

  const handleToggle = useCallback(async (next: boolean) => {
    setLocalError(null)
    if (next) {
      // Ativar: abre form para captura de bardo_user_id. Persistência
      // do consentimento local só acontece após vínculo bem-sucedido.
      setFormOpen(true)
      return
    }

    try {
      await revokeAccount()
      await onToggle(false)
      setFormOpen(false)
      setBardoUserId('')
      setBardoEmail('')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Erro ao revogar vínculo')
    }
  }, [onToggle, revokeAccount])

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault()
    setLocalError(null)

    const trimmedId = bardoUserId.trim()
    if (!trimmedId) {
      setLocalError('Informe o ID da conta Bardo')
      return
    }

    try {
      await linkAccount({ bardoUserId: trimmedId, bardoEmail: bardoEmail.trim() || null })
      await onToggle(true)
      setFormOpen(false)
      setBardoEmail('')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Erro ao vincular conta Bardo')
    }
  }, [bardoUserId, bardoEmail, linkAccount, onToggle])

  if (loading || linkLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{t('common.loading')}</span>
      </div>
    )
  }

  const displayedEnabled = enabled && isLinked

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          role="switch"
          aria-checked={displayedEnabled}
          disabled={busy}
          onClick={() => handleToggle(!displayedEnabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 disabled:opacity-50 ${
            displayedEnabled ? 'bg-purple-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
              displayedEnabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
        <div>
          <p className="text-sm font-medium text-gray-700">
            {displayedEnabled ? t('bardoConnection.bridgeActive') : t('bardoConnection.bridgeInactive')}
          </p>
          <p className="text-xs text-gray-500">
            {displayedEnabled
              ? link?.bardo_email
                ? t('bardoConnection.linkedEmail', { email: link.bardo_email })
                : t('bardoConnection.linkedNoEmail')
              : t('bardoConnection.activatePrompt')}
          </p>
        </div>
      </div>

      {formOpen && !displayedEnabled && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-2 rounded-md border border-purple-200 bg-purple-50/40 p-3"
        >
          <p className="text-xs text-gray-600">
            {t('bardoConnection.formHelp')}
          </p>
          <label className="text-xs text-gray-700">
            {t('bardoConnection.bardoIdLabel')} <span className="text-red-500">{t('bardoConnection.bardoIdRequired')}</span>
            <input
              type="text"
              value={bardoUserId}
              onChange={(e) => setBardoUserId(e.target.value)}
              placeholder={t('bardoConnection.bardoIdPlaceholder')}
              autoComplete="off"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-purple-500 focus:outline-none"
              disabled={saving}
            />
          </label>
          <label className="text-xs text-gray-700">
            {t('bardoConnection.emailLabel')}
            <input
              type="email"
              value={bardoEmail}
              onChange={(e) => setBardoEmail(e.target.value)}
              placeholder={t('bardoConnection.emailPlaceholder')}
              autoComplete="off"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-purple-500 focus:outline-none"
              disabled={saving}
            />
          </label>
          {(localError || error) && (
            <p className="text-xs text-red-600">{localError || error}</p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving || !bardoUserId.trim()}
              className="rounded bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {saving ? t('bardoConnection.linking') : t('bardoConnection.linkButton')}
            </button>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false)
                setBardoUserId('')
                setBardoEmail('')
                setLocalError(null)
              }}
              disabled={saving}
              className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {displayedEnabled && link?.bardo_user_id && (
        <p className="text-[11px] text-gray-500">
          {/* VI_BARDO.IDENTITY_LINK_HARDENING.C1: nunca renderizar bardo_user_id completo. */}
          {t('bardoConnection.linkedIdPrefix')} <code className="rounded bg-gray-100 px-1">{link.bardo_user_id.slice(0, 8)}…</code>
        </p>
      )}

      {localError && !formOpen && (
        <p className="text-xs text-red-600">{localError}</p>
      )}
    </div>
  )
}
