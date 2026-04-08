import { useState } from 'react'
import { Sparkles, Loader2, List, ClipboardList, Route, GitBranch } from 'lucide-react'
import type { OrganizationType } from '../types/database'

interface OrganizePanelProps {
  selectedCount: number
  onOrganize: (type: OrganizationType) => Promise<void>
}

const TYPES: { value: OrganizationType; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    value: 'topicos',
    label: 'Organizar ideia',
    icon: <List className="w-4 h-4" />,
    desc: 'Estrutura a ideia sem perder nuances importantes',
  },
  {
    value: 'plano',
    label: 'Plano de ação',
    icon: <ClipboardList className="w-4 h-4" />,
    desc: 'Etapas com prioridades',
  },
  {
    value: 'roteiro',
    label: 'Roteiro',
    icon: <Route className="w-4 h-4" />,
    desc: 'Sequência lógica/temporal',
  },
  {
    value: 'mapa',
    label: 'Mapa de ideias',
    icon: <GitBranch className="w-4 h-4" />,
    desc: 'Conexões entre conceitos',
  },
]

export function OrganizePanel({ selectedCount, onOrganize }: OrganizePanelProps) {
  const [selectedType, setSelectedType] = useState<OrganizationType>('topicos')
  const [loading, setLoading] = useState(false)
  const canOrganize = selectedCount >= 1
  const isSingleNote = selectedCount === 1

  const handleOrganize = async () => {
    if (!canOrganize) return

    setLoading(true)
    try {
      await onOrganize(selectedType)
    } finally {
      setLoading(false)
    }
  }

  if (selectedCount === 0) return null

  return (
    <div className="rounded-xl border border-slate-300 bg-gradient-to-r from-slate-100 to-stone-100 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-gray-900 text-sm">
          Organizar {selectedCount} nota{selectedCount > 1 ? 's' : ''} com IA
        </h3>
      </div>

      {!canOrganize && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Selecione pelo menos 1 nota para organizar com IA.
        </div>
      )}

      {selectedType === 'topicos' && canOrganize && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-700">
          {isSingleNote
            ? 'Com 1 nota, a IA organiza a ideia, destaca a estrutura e preserva nuances sem tentar fundir conteúdos.'
            : 'Com várias notas, a IA consolida o que se conecta, preserva diferenças importantes e deixa claro o que foi apenas organizado para dar estrutura.'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-4">
        {TYPES.map((t) => {
          const label = t.value === 'topicos'
            ? (isSingleNote ? 'Organizar ideia' : 'Consolidar ideias')
            : t.label
          const desc = t.value === 'topicos'
            ? (isSingleNote
              ? 'Estrutura uma nota única com mais clareza'
              : 'Une notas relacionadas sem esconder diferenças importantes')
            : t.desc

          return (
            <button
              key={t.value}
              onClick={() => setSelectedType(t.value)}
              className={`flex items-center gap-2 p-3 rounded-lg text-left text-sm transition-all ${
                selectedType === t.value
                  ? 'bg-white shadow-sm border border-primary text-primary'
                  : 'bg-white/50 border border-transparent text-gray-600 hover:bg-white hover:border-gray-200'
              }`}
            >
              {t.icon}
              <div>
                <div className="font-medium text-xs">{label}</div>
                <div className="text-[10px] text-gray-400">{desc}</div>
              </div>
            </button>
          )
        })}
      </div>

      <button
        onClick={handleOrganize}
        disabled={loading || !canOrganize}
        className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark disabled:bg-primary/50 text-white py-3 px-4 rounded-lg text-sm font-medium transition-colors"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Organizando...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            {selectedType === 'topicos'
              ? (isSingleNote ? 'Organizar nota com IA' : 'Consolidar notas com IA')
              : 'Organizar com IA'}
          </>
        )}
      </button>
    </div>
  )
}
