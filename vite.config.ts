import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// VI_VERSION_VISIBILITY_STANDARD (2026-05-18): injeta version + commit
// + channel no bundle a partir de fontes únicas no build time:
//   - APP_VERSION  ← package.json
//   - APP_COMMIT   ← git rev-parse --short HEAD (fallback: 'unknown')
//   - APP_CHANNEL  ← VITE_APP_CHANNEL env OR mode (production|development)
//
// Helper consumidor: `src/lib/appVersion.ts`.
const projectRoot = dirname(fileURLToPath(import.meta.url))

function readAppVersion(): string {
  try {
    const pkgPath = resolve(projectRoot, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function readGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig(({ mode }) => {
  const appVersion = readAppVersion()
  const appCommit = readGitCommit()
  const appChannel = process.env.VITE_APP_CHANNEL ?? mode

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.APP_VERSION': JSON.stringify(appVersion),
      'import.meta.env.APP_COMMIT': JSON.stringify(appCommit),
      'import.meta.env.APP_CHANNEL': JSON.stringify(appChannel),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('@supabase/supabase-js')) return 'supabase'
            if (id.includes('lucide-react')) return 'icons'
            if (id.includes('react') || id.includes('scheduler')) return 'react-vendor'
            return 'vendor'
          },
        },
      },
    },
  }
})
