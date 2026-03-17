import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, Mail, Mic, CheckCircle2, AlertTriangle, Users } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { acceptIdeaInvite, getIdeaInvitePreview } from '../lib/shareIdeas'

export function AcceptInvite() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') || ''
  const { user, loading, signInWithEmail, signInWithGoogle } = useAuth()

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
    status: 'pending' | 'accepted' | 'revoked' | 'expired'
    expiresAt: string
  } | null>(null)

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
    if (!token || loading || !user || accepting || successMessage) return

    void (async () => {
      setAccepting(true)
      setError(null)

      try {
        const result = await acceptIdeaInvite(token)
        setSuccessMessage(`A ideia "${result.ideaTitle}" agora esta disponivel na sua conta.`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nao foi possivel aceitar o convite.')
      } finally {
        setAccepting(false)
      }
    })()
  }, [accepting, loading, successMessage, token, user])

  const expiresAtLabel = preview?.expiresAt
    ? new Date(preview.expiresAt).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    : null

  async function handleEmailLogin(event: React.FormEvent) {
    event.preventDefault()
    if (!email.trim()) return

    setError(null)
    try {
      await signInWithEmail(email.trim(), window.location.href)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel enviar o link.')
    }
  }

  async function handleGoogleLogin() {
    setError(null)
    try {
      await signInWithGoogle(window.location.href)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel entrar com Google.')
    }
  }

  function goToSharedIdeas() {
    navigate('/organized?tab=shared&accepted=1')
  }

  return (
    <div className="min-h-screen bg-surface px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
            <Mic className="h-8 w-8 text-white" />
          </div>
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
          ) : (
            <>
              {preview && (
                <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                    <Users className="h-3.5 w-3.5" />
                    v0.2 compartilhamento
                  </div>
                  <h2 className="text-lg font-semibold text-gray-900">{preview.ideaTitle}</h2>
                  <p className="mt-2 text-sm text-gray-600">
                    Convite enviado para <strong>{preview.recipientEmail}</strong>
                  </p>
                  {expiresAtLabel && (
                    <p className="mt-1 text-xs text-gray-500">Expira em {expiresAtLabel}</p>
                  )}
                </div>
              )}

              {successMessage ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                      <div>
                        <p className="text-sm font-medium text-green-800">Convite aceito</p>
                        <p className="mt-1 text-sm text-green-700">{successMessage}</p>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={goToSharedIdeas}
                    className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
                  >
                    Abrir ideias compartilhadas
                  </button>
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
                <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center">
                  <Mail className="mx-auto mb-3 h-10 w-10 text-green-500" />
                  <p className="font-medium text-green-800">Link enviado</p>
                  <p className="mt-1 text-sm text-green-700">
                    Verifique o email <strong>{email}</strong> e abra o link para voltar a este convite.
                  </p>
                </div>
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
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                </div>
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
