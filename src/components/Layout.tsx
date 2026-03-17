import { NavLink, Outlet } from 'react-router-dom'
import { Mic, FileText, Sparkles, LogOut, Shield } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useUserProfile } from '../hooks/useUserProfile'
import { InstallBanner } from './InstallBanner'

export function Layout() {
  const { user, signOut } = useAuth()
  const { isAdmin } = useUserProfile()

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Mic className="w-4 h-4 text-white" />
            </div>
            <h1 className="font-bold text-gray-900">VoiceIdeas</h1>
          </div>
          {user && (
            <button
              onClick={signOut}
              className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-50"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 space-y-6">
        <InstallBanner />
        <Outlet />
      </main>

      {/* Bottom nav */}
      <nav className="bg-white border-t border-gray-100 sticky bottom-0">
        <div className="max-w-2xl mx-auto flex">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                isActive ? 'text-primary' : 'text-gray-400 hover:text-gray-600'
              }`
            }
          >
            <Mic className="w-5 h-5" />
            Gravar
          </NavLink>
          <NavLink
            to="/notes"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                isActive ? 'text-primary' : 'text-gray-400 hover:text-gray-600'
              }`
            }
          >
            <FileText className="w-5 h-5" />
            Notas
          </NavLink>
          <NavLink
            to="/organized"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                isActive ? 'text-primary' : 'text-gray-400 hover:text-gray-600'
              }`
            }
          >
            <Sparkles className="w-5 h-5" />
            Organizadas
          </NavLink>
          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                  isActive ? 'text-primary' : 'text-gray-400 hover:text-gray-600'
                }`
              }
            >
              <Shield className="w-5 h-5" />
              Admin
            </NavLink>
          )}
        </div>
      </nav>
    </div>
  )
}
