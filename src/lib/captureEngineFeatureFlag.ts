/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B4 (2026-05-15) +
 * VI_CAPTURE_ENGINE_UNIFICATION.E4_DEFAULT_MANUAL_ENGINE (2026-05-17)
 *
 * Feature flag `useUnifiedCaptureEngine` em localStorage per-device.
 * Decisão D6 (Gian, 2026-05-15): rollout incremental por dispositivo,
 * sem migration server-side. Cada device (web/iOS/Android) carrega seu
 * estado independentemente.
 *
 * **Status atual (E4):** Default **`true`** — Manual usa CaptureEngine
 * por padrão em todas as plataformas (web desktop, web mobile, iOS
 * Capacitor, Android Capacitor). Mobile web continua **forçado** no
 * engine via `isMobileWebBrowser()` no `VoiceRecorder` (independente
 * da flag) per VI_WEB_MANUAL_ENGINE_NO_SYSTEM_RECORDER.
 *
 * **Escape/rollback controlado (per ordem E4):**
 *   - Usuário/dev pode forçar legacy via:
 *       `localStorage.setItem('voiceideas.capture-engine.use-unified.v1', 'false')`
 *     + reload. Funciona em desktop web e Capacitor; **NÃO** afeta mobile
 *     web (sempre force engine — não há rollback para `<input type=file
 *     capture>` que era a UX problemática).
 *   - Para voltar ao default ON:
 *       `localStorage.removeItem('voiceideas.capture-engine.use-unified.v1')`
 *     + reload.
 *   - Legacy hook `useAudioTranscription` continua deployado como
 *     fallback — não foi removido. Cleanup do hook fica para E5+ se
 *     produção provar estabilidade do engine em todas as superfícies.
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
 *   - `getUseUnifiedCaptureEngine()` — retorna boolean (default aplicado).
 *   - `setUseUnifiedCaptureEngine(value)` — persiste boolean.
 *   - `isUnifiedCaptureEngineEnabled()` — alias semântico para uso em
 *     condicionais (`if (isUnifiedCaptureEngineEnabled()) { ... }`).
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §7 (D6 + caveats)
 * + ordem `VI_CAPTURE_ENGINE_UNIFICATION.E4_DEFAULT_MANUAL_ENGINE`.
 */

/**
 * Chave do localStorage. Versionada (`.v1`) para permitir migração
 * futura sem colisão. Se o shape do valor mudar (ex: virar `{ enabled,
 * variant }`), bumpar para `.v2` e implementar migrator.
 */
export const CAPTURE_ENGINE_FEATURE_FLAG_STORAGE_KEY =
  'voiceideas.capture-engine.use-unified.v1'

/**
 * Default da flag.
 *
 * - **B4 → E3:** `false` (rollout incremental opt-in via flag explícita).
 * - **E4 (2026-05-17):** **`true`** — Manual usa CaptureEngine por
 *   padrão. Smoke matrix completa em web + iPad + Android validou o
 *   engine path antes do flip (chronicle 4.60 device verify PASS).
 *
 * Quem quiser legacy explicitamente seta `'false'` no localStorage
 * (rollback controlado). Mobile web continua force engine — flag não
 * afeta esse caminho (per VI_WEB_MANUAL_ENGINE_NO_SYSTEM_RECORDER).
 */
export const CAPTURE_ENGINE_FEATURE_FLAG_DEFAULT = true

/**
 * Lê a flag do localStorage. Retorna boolean com default aplicado
 * (default = `CAPTURE_ENGINE_FEATURE_FLAG_DEFAULT`, atualmente `true`
 * pós-E4).
 *
 * - SSR/Node: retorna default (sem acessar window).
 * - localStorage indisponível ou JSON inválido: retorna default sem
 *   throw (resiliente; engine não pode quebrar por pref corrompida).
 * - Aceita apenas valor estritamente boolean parseado (`'true'` → true,
 *   `'false'` → false). Outros tipos (strings literais, numbers, etc) →
 *   default.
 * - Rollback explícito: `localStorage.setItem(KEY, 'false')` força legacy
 *   sem alterar o default global.
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
