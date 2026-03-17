import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Sparkles, Loader2, Users, CheckCircle2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { OrganizedView } from '../components/OrganizedView'
import { ShareIdeaModal } from '../components/ShareIdeaModal'
import { supabase } from '../lib/supabase'
import type { OrganizedIdea } from '../types/database'

type OrganizedTab = 'mine' | 'shared'

export function Organized() {
  const [ownedIdeas, setOwnedIdeas] = useState<OrganizedIdea[]>([])
  const [sharedIdeas, setSharedIdeas] = useState<OrganizedIdea[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ideaToShare, setIdeaToShare] = useState<OrganizedIdea | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTab: OrganizedTab = searchParams.get('tab') === 'shared' ? 'shared' : 'mine'
  const showAcceptedBanner = searchParams.get('accepted') === '1'

  const fetchIdeas = useEffectEvent(async () => {
    setLoading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    const [ownedResponse, sharedResponse] = await Promise.all([
      supabase
        .from('organized_ideas')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('organized_ideas')
        .select('*')
        .neq('user_id', user.id)
        .order('created_at', { ascending: false }),
    ])

    if (ownedResponse.error) {
      setError(ownedResponse.error.message)
    } else {
      setOwnedIdeas((ownedResponse.data as OrganizedIdea[]) || [])
    }

    if (sharedResponse.error) {
      setError(sharedResponse.error.message)
    } else {
      setSharedIdeas((sharedResponse.data as OrganizedIdea[]) || [])
    }

    setLoading(false)
  })

  useEffect(() => {
    void fetchIdeas()
  }, [])

  const visibleIdeas = useMemo(
    () => (activeTab === 'mine' ? ownedIdeas : sharedIdeas),
    [activeTab, ownedIdeas, sharedIdeas],
  )

  async function handleDelete(id: string) {
    await supabase.from('organized_ideas').delete().eq('id', id)
    setOwnedIdeas((prev) => prev.filter((idea) => idea.id !== id))
  }

  function handleTabChange(tab: OrganizedTab) {
    const next = new URLSearchParams(searchParams)
    if (tab === 'shared') {
      next.set('tab', 'shared')
    } else {
      next.delete('tab')
    }
    next.delete('accepted')
    setSearchParams(next)
  }

  function clearAcceptedBanner() {
    const next = new URLSearchParams(searchParams)
    next.delete('accepted')
    setSearchParams(next)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {showAcceptedBanner && (
        <button
          onClick={clearAcceptedBanner}
          className="flex w-full items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-left"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          <div>
            <p className="text-sm font-medium text-green-800">Convite aceito com sucesso</p>
            <p className="text-sm text-green-700">
              Essa ideia agora aparece na aba <strong>Compartilhadas comigo</strong>.
            </p>
          </div>
        </button>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-gray-100">
        <button
          onClick={() => handleTabChange('mine')}
          className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'mine'
              ? 'bg-primary text-white'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          Minhas ({ownedIdeas.length})
        </button>
        <button
          onClick={() => handleTabChange('shared')}
          className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'shared'
              ? 'bg-primary text-white'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          Compartilhadas comigo ({sharedIdeas.length})
        </button>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          {activeTab === 'mine' ? 'Ideias organizadas' : 'Ideias compartilhadas'}
        </h2>
        {activeTab === 'shared' && (
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-primary">
            <Users className="h-3.5 w-3.5" />
            leitura compartilhada
          </div>
        )}
      </div>

      {visibleIdeas.length === 0 ? (
        <div className="py-12 text-center">
          <Sparkles className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="font-medium text-gray-500">
            {activeTab === 'mine'
              ? 'Nenhuma ideia organizada ainda'
              : 'Nenhuma ideia compartilhada com voce ainda'}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {activeTab === 'mine'
              ? 'Selecione notas e use a IA para organizar.'
              : 'Quando alguem compartilhar uma ideia, ela aparece aqui.'}
          </p>
        </div>
      ) : (
        visibleIdeas.map((idea) => (
          <OrganizedView
            key={idea.id}
            idea={idea}
            onDelete={handleDelete}
            onShare={setIdeaToShare}
            canDelete={activeTab === 'mine'}
            canShare={activeTab === 'mine'}
          />
        ))
      )}

      <ShareIdeaModal
        idea={ideaToShare}
        isOpen={!!ideaToShare}
        onClose={() => setIdeaToShare(null)}
      />
    </div>
  )
}
