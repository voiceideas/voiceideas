import { useState, useEffect } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { OrganizedView } from '../components/OrganizedView'
import { supabase } from '../lib/supabase'
import type { OrganizedIdea } from '../types/database'

export function Organized() {
  const [ideas, setIdeas] = useState<OrganizedIdea[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchIdeas()
  }, [])

  const fetchIdeas = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    const { data } = await supabase
      .from('organized_ideas')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    setIdeas((data as OrganizedIdea[]) || [])
    setLoading(false)
  }

  const handleDelete = async (id: string) => {
    await supabase.from('organized_ideas').delete().eq('id', id)
    setIdeas((prev) => prev.filter((i) => i.id !== id))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    )
  }

  if (ideas.length === 0) {
    return (
      <div className="text-center py-12">
        <Sparkles className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500 font-medium">Nenhuma ideia organizada ainda</p>
        <p className="text-gray-400 text-sm mt-1">
          Selecione notas e use a IA para organizar
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
        Ideias Organizadas
      </h2>
      {ideas.map((idea) => (
        <OrganizedView key={idea.id} idea={idea} onDelete={handleDelete} />
      ))}
    </div>
  )
}
