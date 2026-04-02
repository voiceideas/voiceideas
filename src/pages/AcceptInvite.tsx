import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, Mail, AlertTriangle, Users } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
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

  const [previewLoading, setPreviewLoading] = useState(!!token)
  const [accepting, setAccepting] = useState(false)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(
    token ? null : 'Esse link de convite esta incompleto.',
  )
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    ideaTitle: string
    recipientEmail: string
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
        setEmail(data.recipientEmail)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Nao foi possivel carregar o convite.')
      })
      .finally(() => setPreviewLoading(false))
  }, [token])

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
        setSuccessMessage(`A ideia "${result.ideaTitle}" agora esta disponivel na sua conta.`)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nao foi possivel aceitar o convite.'
        const expectedEmail = preview?.recipientEmail || ''
        const currentEmail = user.email || ''
        const isEmailMismatch = !!(
          expectedEmail &&
          currentEmail &&
          normalizeEmail(expectedEmail) !== normalizeEmail(currentEmail) &&
          message.toLowerCase().includes('esse convite foi enviado para')
        )

        if (isEmailMismatch) {
          setAccountMismatch({
            expectedEmail,
            currentEmail,
          })
          setError(null)
          return
        }

        setError(message)
      } finally {
        setAccepting(false)
      }
    })()
  }, [accepting, accountMismatch, loading, preview?.recipientEmail, previewLoading, successMessage, token, user])

  const expiresAtLabel = preview?.expiresAt
    ? new Date(preview.expiresAt).toLocaleDateString('pt-BR', {
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
      setError(err instanceof Error ? err.message : 'Nao foi possivel enviar o link.')
    }
  }

  async function handleGoogleLogin() {
    setError(null)
    try {
      await signInWithGoogle(authRedirectTarget)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel entrar com Google.')
    }
  }

  async function handleSwitchAccount() {
    setSwitchingAccount(true)
    setError(null)

    try {
      await signOut()
      setSent(false)
      if (preview?.recipientEmail) {
        setEmail(preview.recipientEmail)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel sair da conta atual.')
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
          <h1 className="text-2xl font-bold text-gray-900">Convite para ideia compartilhada</h1>
          <p className="mt-2 text-sm text-gray-500">
            Entre com o email correto para receber essa ideia no seu VoiceIdeas.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          {previewLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !preview ? (
            <div className="space-y-4">
              <StatusBanner variant="error" title="Convite indisponivel">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error || 'Nao foi possivel abrir este convite.'}</span>
                </div>
              </StatusBanner>

              <Link
                to="/organized"
                className="block w-full rounded-xl border border-gray-200 px-4 py-3 text-center text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Voltar para o VoiceIdeas
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  <Users className="h-3.5 w-3.5" />
                  convite do VoiceIdeas
                </div>
                <h2 className="text-lg font-semibold text-gray-900">{preview.ideaTitle}</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Convite enviado para <strong>{preview.recipientEmail}</strong>
                </p>
                {expiresAtLabel && (
                  <p className="mt-1 text-xs text-gray-500">Expira em {expiresAtLabel}</p>
                )}
              </div>

              {successMessage ? (
                <div className="space-y-4">
                  <StatusBanner variant="success" title="Convite aceito">
                    {successMessage}
                  </StatusBanner>
                  <button
                    type="button"
                    onClick={goToSharedIdeas}
                    className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
                  >
                    Abrir ideias compartilhadas
                  </button>
                </div>
              ) : user && accountMismatch ? (
                <div className="space-y-4">
                  <StatusBanner variant="info" title="Conta diferente do convite">
                    <p>Este convite foi enviado para outro email. Entre com a conta correta para continuar.</p>
                    <p className="mt-1">
                      Convite para <strong>{accountMismatch.expectedEmail}</strong>. Voce entrou como <strong>{accountMismatch.currentEmail}</strong>.
                    </p>
                  </StatusBanner>

                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
                    Saia desta conta para voltar as opcoes de login e entrar com o email do convite.
                  </div>

                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={handleSwitchAccount}
                      disabled={switchingAccount}
                      className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-primary/60"
                    >
                      {switchingAccount ? 'Saindo...' : 'Trocar de conta'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSwitchAccount}
                      disabled={switchingAccount}
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                    >
                      Sair e entrar novamente
                    </button>
                  </div>
                </div>
              ) : user ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
                    {accepting
                      ? 'Validando seu convite e conectando a ideia na sua conta...'
                      : `Voce entrou como ${user.email || 'usuario autenticado'}.`}
                  </div>
                  {accepting && (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  )}
                </div>
              ) : sent ? (
                <StatusBanner variant="success" title="Link enviado" className="text-center">
                  <Mail className="mx-auto mb-3 h-10 w-10 text-green-500" />
                  <p className="mt-1 text-sm">
                    Verifique o email <strong>{email}</strong> e abra o link para voltar a este convite.
                  </p>
                </StatusBanner>
              ) : (
                <div className="space-y-4">
                  <form onSubmit={handleEmailLogin} className="space-y-3">
                    <label className="block text-sm font-medium text-gray-700">
                      Entre com o email do convite
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      aria-label="Email do convite"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
                      required
                    />
                    <button
                      type="submit"
                      className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
                    >
                      Receber link por email
                    </button>
                  </form>

                  <div className="relative py-1 text-center text-xs text-gray-400">
                    <span className="bg-white px-2">ou</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Entrar com Google
                  </button>

                  <p className="text-xs text-gray-500">
                    Se voce ainda nao tiver conta, esse fluxo ja serve como seu primeiro acesso.
                    O importante e entrar com o mesmo email do convite.
                  </p>
                </div>
              )}

              {error && (
                <StatusBanner variant="error" title="Nao foi possivel concluir o convite" className="mt-4">
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
          Ja esta no app? <Link to="/organized" className="font-medium text-primary hover:underline">Abrir ideias organizadas</Link>
        </p>
      </div>
    </div>
  )
}
