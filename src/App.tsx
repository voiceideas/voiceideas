import { Suspense, lazy } from 'react'
import { Loader2 } from 'lucide-react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AuthGate } from './components/AuthGate'
import { IntegrationSettingsProvider } from './components/providers/IntegrationSettingsProvider'
import { AuthProvider } from './hooks/useAuth'

const Home = lazy(async () => ({ default: (await import('./pages/Home')).Home }))
const CaptureQueue = lazy(async () => ({ default: (await import('./pages/CaptureQueue')).CaptureQueue }))
const IdeaDrafts = lazy(async () => ({ default: (await import('./pages/IdeaDrafts')).IdeaDrafts }))
const Notes = lazy(async () => ({ default: (await import('./pages/Notes')).Notes }))
const Organized = lazy(async () => ({ default: (await import('./pages/Organized')).Organized }))
const Admin = lazy(async () => ({ default: (await import('./pages/Admin')).Admin }))
const AcceptInvite = lazy(async () => ({ default: (await import('./pages/AcceptInvite')).AcceptInvite }))
const Settings = lazy(async () => ({ default: (await import('./pages/Settings')).Settings }))

function RouteLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  )
}

function ProtectedLayout() {
  return (
    <AuthGate>
      <Layout />
    </AuthGate>
  )
}

function App() {
  return (
    <AuthProvider>
      <IntegrationSettingsProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteLoader />}>
            <Routes>
              <Route path="/accept-invite" element={<AcceptInvite />} />
              <Route element={<ProtectedLayout />}>
                <Route path="/" element={<Home />} />
                <Route path="/capture-queue" element={<CaptureQueue />} />
                <Route path="/idea-drafts" element={<IdeaDrafts />} />
                <Route path="/notes" element={<Notes />} />
                <Route path="/organized" element={<Organized />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/admin" element={<Admin />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </IntegrationSettingsProvider>
    </AuthProvider>
  )
}

export default App
