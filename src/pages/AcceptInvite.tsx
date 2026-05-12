import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, Mail, AlertTriangle, Users } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../hooks/useI18n'
import { StatusBanner } from '../components/StatusBanner'
import { VoiceIdeasAppIcon } from '../components/VoiceIdeasIcons'
import { getAuthRedirectUrl } from '../lib/platform'
import { acceptIdeaInvite, buildInvitePageUrl, getIdeaInvitePreview } from '../lib/shareIdeas'

interface InviteAccountMismatch {
  expectedEmail: string
  currentEmail: string
}

function normalizeEmail(email: string | null | undefined) {
  return (email || '').trim().toLowerCase()
}

export function AcceptInvite() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') || ''
  const { user, loading, signInWithEmail, signInWithGoogle, signOut } = useAuth()
  const { t, locale, formatDate } = useI18n()

  const [previewLoading, setPreviewLoading] = useState(!!token)
  const [accepting, setAccepting] = useState(false)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(
    token ? null : t('invite.error.linkIncomplete'),
  )
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    ideaTitle: string
    recipientEmailMasked: string
    expiresAt: string
  } | null>(null)
  const [accountMismatch, setAccountMismatch] = useState<InviteAccountMismatch | null>(null)
  const [switchingAccount, setSwitchingAccount] = useState(false)

  useEffect(() => {
    if (!token) return

    setPreviewLoading(true)
    setError(null)

    void getIdeaInvitePreview(token)
      .then((data) => {
        setPreview(data)
      })
      .catch((err) => {
        // VI_I18N.SMOKE.1: backend (Supabase edge) retorna mensagens em pt-BR
        // fixas. Em locale != pt-BR, suprimimos a mensagem do servidor e usamos
        // o fallback i18n para evitar leak de português na UI en/es.
        const rawMessage = err instanceof Error ? err.message : t('invite.error.loadPreview')
        setError(locale === 'pt-BR' ? rawMessage : t('invite.error.loadPreview'))
      })
      .finally(() => setPreviewLoading(false))
  }, [token, t, locale])

  useEffect(() => {
    if (!user) {
      setAccountMismatch(null)
      return
    }

    if (
      accountMismatch &&
      normalizeEmail(accountMismatch.currentEmail) !== normalizeEmail(user.email)
    ) {
      setAccountMismatch(null)
    }
  }, [accountMismatch, user])

  useEffect(() => {
    const isBlockedByMismatch = !!(
      user &&
      accountMismatch &&
      normalizeEmail(accountMismatch.currentEmail) === normalizeEmail(user.email)
    )

    if (
      !token ||
      loading ||
      previewLoading ||
      !user ||
      accepting ||
      successMessage ||
      isBlockedByMismatch
    ) {
      return
    }

    void (async () => {
      setAccepting(true)
      setError(null)

      try {
        const result = await acceptIdeaInvite(token)
        setAccountMismatch(null)
        setSuccessMessage(t('invite.successMessage', { ideaTitle: result.ideaTitle }))
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : t('invite.error.acceptFailed')
        const expectedEmail = preview?.recipientEmailMasked || t('invite.fallbackExpectedEmail')
        const currentEmail = user.email || ''
        // The "mesmo email do convite" heuristic checks the backend message
        // (pt-BR fixed) regardless of UI locale — backend always returns pt-BR.
        const isEmailMismatch = !!(
          expectedEmail &&
          currentEmail &&
          rawMessage.toLowerCase().includes('mesmo email do convite')
        )

        if (isEmailMismatch) {
          setAccountMismatch({
            expectedEmail,
            currentEmail,
          })
          setError(null)
          return
        }

        // Para outras falhas, suprimir mensagem PT do servidor em locales não-PT
        setError(locale === 'pt-BR' ? rawMessage : t('invite.error.acceptFailed'))
      } finally {
        setAccepting(false)
      }
    })()
  }, [accepting, accountMismatch, loading, preview?.recipientEmailMasked, previewLoading, successMessage, token, user, t, locale])

  const expiresAtLabel = preview?.expiresAt
    ? formatDate(preview.expiresAt, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    : null

  const inviteAuthReturnUrl = token && typeof window !== 'undefined'
    ? buildInvitePageUrl(token, window.location.origin)
    : buildInvitePageUrl(token)

  const authRedirectTarget = token
    ? getAuthRedirectUrl({ webUrl: inviteAuthReturnUrl })
    : getAuthRedirectUrl({ webUrl: window.location.href })

  async function handleEmailLogin(event: React.FormEvent) {
    event.preventDefault()
    if (!email.trim()) return

    setError(null)
    try {
      await signInWithEmail(email.trim(), authRedirectTarget)
      setSent(true)
    } catch (err) {
      const raw = err instanceof Error ? err.message : t('invite.error.sendLink')
      setError(locale === 'pt-BR' ? raw : t('invite.error.sendLink'))
    }
  }

  async function handleGoogleLogin() {
    setError(null)
    try {
      await signInWithGoogle(authRedirectTarget)
    } catch (err) {
      const raw = err instanceof Error ? err.message : t('invite.error.googleLogin')
      setError(locale === 'pt-BR' ? raw : t('invite.error.googleLogin'))
    }
  }

  async function handleSwitchAccount() {
    setSwitchingAccount(true)
    setError(null)

    try {
      await signOut()
      setSent(false)
    } catch (err) {
      const raw = err instanceof Error ? err.message : t('invite.error.signOut')
      setError(locale === 'pt-BR' ? raw : t('invite.error.signOut'))
    } finally {
      setSwitchingAccount(false)
    }
  }

  function goToSharedIdeas() {
    navigate('/organized?tab=shared&accepted=1')
  }

  return (
    <div className="min-h-screen bg-surface px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-8 text-center">
          <VoiceIdeasAppIcon className="mx-auto mb-4 h-16 w-16 rounded-2xl" alt="VoiceIdeas" />
          <h1 className="text-2xl font-bold text-gray-900">{t('invite.title')}</h1>
          <p className="mt-2 text-sm text-gray-500">
            {t('invite.subtitle')}
          </p>
        </div>

        <div className="rounded-[28px] border border-black/6 bg-white/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.08)] backdrop-blur-xl">
          {previewLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !preview ? (
            <div className="space-y-4">
              <StatusBanner variant="error" title={t('invite.unavailable.title')}>
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error || t('invite.unavailable.fallback')}</span>
                </div>
              </StatusBanner>

              <Link
                to="/organized"
                className="block w-full rounded-xl border border-gray-200 px-4 py-3 text-center text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                {t('invite.backToApp')}
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-5 rounded-2xl border border-slate-300 bg-gradient-to-br from-slate-100 to-stone-100 p-4">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  <Users className="h-3.5 w-3.5" />
                  {t('invite.badge')}
                </div>
                <h2 className="text-lg font-semibold text-gray-900">{preview.ideaTitle}</h2>
                <p className="mt-2 text-sm text-gray-600">
                  {t('invite.sentToPrefix')} <strong>{preview.recipientEmailMasked}</strong>
                </p>
                {expiresAtLabel && (
                  <p className="mt-1 text-xs text-gray-500">{t('invite.expiresPrefix')} {expiresAtLabel}</p>
                )}
              </div>

              {successMessage ? (
                <div className="space-y-4">
                  <StatusBanner variant="success" title={t('invite.accepted.title')}>
                    {successMessage}
                  </StatusBanner>
                  <button
                    type="button"
                    onClick={goToSharedIdeas}
                    className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
                  >
                    {t('invite.openSharedIdeas')}
                  </button>
                </div>
              ) : user && accountMismatch ? (
                <div className="space-y-4">
                  <StatusBanner variant="info" title={t('invite.accountMismatch.title')}>
                    <p>{t('invite.accountMismatch.body')}</p>
                    <p className="mt-1">
                      {t('invite.accountMismatch.invitePrefix')} <strong>{accountMismatch.expectedEmail}</strong>. {t('invite.accountMismatch.youAre')} <strong>{accountMismatch.currentEmail}</strong>.
                    </p>
                  </StatusBanner>

                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
                    {t('invite.accountMismatch.logoutHint')}
                  </div>

                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={handleSwitchAccount}
                      disabled={switchingAccount}
                      className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-primary/60"
                    >
                      {switchingAccount ? t('invite.accountMismatch.switching') : t('invite.accountMismatch.switch')}
                    </button>
                    <button
                      type="button"
                      onClick={handleSwitchAccount}
                      disabled={switchingAccount}
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                    >
                      {t('invite.accountMismatch.signOutAndIn')}
                    </button>
                  </div>
                </div>
              ) : user ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
                    {accepting
                      ? t('invite.validating')
                      : t('invite.signedInAs', { email: user.email || t('invite.unknownUser') })}
                  </div>
                  {accepting && (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  )}
                </div>
              ) : sent ? (
                <StatusBanner variant="success" title={t('invite.linkSent.title')} className="text-center">
                  <Mail className="mx-auto mb-3 h-10 w-10 text-green-500" />
                  <p className="mt-1 text-sm">
                    {t('invite.linkSent.body', { email })}
                  </p>
                </StatusBanner>
              ) : (
                <div className="space-y-4">
                  <form onSubmit={handleEmailLogin} className="space-y-3">
                    <label className="block text-sm font-medium text-gray-700">
                      {t('invite.form.emailLabel')}
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      aria-label={t('invite.form.emailAria')}
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
                      required
                    />
                    <button
                      type="submit"
                      className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
                    >
                      {t('invite.form.submit')}
                    </button>
                  </form>

                  <div className="relative py-1 text-center text-xs text-gray-400">
                    <span className="bg-white px-2">{t('common.or')}</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    {t('invite.googleButton')}
                  </button>

                  <p className="text-xs text-gray-500">
                    {t('invite.firstAccess')}
                  </p>
                </div>
              )}

              {error && (
                <StatusBanner variant="error" title={t('invite.error.title')} className="mt-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                </StatusBanner>
              )}
            </>
          )}
        </div>

        <p className="mt-5 text-center text-sm text-gray-500">
          {t('invite.alreadyInApp')} <Link to="/organized" className="font-medium text-primary hover:underline">{t('invite.openOrganizedIdeas')}</Link>
        </p>
      </div>
    </div>
  )
}
