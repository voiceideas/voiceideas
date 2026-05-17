/**
 * VI_CAPTURE_ENGINE_UNIFICATION.E4_DEFAULT_MANUAL_ENGINE (2026-05-17)
 *
 * Smoke unit valida que após E4:
 *   - Default (localStorage vazio) → `true` (Manual usa engine).
 *   - Opt-out explícito (`'false'`) → `false` (rollback funciona).
 *   - Opt-in explícito (`'true'`) → `true` (mantém override).
 *   - Valor inválido → default `true`.
 *   - SSR (sem window) → default `true`.
 *
 * Executar: `npm run smoke:capture-engine-feature-flag`
 */

interface LocalStorageStub {
  store: Map<string, string>
}

const localStub: LocalStorageStub = { store: new Map() }

function makeLocalStorageMock() {
  return {
    getItem: (key: string): string | null => {
      return localStub.store.has(key) ? (localStub.store.get(key) as string) : null
    },
    setItem: (key: string, value: string): void => {
      localStub.store.set(key, value)
    },
    removeItem: (key: string): void => {
      localStub.store.delete(key)
    },
    clear: (): void => {
      localStub.store.clear()
    },
    key: (index: number): string | null => {
      const keys = Array.from(localStub.store.keys())
      return keys[index] ?? null
    },
    get length(): number {
      return localStub.store.size
    },
  }
}

interface Case {
  name: string
  setup: () => void
  expected: boolean
}

// Setup browser globals ANTES de importar a flag.
function applyState(hasWindow: boolean): void {
  const g = globalThis as Record<string, unknown>
  if (!hasWindow) {
    Object.defineProperty(g, 'window', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    return
  }
  Object.defineProperty(g, 'window', {
    value: { localStorage: makeLocalStorageMock() },
    writable: true,
    configurable: true,
  })
}

applyState(true)

const {
  CAPTURE_ENGINE_FEATURE_FLAG_DEFAULT,
  CAPTURE_ENGINE_FEATURE_FLAG_STORAGE_KEY,
  getUseUnifiedCaptureEngine,
  isUnifiedCaptureEngineEnabled,
  setUseUnifiedCaptureEngine,
} = await import('../captureEngineFeatureFlag')

const KEY = CAPTURE_ENGINE_FEATURE_FLAG_STORAGE_KEY

const cases: Case[] = [
  {
    name: 'E4: default constante é true',
    setup: () => {
      applyState(true)
      localStub.store.clear()
    },
    expected: true,
  },
  {
    name: 'localStorage vazio → default true',
    setup: () => {
      applyState(true)
      localStub.store.clear()
    },
    expected: true,
  },
  {
    name: 'opt-in explícito setUseUnifiedCaptureEngine(true) → true',
    setup: () => {
      applyState(true)
      localStub.store.clear()
      setUseUnifiedCaptureEngine(true)
    },
    expected: true,
  },
  {
    name: "opt-out explícito setUseUnifiedCaptureEngine(false) → false (rollback)",
    setup: () => {
      applyState(true)
      localStub.store.clear()
      setUseUnifiedCaptureEngine(false)
    },
    expected: false,
  },
  {
    name: "localStorage direto 'false' (sem JSON) → ainda parseia como boolean → false (rollback runtime)",
    setup: () => {
      applyState(true)
      localStub.store.clear()
      localStub.store.set(KEY, 'false')
    },
    expected: false,
  },
  {
    name: "localStorage direto 'true' (sem JSON) → parseia → true",
    setup: () => {
      applyState(true)
      localStub.store.clear()
      localStub.store.set(KEY, 'true')
    },
    expected: true,
  },
  {
    name: 'valor inválido (string literal "yes") → default true',
    setup: () => {
      applyState(true)
      localStub.store.clear()
      localStub.store.set(KEY, '"yes"')
    },
    expected: true,
  },
  {
    name: 'valor inválido (number 1) → default true',
    setup: () => {
      applyState(true)
      localStub.store.clear()
      localStub.store.set(KEY, '1')
    },
    expected: true,
  },
  {
    name: 'SSR (sem window) → default true',
    setup: () => {
      applyState(false)
    },
    expected: true,
  },
  {
    name: 'isUnifiedCaptureEngineEnabled alias casa com getUseUnifiedCaptureEngine',
    setup: () => {
      applyState(true)
      localStub.store.clear()
    },
    expected: true,
  },
]

console.log('=== captureEngineFeatureFlag smoke (E4) ===\n')

let allOk = true
console.log(`[INFO] CAPTURE_ENGINE_FEATURE_FLAG_DEFAULT = ${CAPTURE_ENGINE_FEATURE_FLAG_DEFAULT}`)
if (CAPTURE_ENGINE_FEATURE_FLAG_DEFAULT !== true) {
  console.log('[FAIL] Constante deve ser true após E4')
  allOk = false
}

for (const c of cases) {
  c.setup()
  const get = getUseUnifiedCaptureEngine()
  const alias = isUnifiedCaptureEngineEnabled()
  const ok = get === c.expected && alias === c.expected
  const status = ok ? 'PASS' : 'FAIL'
  console.log(`[${status}] ${c.name}`)
  console.log(`  expected: ${c.expected}  get: ${get}  alias: ${alias}`)
  if (!ok) allOk = false
}

console.log(`\n=== ${allOk ? 'ALL PASS' : 'SOME FAILED'} (${cases.length} cases) ===`)
const proc = (globalThis as unknown as { process?: { exit?: (n: number) => void } }).process
proc?.exit?.(allOk ? 0 : 1)
