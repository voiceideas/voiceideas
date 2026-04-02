import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { FileText, Sparkles, LogOut, Shield, Rows3, Settings2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { prefetchAdminUsers } from '../hooks/useAdminUsers'
import { prefetchUserProfile, useUserProfile } from '../hooks/useUserProfile'
import { InstallBanner } from './InstallBanner'
import { VoiceIdeasAppIcon, VoiceIdeasRecorderIcon } from './VoiceIdeasIcons'

export function Layout() {
  const { user, signOut } = useAuth()
  const { isAdmin } = useUserProfile()

  useEffect(() => {
    void prefetchUserProfile()
  }, [])

  useEffect(() => {
    if (isAdmin) {
      void prefetchAdminUsers()
    }
  }, [isAdmin])

  return (
    <div className="min-h-screen bg-surface text-zinc-900 flex flex-col">
      <div className="sticky top-0 z-20">
        <InstallBanner />

        {/* Header */}
        <header className="border-b border-black/6 bg-white/80 shadow-[0_10px_30px_rgba(0,0,0,0.04)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-2">
              <VoiceIdeasAppIcon className="h-9 w-9 rounded-xl shadow-[0_8px_20px_rgba(0,0,0,0.10)]" alt="VoiceIdeas" />
              <div>
                <h1 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-900">VoiceIdeas</h1>
                <p className="text-[11px] text-zinc-500">captura e organiza sem friccao</p>
              </div>
            </div>
            {user && (
              <div className="flex items-center gap-1">
                <NavLink
                  to="/settings"
                  className={({ isActive }) =>
                    `rounded-xl p-2 transition-colors ${
                      isActive
                        ? 'bg-black/5 text-zinc-800'
                        : 'text-zinc-400 hover:bg-black/5 hover:text-zinc-600'
                    }`
                  }
                  title="Abrir Settings"
                >
                  <Settings2 className="w-4 h-4" />
                </NavLink>
                <button
                  onClick={signOut}
                  className="rounded-xl p-2 text-zinc-400 hover:bg-black/5 hover:text-zinc-600"
                  title="Sair"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </header>
      </div>

      {/* Content */}
      <main className="mx-auto flex-1 w-full max-w-2xl px-4 py-6 space-y-6 md:py-8">
        <Outlet />
      </main>

      {/* Bottom nav */}
      <nav className="sticky bottom-0 border-t border-black/6 bg-white/88 shadow-[0_-18px_40px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl gap-1 px-2 py-2">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `flex-1 rounded-2xl flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-black/5 text-primary'
                  : 'text-zinc-400 hover:bg-black/5 hover:text-zinc-600'
              }`
            }
          >
            <VoiceIdeasRecorderIcon className="w-5 h-5" />
            Gravar
          </NavLink>
          <NavLink
            to="/capture-queue"
            className={({ isActive }) =>
              `flex-1 rounded-2xl flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-black/5 text-primary'
                  : 'text-zinc-400 hover:bg-black/5 hover:text-zinc-600'
              }`
            }
          >
            <Rows3 className="w-5 h-5" />
            Fila
          </NavLink>
          <NavLink
            to="/notes"
            className={({ isActive }) =>
              `flex-1 rounded-2xl flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-black/5 text-primary'
                  : 'text-zinc-400 hover:bg-black/5 hover:text-zinc-600'
              }`
            }
          >
            <FileText className="w-5 h-5" />
            Notas
          </NavLink>
          <NavLink
            to="/organized"
            className={({ isActive }) =>
              `flex-1 rounded-2xl flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-black/5 text-primary'
                  : 'text-zinc-400 hover:bg-black/5 hover:text-zinc-600'
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
                `flex-1 rounded-2xl flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-black/5 text-primary'
                    : 'text-zinc-400 hover:bg-black/5 hover:text-zinc-600'
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
