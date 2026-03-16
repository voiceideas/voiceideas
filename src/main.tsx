import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

function shouldRegisterPwaServiceWorker() {
  if (!import.meta.env.PROD) return false
  if (typeof window === 'undefined') return false
  if ((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return false

  const hostname = window.location.hostname

  if (hostname === 'localhost' || hostname === '127.0.0.1') return false
  if (hostname.endsWith('-voiceideas-projects.vercel.app')) return false

  return true
}

if ('serviceWorker' in navigator) {
  if (shouldRegisterPwaServiceWorker()) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js')
    })
  } else {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister()
      })
    })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
