/**
 * Página `/connect-bardo` — fluxo VI-initiated de criação de vínculo
 * explícito VI ↔ Bardo (SYSFIX.LINK.1 / VI_LINK.AUTO_ACCOUNT_LINK /
 * IDENTITY_LINK_HARDENING.R3).
 *
 * Como o Bardo entra aqui:
 *   O Bardo, após `bridge-identity-check` retornar `connected`, emite
 *   um bridge_nonce one-time (function `bridge-link-issue-nonce`,
 *   64 hex, TTL 5min) e redireciona o usuário para esta página com:
 *     - bridge_nonce   (R3 canônico, preferido)
 *     - bardo_user_id  (legacy, opaco) — fallback se bridge_nonce ausente
 *     - bardo_email    (legacy, snapshot)
 *     - return_url     (opcional, callback no domínio do Bardo)
 *     - state          (opcional, valor preservado no callback)
 *
 * Fluxo:
 *   1. Se há `bridge_nonce`: passa para a edge function. A edge
 *      consome o nonce no Bardo server-side com vi_user_email_hash,
 *      exige email_hash_match=true e só cria vínculo nesse caso.
 *   2. Se NÃO há `bridge_nonce` mas há `bardo_user_id`: tenta legacy.
 *      Edge function bloqueia em produção (ALLOW_LEGACY_BARDO_LINK=false).
 *   3. Se faltam ambos: erro claro; callback com
 *      `voiceideas_link=missing_bardo_user_id`.
 *   4. Se o usuário VI não está logado: preserva todos os query params
 *      e abre tela de login (email magic link ou Google). Após o
 *      callback do provedor de auth, volta para esta mesma URL com os
 *      params intactos, agora autenticado.
 *   5. Sucesso: se há `return_url` no allowlist, redireciona com
 *      `voiceideas_link=success`. Caso contrário mostra confirmação local.
 *
 * Segurança:
 *   - `vi_user_id` SEMPRE vem do JWT VI (auth.uid()) — esta página não
 *     aceita vi_user_id em nenhum lugar.
 *   - `return_url` é validado por allowlist (apenas obardo.app + localhost
 *     em DEV).
 *   - NÃO calculamos hash de email no cliente. NÃO chamamos
 *     bridge-link-consume-nonce direto do browser. NÃO usamos
 *     x-bridge-secret no cliente. Tudo isso fica server-side na edge
 *     function link-bardo-account.
 *   - Não logamos JWT, segredos ou body de erro completo.
 *   - Não usamos service role no cliente.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, CheckCircle2, AlertTriangle, Mail } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../hooks/useI18n'
import {
  BardoAccountLinkError,
  upsertBardoAccountLink,
} from '../services/bardoAccountLinkService'
import { VoiceIdeasAppIcon } from '../components/VoiceIdeasIcons'
import {
  buildBardoCallbackUrl,
  isAllowedBardoCallback,
  normalizeBardoState,
} from '../lib/bardoCallback'
import { getAuthRedirectUrl } from '../lib/platform'

type Phase =
  | 'validating'
  | 'missingParams'
  | 'needLogin'
  | 'linking'
  | 'success'
  | 'error'

const MAX_BARDO_USER_ID_LENGTH = 256
const MAX_BARDO_EMAIL_LENGTH = 320

// R3: nonce 64 hex emitido pelo Bardo. Validação leve no cliente
// (formato) — validação real é server-side na edge function.
const NONCE_HEX_REGEX = /^[0-9a-f]{64}$/i

function safeBridgeNonce(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!NONCE_HEX_REGEX.test(trimmed)) return null
  return trimmed
}

function safeBardoUserId(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_BARDO_USER_ID_LENGTH) return null
  return trimmed
}

function safeBardoEmail(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  if (trimmed.length > MAX_BARDO_EMAIL_LENGTH) return null
  // Sanity loose-check; não rejeita por regex pra não impedir
  // domínios estranhos legítimos. Email é hint, não autoridade.
  if (!trimmed.includes('@')) return null
  return trimmed
}

// VI_BARDO.IDENTITY_LINK_HARDENING.C1: normaliza email para comparação
// estrita (trim + lowercase). Email é hint no link legacy, mas quando
// presente e divergente é sinal forte de cross-account link (finding F2
// da audit 0.1.0, confirmado em produção em 2026-05-12 na row 2e266f5b).
function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  return trimmed || null
}

export function ConnectBardo() {
  const [searchParams] = useSearchParams()
  const { user, loading, signInWithEmail, signInWithGoogle } = useAuth()
  const { t, locale } = useI18n()

  // R3: bridge_nonce é o caminho canônico (Bardo 0.6.121+).
  const rawBridgeNonce = searchParams.get('bridge_nonce')
  // Legacy: bardo_user_id/bardo_email só são usados como fallback.
  const rawBardoUserId = searchParams.get('bardo_user_id')
  const rawBardoEmail = searchParams.get('bardo_email')
  // Aceita 3 aliases para a URL de retorno. O Bardo Cut 0.6.119 usa `return`;
  // mantemos `return_url` e `callback_url` como sinônimos seguros para evitar
  // novas regressões de naming. A validação contra o allowlist
  // (`isAllowedBardoCallback`) garante que nenhum alias abre buraco de
  // open-redirect.
  const rawReturnUrl =
    searchParams.get('return_url') ??
    searchParams.get('callback_url') ??
    searchParams.get('return')
  const rawState = searchParams.get('state')

  const bridgeNonce = useMemo(() => safeBridgeNonce(rawBridgeNonce), [rawBridgeNonce])
  const bardoUserId = useMemo(() => safeBardoUserId(rawBardoUserId), [rawBardoUserId])
  const bardoEmail = useMemo(() => safeBardoEmail(rawBardoEmail), [rawBardoEmail])
  const returnUrl = isAllowedBardoCallback(rawReturnUrl) ? rawReturnUrl : null
  const state = useMemo(() => normalizeBardoState(rawState), [rawState])

  const [phase, setPhase] = useState<Phase>('validating')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [googleOpening, setGoogleOpening] = useState(false)

  // Evita disparar o upsert mais de uma vez por mount.
  const linkAttemptedRef = useRef(false)

  const redirectToReturn = useCallback(
    (status: 'success' | 'missing_bardo_user_id' | 'error') => {
      if (!returnUrl) return
      const target = buildBardoCallbackUrl(returnUrl, { status, state })
      if (target && typeof window !== 'undefined') {
        // Pequeno delay para o usuário ver o estado de sucesso.
        const ms = status === 'success' ? 1200 : 0
        window.setTimeout(() => {
          window.location.replace(target)
        }, ms)
      }
    },
    [returnUrl, state],
  )

  const buildReturnHere = useCallback(() => {
    if (typeof window === 'undefined') return undefined
    return window.location.href
  }, [])

  // 1. Validação inicial: precisa de bridge_nonce (R3) OU bardo_user_id (legacy).
  useEffect(() => {
    if (!bridgeNonce && !bardoUserId) {
      setPhase('missingParams')
      redirectToReturn('missing_bardo_user_id')
    }
  }, [bridgeNonce, bardoUserId, redirectToReturn])

  // 2. Decide entre login pendente e linking quando auth terminar de carregar.
  useEffect(() => {
    if (!bridgeNonce && !bardoUserId) return
    if (loading) {
      setPhase('validating')
      return
    }
    if (!user) {
      setPhase('needLogin')
      return
    }
    if (linkAttemptedRef.current) return
    linkAttemptedRef.current = true
    setPhase('linking')

    // ─── R3: bridge_nonce (caminho canônico) ─────────────────────────
    // A edge function VI consome o nonce no Bardo server-side,
    // computa vi_user_email_hash com BRIDGE_EMAIL_HASH_SALT e exige
    // email_hash_match=true. Tudo é validado lá; aqui só fazemos
    // map de error_code → mensagem i18n.
    if (bridgeNonce) {
      void (async () => {
        try {
          await upsertBardoAccountLink({ bridgeNonce })
          setPhase('success')
          redirectToReturn('success')
        } catch (err) {
          const code = err instanceof BardoAccountLinkError ? err.code : null
          let msgKey:
            | 'connectBardo.error.identityMismatch'
            | 'connectBardo.error.nonceExpiredOrReused'
            | 'connectBardo.error.unverifiableIdentity'
            | 'connectBardo.error.linkFailed' = 'connectBardo.error.linkFailed'
          if (code === 'mismatch') msgKey = 'connectBardo.error.identityMismatch'
          else if (code === 'expired_nonce' || code === 'reused_nonce') {
            msgKey = 'connectBardo.error.nonceExpiredOrReused'
          } else if (
            code === 'unverifiable_identity' ||
            code === 'invalid_nonce' ||
            code === 'malformed_nonce'
          ) {
            msgKey = 'connectBardo.error.unverifiableIdentity'
          }
          setErrorMessage(t(msgKey))
          setPhase('error')
          redirectToReturn('error')
        }
      })()
      return
    }

    // ─── Legacy (bardo_user_id sem bridge_nonce) ─────────────────────
    // C1 manteve defesa client-side aqui. A edge function bloqueará em
    // produção (ALLOW_LEGACY_BARDO_LINK=false default). Só funciona em
    // dev/local. Mantemos o trecho original com a guarda de email
    // mismatch como segunda camada defensiva.
    const viEmail = normalizeEmail(user.email)
    const bardoEmailNormalized = normalizeEmail(bardoEmail)
    const bardoUserIdPrefix = bardoUserId!.slice(0, 8)

    if (viEmail && bardoEmailNormalized && viEmail !== bardoEmailNormalized) {
      console.warn('[connect-bardo] identity_mismatch', {
        event: 'identity_mismatch',
        source: 'connect_bardo',
        vi_user_id: user.id,
        vi_email: viEmail,
        bardo_email: bardoEmailNormalized,
        bardo_user_id_prefix: bardoUserIdPrefix,
        timestamp: new Date().toISOString(),
      })
      setErrorMessage(t('connectBardo.error.identityMismatch'))
      setPhase('error')
      redirectToReturn('error')
      return
    }

    if (!bardoEmailNormalized) {
      console.info('[connect-bardo] legacy_link_without_verified_bardo_email', {
        event: 'legacy_link_without_verified_bardo_email',
        source: 'connect_bardo',
        vi_user_id: user.id,
        bardo_user_id_prefix: bardoUserIdPrefix,
        timestamp: new Date().toISOString(),
      })
    }

    void (async () => {
      try {
        await upsertBardoAccountLink({
          bardoUserId: bardoUserId!,
          bardoEmail: bardoEmail ?? undefined,
        })
        setPhase('success')
        redirectToReturn('success')
      } catch (err) {
        const code = err instanceof BardoAccountLinkError ? err.code : null
        if (code === 'legacy_blocked') {
          setErrorMessage(t('connectBardo.error.legacyBlocked'))
        } else {
          const raw =
            err instanceof Error && err.message
              ? err.message
              : t('connectBardo.error.linkFailed')
          // Em locale != pt-BR, suprime mensagem PT do server.
          setErrorMessage(
            locale === 'pt-BR' ? raw : t('connectBardo.error.linkFailed'),
          )
        }
        setPhase('error')
        redirectToReturn('error')
      }
    })()
  }, [bridgeNonce, bardoUserId, bardoEmail, user, loading, redirectToReturn, t, locale])

  // Login handlers — preservam a URL atual (com os query params) para
  // que o callback do provedor de auth volte para /connect-bardo intacto.
  const handleEmailLogin = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      const trimmed = email.trim()
      if (!trimmed) return
      setErrorMessage(null)
      setEmailSending(true)
      try {
        const back = buildReturnHere()
        await signInWithEmail(trimmed, getAuthRedirectUrl({ webUrl: back }))
        setEmailSent(true)
      } catch (err) {
        setErrorMessage(
          err instanceof Error && err.message
            ? err.message
            : t('connectBardo.error.authFailed'),
        )
      } finally {
        setEmailSending(false)
      }
    },
    [email, signInWithEmail, buildReturnHere, t],
  )

  const handleGoogleLogin = useCallback(async () => {
    setErrorMessage(null)
    setGoogleOpening(true)
    try {
      const back = buildReturnHere()
      await signInWithGoogle(getAuthRedirectUrl({ webUrl: back }))
    } catch (err) {
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : t('connectBardo.error.authFailed'),
      )
    } finally {
      setGoogleOpening(false)
    }
  }, [signInWithGoogle, buildReturnHere, t])

  return (
    <div className="min-h-screen bg-surface px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-8 text-center">
          <VoiceIdeasAppIcon className="mx-auto mb-4 h-16 w-16 rounded-2xl" alt="VoiceIdeas" />
          <h1 className="text-2xl font-bold text-gray-900">{t('connectBardo.title')}</h1>
          <p className="mt-2 text-sm text-gray-500">{t('connectBardo.subtitle')}</p>
        </div>

        <div className="rounded-[28px] border border-black/6 bg-white/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.08)] backdrop-blur-xl">
          {phase === 'validating' && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {phase === 'missingParams' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('connectBardo.error.missingBardoUserId')}</span>
              </div>
            </div>
          )}

          {phase === 'needLogin' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-700">{t('connectBardo.needLogin.body')}</p>

              {emailSent ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <p className="font-medium">{t('auth.linkSent.title')}</p>
                  <p className="mt-1 text-emerald-700">
                    {t('auth.linkSent.description', { email })}
                  </p>
                </div>
              ) : (
                <>
                  <form onSubmit={handleEmailLogin} className="space-y-3">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('auth.emailPlaceholder')}
                      required
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                    <button
                      type="submit"
                      disabled={emailSending}
                      className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark disabled:bg-primary/50 text-white py-3 px-4 rounded-lg text-sm font-medium transition-colors"
                    >
                      {emailSending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="h-4 w-4" />
                      )}
                      {t('auth.magicLinkButton')}
                    </button>
                  </form>

                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-200" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-white px-2 text-gray-400">{t('common.or')}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => { void handleGoogleLogin() }}
                    disabled={googleOpening}
                    className="w-full flex items-center justify-center gap-2 border border-gray-200 hover:bg-black/5 py-3 px-4 rounded-lg text-sm font-medium text-gray-700 transition-colors"
                  >
                    {googleOpening ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <svg className="h-4 w-4" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                    )}
                    {googleOpening ? t('auth.googleOpening') : t('auth.googleButton')}
                  </button>
                </>
              )}

              {errorMessage && (
                <p className="text-sm text-red-500">{errorMessage}</p>
              )}
            </div>
          )}

          {phase === 'linking' && (
            <div className="flex flex-col items-center gap-3 py-8 text-sm text-gray-600">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span>{t('connectBardo.linking')}</span>
            </div>
          )}

          {phase === 'success' && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-base font-medium text-gray-900">
                {t('connectBardo.success.title')}
              </p>
              <p className="text-sm text-gray-600">
                {returnUrl
                  ? t('connectBardo.success.backToBardo')
                  : t('connectBardo.success.body')}
              </p>
              {returnUrl && (
                // Botão explícito de fallback além do auto-redirect (1.2s).
                // Garante UX clara mesmo se o setTimeout for cancelado por
                // navegação manual ou se o browser bloquear o redirect
                // automático por algum motivo.
                <button
                  type="button"
                  onClick={() => {
                    const target = buildBardoCallbackUrl(returnUrl, {
                      status: 'success',
                      state,
                    })
                    if (target && typeof window !== 'undefined') {
                      window.location.replace(target)
                    }
                  }}
                  className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
                >
                  {t('connectBardo.success.backToBardoButton')}
                </button>
              )}
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMessage ?? t('connectBardo.error.unknown')}</span>
              </div>
              {!returnUrl && (
                <p className="text-xs text-gray-500">
                  {t('connectBardo.error.unknown')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
