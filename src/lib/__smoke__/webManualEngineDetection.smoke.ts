/**
 * VI_WEB_MANUAL_ENGINE_NO_SYSTEM_RECORDER (2026-05-16)
 *
 * Smoke unit para `isMobileWebBrowser()` — função que define se o
 * VoiceRecorder deve forçar engine no Manual web (em vez de cair no
 * path legacy que poderia abrir gravador externo do sistema).
 *
 * Executar via:  npm run smoke:web-manual-engine
 *
 * Cobre 6 cenários de UA × shell:
 *   1. Chrome desktop puro                → false (respeita flag)
 *   2. Safari iOS web                     → true  (força engine)
 *   3. Chrome Android web                 → true  (força engine)
 *   4. Capacitor iOS (mobile UA + shell)  → false (respeita flag)
 *   5. Capacitor Android (idem)           → false (respeita flag)
 *   6. SSR (sem navigator)                → false (defensivo)
 */

// Stub do módulo @capacitor/core ANTES de importar platform.ts.
// platform.ts importa `Capacitor` para descobrir isNativePlatform().
// Node não tem o módulo real disponível, então pré-criamos um stub no
// require cache equivalente; em tsx isso seria via vi.mock — aqui
// usamos uma fake via module-import override por path em runtime.

import { createRequire } from 'node:module'

// Browser globals fake. Cada cenário ajusta `mockUserAgent` e
// `mockCapacitorPlatform` antes de chamar `isMobileWebBrowser()`.
const browserState: {
  hasNavigator: boolean
  userAgent: string
  capacitorIsNative: boolean
  capacitorPlatform: 'web' | 'ios' | 'android'
} = {
  hasNavigator: true,
  userAgent: '',
  capacitorIsNative: false,
  capacitorPlatform: 'web',
}

// Stub @capacitor/core via dynamic resolution + monkey-patch da require
// cache. Em tsx/ESM, criamos um mock antes de qualquer import real.
const requireFromHere = createRequire(import.meta.url)

const capacitorStub = {
  Capacitor: {
    isNativePlatform: () => browserState.capacitorIsNative,
    getPlatform: () => browserState.capacitorPlatform,
    convertFileSrc: (uri: string) => uri,
  },
}

// Resolve o path real de @capacitor/core e injeta o stub na require cache.
try {
  const capacitorPath = requireFromHere.resolve('@capacitor/core')
  ;(requireFromHere.cache as Record<string, { exports: unknown }>)[capacitorPath] = {
    exports: capacitorStub,
  }
} catch {
  // sem @capacitor/core resolvível — não bloqueia o smoke
}

// Definir navigator e window globalmente ANTES do import de platform.ts.
// Node 22+ traz `navigator` como getter imutável — usar
// Object.defineProperty (writable+configurable) para permitir override.
function applyBrowserState(): void {
  const g = globalThis as Record<string, unknown>
  if (!browserState.hasNavigator) {
    Object.defineProperty(g, 'navigator', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(g, 'window', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    return
  }
  Object.defineProperty(g, 'navigator', {
    value: { userAgent: browserState.userAgent },
    writable: true,
    configurable: true,
  })
  Object.defineProperty(g, 'window', {
    value: {
      location: { hostname: 'localhost' },
    },
    writable: true,
    configurable: true,
  })
}

// Importar platform.ts depois do stub registrado.
applyBrowserState()
const { isMobileWebBrowser } = await import('../platform')

interface Case {
  name: string
  setup: () => void
  expected: boolean
}

const cases: Case[] = [
  {
    name: 'Chrome desktop UA puro (no Capacitor)',
    setup: () => {
      browserState.hasNavigator = true
      browserState.userAgent =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
      browserState.capacitorIsNative = false
      browserState.capacitorPlatform = 'web'
    },
    expected: false,
  },
  {
    name: 'Safari iOS web (iPhone, no Capacitor)',
    setup: () => {
      browserState.hasNavigator = true
      browserState.userAgent =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1'
      browserState.capacitorIsNative = false
    },
    expected: true,
  },
  {
    name: 'Safari iPad web (no Capacitor)',
    setup: () => {
      browserState.hasNavigator = true
      browserState.userAgent =
        'Mozilla/5.0 (iPad; CPU OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1'
      browserState.capacitorIsNative = false
    },
    expected: true,
  },
  {
    name: 'Chrome Android web (no Capacitor)',
    setup: () => {
      browserState.hasNavigator = true
      browserState.userAgent =
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36'
      browserState.capacitorIsNative = false
    },
    expected: true,
  },
  {
    name: 'Capacitor iOS shell (mobile UA + isNativePlatform=true)',
    setup: () => {
      browserState.hasNavigator = true
      browserState.userAgent =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
      browserState.capacitorIsNative = true
      browserState.capacitorPlatform = 'ios'
    },
    expected: false,
  },
  {
    name: 'Capacitor Android shell (mobile UA + isNativePlatform=true)',
    setup: () => {
      browserState.hasNavigator = true
      browserState.userAgent =
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36'
      browserState.capacitorIsNative = true
      browserState.capacitorPlatform = 'android'
    },
    expected: false,
  },
  {
    name: 'SSR (sem navigator)',
    setup: () => {
      browserState.hasNavigator = false
      browserState.userAgent = ''
      browserState.capacitorIsNative = false
    },
    expected: false,
  },
]

console.log('=== isMobileWebBrowser smoke (VI_WEB_MANUAL_ENGINE) ===\n')

let allOk = true
for (const c of cases) {
  c.setup()
  applyBrowserState()
  const actual = isMobileWebBrowser()
  const ok = actual === c.expected
  const status = ok ? 'PASS' : 'FAIL'
  console.log(`[${status}] ${c.name}`)
  console.log(`  expected: ${c.expected}  actual: ${actual}`)
  if (!ok) allOk = false
}

console.log(`\n=== ${allOk ? 'ALL PASS' : 'SOME FAILED'} (${cases.length} cases) ===`)
const proc = (globalThis as unknown as { process?: { exit?: (n: number) => void } }).process
proc?.exit?.(allOk ? 0 : 1)
