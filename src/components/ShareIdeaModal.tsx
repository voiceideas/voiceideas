import { useEffect, useMemo, useState } from 'react'
import { X, Mail, Send, Copy, Check, Link2 } from 'lucide-react'
import { StatusBanner } from './StatusBanner'
import { supabase } from '../lib/supabase'
import { shareIdeaByEmail } from '../lib/shareIdeas'
import type { OrganizedIdea, OrganizedIdeaShareInvite } from '../types/database'

interface ShareIdeaModalProps {
  idea: OrganizedIdea | null
  isOpen: boolean
  onClose: () => void
}

export function ShareIdeaModal({ idea, isOpen, onClose }: ShareIdeaModalProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingInvites, setLoadingInvites] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [invites, setInvites] = useState<OrganizedIdeaShareInvite[]>([])

  const ideaId = idea?.id || null

  useEffect(() => {
    if (!isOpen || !ideaId) return

    setEmail('')
    setError(null)
    setSuccessMessage(null)
    setInviteUrl(null)
    setCopied(false)
    void loadInvites(ideaId)
  }, [isOpen, ideaId])

  const inviteSummary = useMemo(() => {
    if (!invites.length) return null

    const pending = invites.filter((invite) => invite.status === 'pending').length
    const accepted = invites.filter((invite) => invite.status === 'accepted').length
    const parts = []

    if (accepted) parts.push(`${accepted} aceito${accepted > 1 ? 's' : ''}`)
    if (pending) parts.push(`${pending} pendente${pending > 1 ? 's' : ''}`)

    return parts.join(' • ')
  }, [invites])

  async function loadInvites(currentIdeaId: string) {
    setLoadingInvites(true)
    setError(null)

    const { data: share, error: shareError } = await supabase
      .from('organized_idea_shares')
      .select('id')
      .eq('source_idea_id', currentIdeaId)
      .maybeSingle()

    if (shareError) {
      setError(shareError.message)
      setInvites([])
      setLoadingInvites(false)
      return
    }

    if (!share) {
      setInvites([])
      setLoadingInvites(false)
      return
    }

    const { data, error: fetchError } = await supabase
      .from('organized_idea_share_invites')
      .select('*')
      .eq('share_id', share.id)
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
      setInvites([])
    } else {
      setInvites((data as OrganizedIdeaShareInvite[]) || [])
    }

    setLoadingInvites(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!ideaId || !email.trim()) return

    setLoading(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const result = await shareIdeaByEmail(ideaId, email.trim())
      setSuccessMessage(
        result.emailSent
          ? `Convite enviado para ${email.trim()}.`
          : result.warning || 'Convite criado. Compartilhe o link manualmente.',
      )
      setInviteUrl(result.inviteUrl)
      setEmail('')
      await loadInvites(ideaId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao compartilhar a ideia.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopyLink() {
    if (!inviteUrl) return

    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isOpen || !idea) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/55 px-4 py-8 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-idea-title"
        className="mx-auto max-w-lg rounded-[28px] border border-white/60 bg-white/92 shadow-[0_28px_90px_rgba(0,0,0,0.22)] backdrop-blur-xl"
      >
        <div className="flex items-start justify-between border-b border-black/6 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/70">
              Compartilhar no VoiceIdeas
            </p>
            <h2 id="share-idea-title" className="mt-1 text-lg font-semibold text-gray-900">{idea.title}</h2>
            {inviteSummary && (
              <p className="mt-1 text-sm text-gray-500">{inviteSummary}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
            aria-label="Fechar modal de compartilhamento"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              Email da pessoa convidada
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="colega@empresa.com"
                  aria-label="Email da pessoa convidada"
                  className="w-full rounded-xl border border-gray-200 py-3 pl-10 pr-4 text-sm text-gray-700 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-primary/50"
              >
                {loading ? 'Enviando...' : <><Send className="h-4 w-4" /> Convidar</>}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              A pessoa recebe um link do VoiceIdeas para abrir o convite, entrar com o email correto e aceitar essa ideia.
            </p>
          </form>

          {successMessage && (
            <StatusBanner variant="success" title="Compartilhamento atualizado">
              {successMessage}
            </StatusBanner>
          )}

          {error && (
            <StatusBanner variant="error" title="Nao foi possivel compartilhar a ideia">
              {error}
            </StatusBanner>
          )}

          {inviteUrl && (
            <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">Link do convite</p>
                  <p className="mt-1 break-all text-xs text-slate-700">{inviteUrl}</p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
                  aria-label={copied ? 'Link copiado' : 'Copiar link de convite'}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-black/6 bg-stone-100/80 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-gray-400" />
              <p className="text-sm font-medium text-gray-700">Convites desta ideia</p>
            </div>

            {loadingInvites ? (
              <p className="text-sm text-gray-500">Carregando convites...</p>
            ) : invites.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum convite enviado ainda.</p>
            ) : (
              <div className="space-y-2">
                {invites.map((invite) => (
                  <div key={invite.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-gray-800">{invite.invited_email}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(invite.created_at).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      invite.status === 'accepted'
                        ? 'bg-green-100 text-green-700'
                        : invite.status === 'pending'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-gray-200 text-gray-600'
                    }`}>
                      {invite.status === 'accepted'
                        ? 'Aceito'
                        : invite.status === 'pending'
                          ? 'Pendente'
                          : invite.status === 'revoked'
                            ? 'Revogado'
                            : 'Expirado'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
