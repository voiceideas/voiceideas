/**
 * SignedInAccountCard — exibe identidade VI atual + status do vínculo Bardo.
 *
 * VI_BRIDGE.UX_STATE_AND_PREFS.1 (2026-05-12):
 *   Antes não havia indicação visual de qual conta VI estava logada nem do
 *   estado do vínculo VI↔Bardo. Settings mostrava apenas "Foundation ready
 *   for a future Bardo connection" mesmo quando a ponte estava ativa.
 *
 * Conteúdo:
 *   - email do usuário VI logado (não expõe JWT/token)
 *   - id parcial do user (8 chars) para fins de debug do operador
 *   - status do vínculo Bardo:
 *       sem vínculo / vinculado (mostra bardo_email se houver)
 *
 * Self-contained: faz seu próprio fetch via `bardoAccountLinkService` em vez
 * de depender do hook `useBardoAccountLink` (que existe em working tree do
 * Gian mas não está commitado).
 */

import { useEffect, useState } from 'react'
import { Link2, Link2Off, Loader2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../hooks/useI18n'
import { getActiveBardoAccountLink } from '../../services/bardoAccountLinkService'
import type { BardoAccountLink } from '../../types/database'
import { UserAvatar, getUserDisplayName } from '../UserAvatar'

export function SignedInAccountCard() {
  const { user } = useAuth()
  const { t, formatDate } = useI18n()
  const [link, setLink] = useState<BardoAccountLink | null>(null)
  const [linkLoading, setLinkLoading] = useState(true)
  const [linkError, setLinkError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!user) {
      setLink(null)
      setLinkLoading(false)
      return () => {
        cancelled = true
      }
    }

    setLinkLoading(true)
    setLinkError(null)
    getActiveBardoAccountLink()
      .then((result) => {
        if (cancelled) return
        setLink(result)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t('signedInAccount.linkQueryError')
        setLinkError(message)
      })
      .finally(() => {
        if (cancelled) return
        setLinkLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [user, t])

  if (!user) return null

  const partialId = user.id.slice(0, 8)
  const email = user.email ?? t('signedInAccount.noEmail')
  const displayName = getUserDisplayName(user)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <UserAvatar user={user} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{t('signedInAccount.title')}</p>
          {displayName && (
            <p className="mt-0.5 text-sm text-slate-900">{displayName}</p>
          )}
          <p className="mt-1 text-xs text-slate-600">
            {t('signedInAccount.loggedInAs')} <span className="font-medium text-slate-900">{email}</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-400">{t('signedInAccount.idPrefix')} {partialId}…</p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        {linkLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('signedInAccount.checkingLink')}
          </div>
        ) : linkError ? (
          <div className="text-xs text-amber-700">
            {t('signedInAccount.linkCheckError')}
          </div>
        ) : link ? (
          <div className="flex items-start gap-2">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0 text-xs text-slate-700">
              <p>
                <span className="font-medium text-slate-900">{t('signedInAccount.bardoConnected')}</span>{' '}
                {t('signedInAccount.activeLinkSuffix')} <code>bardo_account_links</code>.
              </p>
              {link.bardo_email && (
                <p className="mt-1 text-slate-500">
                  {t('signedInAccount.associatedAccountPrefix')} <span className="font-medium text-slate-700">{link.bardo_email}</span>
                </p>
              )}
              <p className="mt-1 text-[11px] text-slate-400">
                {t('signedInAccount.bardoUserIdPrefix')} {link.bardo_user_id.slice(0, 8)}… {t('signedInAccount.linkedAtPrefix')}{' '}
                {formatDate(link.linked_at, { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <Link2Off className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <div className="text-xs text-slate-600">
              <p>
                <span className="font-medium text-slate-900">{t('signedInAccount.bardoNoActiveLink')}</span>
              </p>
              <p className="mt-1 text-slate-500">
                {t('signedInAccount.toConnectHint')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
