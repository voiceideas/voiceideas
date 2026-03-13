import { useState } from 'react'
import { Shield, Users, Save, Loader2, RefreshCw } from 'lucide-react'
import { useUserProfile } from '../hooks/useUserProfile'
import { useAdminUsers } from '../hooks/useAdminUsers'
import { Link } from 'react-router-dom'

export function Admin() {
  const { isAdmin, loading: profileLoading } = useUserProfile()
  const { users, loading, error, updateUserLimit, updateUserRole, refetch } = useAdminUsers()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLimit, setEditLimit] = useState<number>(10)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (profileLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-20">
        <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-700">Acesso restrito</h2>
        <p className="text-gray-500 text-sm mt-2">Voce nao tem permissao para acessar esta pagina.</p>
        <Link to="/" className="text-primary text-sm mt-4 inline-block hover:underline">
          Voltar ao inicio
        </Link>
      </div>
    )
  }

  const handleSaveLimit = async (userId: string) => {
    setSaving(true)
    try {
      await updateUserLimit(userId, editLimit)
      setEditingId(null)
      setMessage('Limite atualizado!')
      setTimeout(() => setMessage(null), 2000)
    } catch (err: any) {
      setMessage('Erro: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin'
    try {
      await updateUserRole(userId, newRole)
      setMessage(`Role alterada para ${newRole}`)
      setTimeout(() => setMessage(null), 2000)
    } catch (err: any) {
      setMessage('Erro: ' + err.message)
    }
  }

  const totalNotesToday = users.reduce((sum, u) => sum + u.notes_today, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold text-gray-900">Painel Admin</h1>
        </div>
        <button
          onClick={refetch}
          className="p-2 text-gray-400 hover:text-primary rounded-lg hover:bg-indigo-50 transition-colors"
          title="Atualizar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <Users className="w-5 h-5 text-primary mx-auto mb-1" />
          <div className="text-2xl font-bold text-gray-900">{users.length}</div>
          <div className="text-xs text-gray-500">Usuarios</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{totalNotesToday}</div>
          <div className="text-xs text-gray-500">Notas hoje</div>
        </div>
      </div>

      {message && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 text-center">
          {message}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Users list */}
      <div className="space-y-3">
        {users.map((user) => (
          <div key={user.user_id} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                    user.role === 'admin'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {user.role}
                  </span>
                  <span className="text-xs text-gray-400">
                    {user.notes_today} notas hoje
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleToggleRole(user.user_id, user.role)}
                className="text-[10px] text-gray-400 hover:text-primary px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
              >
                {user.role === 'admin' ? 'Tornar user' : 'Tornar admin'}
              </button>
            </div>

            {/* Daily limit */}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
              <span className="text-xs text-gray-500">Limite diario:</span>
              {editingId === user.user_id ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={editLimit}
                    onChange={(e) => setEditLimit(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/30"
                    min="1"
                  />
                  <button
                    onClick={() => handleSaveLimit(user.user_id)}
                    disabled={saving}
                    className="p-1 text-primary hover:bg-indigo-50 rounded transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingId(user.user_id); setEditLimit(user.daily_limit) }}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  {user.daily_limit} notas
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
