/**
 * Modal para enviar notas ao Bardo via Bridge V1.
 *
 * Fluxo:
 *   1. Usuário seleciona nature + maturity + destino sugerido
 *   2. Preenche título e resumo (obrigatórios)
 *   3. Confirma envio → sendToBardo() persiste na bridge_exports
 *   4. Feedback de sucesso ou erro (inclui caso duplicata)
 */

import { useState } from 'react'
import { X, Send, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import type { Note } from '../types/database'
import type { Nature, Maturity, SuggestedDestination, Domain, ScopeType } from '../types/bridge'
import { sendToBardo, defaultStructuredData } from '../lib/bridgeExport'
import type { BridgeItemConfig } from '../lib/bridgeExport'

// ───────────────────────────────────────────────────────────────
// Labels para o UI (pt-BR)
// ───────────────────────────────────────────────────────────────

const NATURE_LABELS: Record<Nature, string> = {
  character: 'Personagem',
  scene: 'Cena',
  world_trait: 'Mundo (traço)',
  culture_trait: 'Cultura (traço)',
  fact: 'Fato',
  claim: 'Afirmação',
  source: 'Fonte',
  episode_idea: 'Ideia de episódio',
  theme: 'Tema',
  question: 'Pergunta',
  unknown: 'Indefinido',
}

const MATURITY_LABELS: Record<Maturity, string> = {
  raw: 'Rascunho',
  skeletal: 'Esboço',
  developing: 'Em desenvolvimento',
  structured: 'Estruturado',
  validated: 'Validado',
}

const DESTINATION_LABELS: Record<SuggestedDestination, string> = {
  vault: 'Cofre (geral)',
  characters: 'Personagens',
  participants: 'Participantes',
  scenes: 'Cenas',
  lore: 'Lore',
  documentary_claims: 'Afirmações (doc)',
  documentary_sources: 'Fontes (doc)',
  episode_workspace: 'Episódio',
  season_planning: 'Temporada',
}

const DOMAIN_LABELS: Record<Domain, string> = {
  fiction: 'Ficção',
  documentary: 'Documentário',
  hybrid: 'Híbrido',
}

// ───────────────────────────────────────────────────────────────
// Mapeamento nature → destino sugerido padrão
// ───────────────────────────────────────────────────────────────

function defaultDestination(nature: Nature): SuggestedDestination {
  switch (nature) {
    case 'character': return 'characters'
    case 'scene': return 'scenes'
    case 'world_trait':
    case 'culture_trait': return 'lore'
    case 'fact':
    case 'claim': return 'documentary_claims'
    case 'source': return 'documentary_sources'
    case 'episode_idea': return 'episode_workspace'
    case 'theme':
    case 'question':
    case 'unknown':
    default: return 'vault'
  }
}

// ───────────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────────

interface SendToBardoModalProps {
  note: Note | null
  isOpen: boolean
  onClose: () => void
}

type ModalState = 'form' | 'sending' | 'success' | 'error'

export function SendToBardoModal({ note, isOpen, onClose }: SendToBardoModalProps) {
  const [nature, setNature] = useState<Nature>('unknown')
  const [maturity, setMaturity] = useState<Maturity>('raw')
  const [destination, setDestination] = useState<SuggestedDestination>('vault')
  const [domain, setDomain] = useState<Domain>('fiction')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState('')
  const [state, setState] = useState<ModalState>('form')
  const [errorMsg, setErrorMsg] = useState('')
  const [exportId, setExportId] = useState('')

  // Reset ao abrir
  const handleOpen = () => {
    if (!note) return
    setNature('unknown')
    setMaturity('raw')
    setDestination('vault')
    setDomain('fiction')
    setTitle(note.title || note.raw_text.slice(0, 60))
    setSummary(note.raw_text.slice(0, 200))
    setTags('')
    setState('form')
    setErrorMsg('')
    setExportId('')
  }

  // Trigger reset quando note muda
  useState(() => { handleOpen() })

  const handleNatureChange = (newNature: Nature) => {
    setNature(newNature)
    setDestination(defaultDestination(newNature))
  }

  const handleSubmit = async () => {
    if (!note || !title.trim() || !summary.trim()) return

    setState('sending')

    const config: BridgeItemConfig = {
      note,
      nature,
      maturity,
      suggestedDestination: destination,
      domain,
      scopeType: 'project' as ScopeType,
      title: title.trim(),
      summary: summary.trim(),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      structuredData: defaultStructuredData(nature, note.raw_text),
    }

    const result = await sendToBardo([config])

    if (result.success) {
      setExportId(result.exportId || '')
      setState('success')
    } else {
      setErrorMsg(result.error || 'Erro desconhecido')
      setState('error')
    }
  }

  if (!isOpen || !note) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 px-4 py-8 overflow-y-auto">
      <div className="mx-auto max-w-lg rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600/70">
              Enviar ao Bardo
            </p>
            <h2 className="mt-1 text-lg font-semibold text-gray-900 line-clamp-1">
              {note.title || 'Sem título'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5">
          {/* ── Form ── */}
          {state === 'form' && (
            <div className="space-y-4">
              {/* Preview do texto */}
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Texto da nota</p>
                <p className="text-sm text-gray-700 line-clamp-4">{note.raw_text}</p>
              </div>

              {/* Nature */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Natureza</label>
                <select
                  value={nature}
                  onChange={(e) => handleNatureChange(e.target.value as Nature)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                >
                  {(Object.entries(NATURE_LABELS) as [Nature, string][]).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Domain + Maturity (side by side) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Domínio</label>
                  <select
                    value={domain}
                    onChange={(e) => setDomain(e.target.value as Domain)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                  >
                    {(Object.entries(DOMAIN_LABELS) as [Domain, string][]).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Maturidade</label>
                  <select
                    value={maturity}
                    onChange={(e) => setMaturity(e.target.value as Maturity)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                  >
                    {(Object.entries(MATURITY_LABELS) as [Maturity, string][]).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Destino sugerido */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Destino sugerido</label>
                <select
                  value={destination}
                  onChange={(e) => setDestination(e.target.value as SuggestedDestination)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                >
                  {(Object.entries(DESTINATION_LABELS) as [SuggestedDestination, string][]).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Título */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                  placeholder="Título descritivo para o Bardo"
                />
              </div>

              {/* Resumo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Resumo</label>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-700 outline-none resize-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                  placeholder="Resumo do conteúdo"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tags <span className="text-gray-400 font-normal">(separadas por vírgula)</span>
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                  placeholder="ato-1, protagonista, tensão"
                />
              </div>

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={!title.trim() || !summary.trim()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-purple-300"
              >
                <Send className="h-4 w-4" />
                Enviar ao Bardo
              </button>
            </div>
          )}

          {/* ── Sending ── */}
          {state === 'sending' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
              <p className="text-sm text-gray-600">Enviando para o Bardo...</p>
            </div>
          )}

          {/* ── Success ── */}
          {state === 'success' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <CheckCircle className="h-10 w-10 text-green-500" />
              <p className="text-sm font-medium text-gray-900">Enviado com sucesso!</p>
              <p className="text-xs text-gray-500 text-center">
                A nota ficará disponível no Bardo quando você acessar o app com o mesmo email.
              </p>
              {exportId && (
                <p className="text-xs text-gray-400 font-mono mt-1">ID: {exportId.slice(0, 8)}...</p>
              )}
              <button
                onClick={onClose}
                className="mt-4 rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Fechar
              </button>
            </div>
          )}

          {/* ── Error ── */}
          {state === 'error' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <AlertCircle className="h-10 w-10 text-red-500" />
              <p className="text-sm font-medium text-gray-900">Erro ao enviar</p>
              <p className="text-xs text-red-600 text-center">{errorMsg}</p>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setState('form')}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Tentar novamente
                </button>
                <button
                  onClick={onClose}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Fechar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
