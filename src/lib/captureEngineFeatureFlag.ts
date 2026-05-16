/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B4 (2026-05-15)
 *
 * Feature flag `useUnifiedCaptureEngine` em localStorage per-device.
 * Decisão D6 (Gian, 2026-05-15): rollout incremental por dispositivo,
 * sem migration server-side. Cada device (web/iOS/Android) carrega seu
 * estado independentemente.
 *
 * **Status (B4):** APENAS infraestrutura de leitura/escrita.
 *   - Default OBRIGATÓRIO: `false`.
 *   - Nenhum consumidor lê esta flag em B4.
 *   - Nenhuma UI expõe toggle em B4.
 *   - Quando lida em runtime, NUNCA dispara engine novo (ele ainda é
 *     stub, ver B1-B3).
 *
 * **Por que helper isolado e não dentro de `recorderUiPreferences`?**
 *   `recorderUiPreferences` é um React hook (`useRecorderUiPreferences`)
 *   acoplado ao ciclo de render. Esta flag precisa ser consumível em:
 *     - Services puros (não-React)
 *     - Engine factory (no momento de instanciar adapter)
 *     - Tests/dev tools
 *     - Eventualmente um hook React próprio (em B5+ se útil)
 *   Manter como módulo TS puro (sem React) preserva flexibilidade.
 *
 * **Convenção de nomes:**
 *   - `getUseUnifiedCaptureEngine()` — retorna boolean (default false aplicado).
 *   - `setUseUnifiedCaptureEngine(value)` — persiste boolean.
 *   - `isUnifiedCaptureEngineEnabled()` — alias semântico para uso em
 *     condicionais (`if (isUnifiedCaptureEngineEnabled()) { ... }`).
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §7 (D6 + caveats).
 */

/**
 * Chave do localStorage. Versionada (`.v1`) para permitir migração
 * futura sem colisão. Se o shape do valor mudar (ex: virar `{ enabled,
 * variant }`), bumpar para `.v2` e implementar migrator.
 */
export const CAPTURE_ENGINE_FEATURE_FLAG_STORAGE_KEY =
  'voiceideas.capture-engine.use-unified.v1'

/**
 * Default obrigatório (per ordem Gian B4): `false`. Esta flag NUNCA
 * deve voltar a `true` por default — flip explícito é responsabilidade
 * de E9 após smoke matrix completa.
 */
export const CAPTURE_ENGINE_FEATURE_FLAG_DEFAULT = false

/**
 * Lê a flag do localStorage. Retorna boolean com default false aplicado.
 *
 * - SSR/Node: retorna default (sem acessar window).
 * - localStorage indisponível ou JSON inválido: retorna default sem
 *   throw (resiliente; engine não pode quebrar por pref corrompida).
 * - Aceita apenas valor estritamente boolean. Strings 'true'/'false',
 *   numbers, etc → default.
 */
export function getUseUnifiedCaptureEngine(): boolean {
  if (typeof window === 'undefined') {
    return CAPTURE_ENGINE_FEATURE_FLAG_DEFAULT
  }

  try {
    const raw = window.localStorage.getItem(
      CAPTURE_ENGINE_FEATURE_FLAG_STORAGE_KEY,
    )
    if (raw === null) {
      return CAPTURE_ENGINE_FEATURE_FLAG_DEFAULT
    }
    const parsed = JSON.parse(raw)
    return typeof parsed === 'boolean'
      ? parsed
      : CAPTURE_ENGINE_FEATURE_FLAG_DEFAULT
  } catch {
    return CAPTURE_ENGINE_FEATURE_FLAG_DEFAULT
  }
}

/**
 * Persiste a flag no localStorage. No-op se window indisponível.
 *
 * Falhas de localStorage (quota, modo private) são silenciosamente
 * ignoradas — flag não é crítica e o caller já assumiu localStorage
 * disponível ao chamar setter. Caller pode ler novamente para validar
 * persistência se for crítico.
 */
export function setUseUnifiedCaptureEngine(value: boolean): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      CAPTURE_ENGINE_FEATURE_FLAG_STORAGE_KEY,
      JSON.stringify(value),
    )
  } catch {
    // Silencioso — feature flag não pode quebrar o app.
  }
}

/**
 * Alias semântico para uso em condicionais.
 * `if (isUnifiedCaptureEngineEnabled()) { useNewEngine() }`
 *
 * Funcionalmente equivalente a `getUseUnifiedCaptureEngine() === true`.
 */
export function isUnifiedCaptureEngineEnabled(): boolean {
  return getUseUnifiedCaptureEngine() === true
}
