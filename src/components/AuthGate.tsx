import { useState } from 'react'
import { Mail, Loader2, AlertTriangle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { isIPadNativeShellApp, isNativeShellApp } from '../lib/platform'
import { isSupabaseConfigured } from '../lib/supabase'
import { InstallBanner } from './InstallBanner'
import { VoiceIdeasAppIcon } from './VoiceIdeasIcons'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, nativeAuthPending, resumePendingAuth, signInWithEmail, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [signingInWithGoogle, setSigningInWithGoogle] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isNativeShell = isNativeShellApp()
  const isIPad = isIPadNativeShellApp()

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface px-4">
        <div className="w-full max-w-md text-center">
          <VoiceIdeasAppIcon className="w-16 h-16 mx-auto mb-4 rounded-2xl" alt="VoiceIdeas" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">VoiceIdeas</h1>
          <p className="text-gray-500 text-sm mb-6">
            Capture suas ideias por voz e organize com IA
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-left">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h2 className="font-semibold text-amber-800 text-sm">Configuracao Necessaria</h2>
            </div>
            <p className="text-amber-700 text-sm mb-3">
              Para usar o app, configure o Supabase criando um arquivo <code className="bg-amber-100 px-1 rounded">.env</code> na raiz do projeto:
            </p>
            <div className="bg-amber-100 rounded-lg p-3 font-mono text-xs text-amber-900">
              <p>VITE_SUPABASE_URL=https://seu-projeto.supabase.co</p>
              <p>VITE_SUPABASE_ANON_KEY=sua-anon-key</p>
            </div>
            <p className="text-amber-600 text-xs mt-3">
              Crie um projeto gratuito em supabase.com e copie as credenciais de Settings &gt; API.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    )
  }

  if (user) {
    return <>{children}</>
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setError(null)
    try {
      await signInWithEmail(email)
      setSent(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar link')
    } finally {
      setSending(false)
    }
  }

  const handleGoogleLogin = async () => {
    setSigningInWithGoogle(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar com Google')
    } finally {
      setSigningInWithGoogle(false)
    }
  }

  return (
    <div className="app-shell bg-surface">
      <div className="app-safe-top sticky top-0 z-20">
        <InstallBanner />
      </div>

      <div className="app-safe-bottom flex min-h-[100dvh] items-center justify-center px-4 py-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <VoiceIdeasAppIcon className="mx-auto mb-4 h-16 w-16 rounded-2xl shadow-[0_18px_40px_rgba(0,0,0,0.12)]" alt="VoiceIdeas" />
            <h1 className="text-2xl font-bold text-gray-900">VoiceIdeas</h1>
            <p className="text-gray-500 mt-2 text-sm">
              Capture suas ideias por voz e organize com IA
            </p>
          </div>

          {(nativeAuthPending || (sent && isNativeShell)) && (
            <div className="mb-4 rounded-[24px] border border-black/8 bg-black/[0.03] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.06)]">
              <p className="text-sm font-medium text-zinc-900">
                {nativeAuthPending ? 'Voltando para o app...' : 'Login enviado para continuar no app'}
              </p>
              <p className="mt-1 text-sm text-zinc-600">
                {isIPad
                  ? 'No iPad, conclua o login e toque em Abrir quando o sistema pedir para voltar ao VoiceIdeas.'
                  : 'Conclua o login no navegador ou no email e volte para o VoiceIdeas para terminar a entrada.'}
              </p>
              {nativeAuthPending && (
                <button
                  type="button"
                  onClick={() => { void resumePendingAuth() }}
                  className="mt-3 inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
                >
                  Ja voltei para o app
                </button>
              )}
            </div>
          )}

          {sent ? (
            <div className="rounded-[28px] border border-emerald-200 bg-white/88 p-6 text-center shadow-[0_24px_70px_rgba(0,0,0,0.08)] backdrop-blur-xl">
              <Mail className="w-10 h-10 text-green-500 mx-auto mb-3" />
              <p className="text-green-800 font-medium">Link enviado!</p>
              <p className="text-green-600 text-sm mt-1">
                Verifique seu email ({email}) e clique no link para entrar.
              </p>
              {isNativeShell && (
                <p className="mt-3 text-xs text-zinc-500">
                  {isIPad
                    ? 'Depois de concluir o login, confirme Abrir para voltar ao app.'
                    : 'Depois de concluir o login, o app deve abrir novamente sozinho.'}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-[28px] border border-black/6 bg-white/88 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.08)] backdrop-blur-xl">
              <form onSubmit={handleEmailLogin} className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={sending}
                  className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark disabled:bg-primary/50 text-white py-3 px-4 rounded-lg text-sm font-medium transition-colors"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Mail className="w-4 h-4" />
                  )}
                  Entrar com Magic Link
                </button>
              </form>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-2 text-gray-400">ou</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => { void handleGoogleLogin() }}
                disabled={signingInWithGoogle}
                  className="w-full flex items-center justify-center gap-2 border border-gray-200 hover:bg-black/5 py-3 px-4 rounded-lg text-sm font-medium text-gray-700 transition-colors"
              >
                {signingInWithGoogle ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                )}
                {signingInWithGoogle ? 'Abrindo Google...' : 'Entrar com Google'}
              </button>

              {error && (
                <p className="text-red-500 text-sm text-center mt-3">{error}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
