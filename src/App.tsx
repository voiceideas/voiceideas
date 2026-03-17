import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AuthGate } from './components/AuthGate'
import { Home } from './pages/Home'
import { Notes } from './pages/Notes'
import { Organized } from './pages/Organized'
import { Admin } from './pages/Admin'
import { AcceptInvite } from './pages/AcceptInvite'

function ProtectedLayout() {
  return (
    <AuthGate>
      <Layout />
    </AuthGate>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/organized" element={<Organized />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
