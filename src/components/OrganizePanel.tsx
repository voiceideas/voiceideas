import { useState } from 'react'
import { Sparkles, Loader2, List, ClipboardList, Route, GitBranch } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
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
  const { t } = useI18n()
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
          {t('organizePanel.title', { count: selectedCount })}
        </h3>
      </div>

      {!canOrganize && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('organizePanel.selectAtLeastOne')}
        </div>
      )}

      {selectedType === 'topicos' && canOrganize && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-700">
          {isSingleNote
            ? t('organizePanel.topics.singleInfo')
            : t('organizePanel.topics.multiInfo')}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-4">
        {TYPES.map((option) => {
          const label = option.value === 'topicos'
            ? (isSingleNote ? t('organizePanel.type.topicos.single.label') : t('organizePanel.type.topicos.multi.label'))
            : option.value === 'plano'
              ? t('organizePanel.type.plano.label')
              : option.value === 'roteiro'
                ? t('organizePanel.type.roteiro.label')
                : t('organizePanel.type.mapa.label')
          const desc = option.value === 'topicos'
            ? (isSingleNote
              ? t('organizePanel.type.topicos.single.description')
              : t('organizePanel.type.topicos.multi.description'))
            : option.value === 'plano'
              ? t('organizePanel.type.plano.description')
              : option.value === 'roteiro'
                ? t('organizePanel.type.roteiro.description')
                : t('organizePanel.type.mapa.description')

          return (
            <button
              key={option.value}
              onClick={() => setSelectedType(option.value)}
              className={`flex items-center gap-2 p-3 rounded-lg text-left text-sm transition-all ${
                selectedType === option.value
                  ? 'bg-white shadow-sm border border-primary text-primary'
                  : 'bg-white/50 border border-transparent text-gray-600 hover:bg-white hover:border-gray-200'
              }`}
            >
              {option.icon}
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
            {t('organizePanel.organizing')}
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            {selectedType === 'topicos'
              ? (isSingleNote ? t('organizePanel.cta.single') : t('organizePanel.cta.multi'))
              : t('organizePanel.cta.generic')}
          </>
        )}
      </button>
    </div>
  )
}
