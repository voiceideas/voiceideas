import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AuthGate } from './components/AuthGate'
import { Home } from './pages/Home'
import { Notes } from './pages/Notes'
import { Organized } from './pages/Organized'

function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/notes" element={<Notes />} />
            <Route path="/organized" element={<Organized />} />
          </Route>
        </Routes>
      </AuthGate>
    </BrowserRouter>
  )
}

export default App
