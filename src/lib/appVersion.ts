/**
 * VI_VERSION_VISIBILITY_STANDARD (2026-05-18)
 *
 * Helper único para descobrir versão / build / channel / plataforma
 * em runtime. Source primária: `package.json` injetado via
 * `vite.config.ts` define em build time.
 *
 * **Onde a versão vive (fontes técnicas):**
 *   - `package.json` (PRIMÁRIA)
 *   - `src-tauri/tauri.conf.json` (sync manual no release — desktop bundle)
 *   - `src-tauri/Cargo.toml` (sync manual — binário Rust)
 *   - `android/app/build.gradle` `versionName` (sync manual — APK/AAB)
 *   - `ios/App/App.xcodeproj` MARKETING_VERSION (sync manual — App Store)
 *
 * Como atualizar versão em releases: ver `docs/RELEASE_VERSIONING.md`.
 *
 * **Sem hardcode espalhado.** Qualquer UI que mostra versão deve
 * importar deste módulo.
 */

import { getPlatformSource, type PlatformSource } from './platform'

/**
 * Tipo augmenting do Vite ImportMeta para os campos injetados em
 * `vite.config.ts` define. Esses NÃO são variáveis de ambiente reais —
 * são literais substituídos no bundle.
 */
declare global {
  interface ImportMetaEnv {
    readonly APP_VERSION?: string
    readonly APP_COMMIT?: string
    readonly APP_CHANNEL?: string
  }
}

export type AppChannel = 'development' | 'production' | 'staging' | string

export interface AppVersionInfo {
  /** Versão semver da fonte primária (`package.json`). */
  version: string
  /** Hash curto do commit no momento do build (fallback: 'unknown'). */
  commit: string
  /** Canal/modo do build (`development` | `production` | custom via env). */
  channel: AppChannel
  /** Plataforma de execução detectada em runtime. */
  platform: PlatformSource
  /**
   * Build number nativo opcional — vem do Capacitor `App.getInfo()`
   * quando rodando dentro de shell nativo. `null` em web/Tauri.
   */
  nativeBuild: string | null
}

/**
 * Lê metadados sincrono — version + commit + channel + platform.
 * NÃO inclui `nativeBuild` (assíncrono). Use `getAppVersionInfo()` para
 * versão completa com build nativo.
 */
export function getAppVersionInfoSync(): Omit<AppVersionInfo, 'nativeBuild'> {
  return {
    version: import.meta.env.APP_VERSION ?? 'unknown',
    commit: import.meta.env.APP_COMMIT ?? 'unknown',
    channel: (import.meta.env.APP_CHANNEL ?? 'unknown') as AppChannel,
    platform: getPlatformSource(),
  }
}

/**
 * Versão completa com `nativeBuild` (Capacitor App.getInfo). Assíncrono.
 * Em web/Tauri retorna `nativeBuild: null` sem chamar o plugin nativo.
 *
 * Falhas do Capacitor App.getInfo (timeout, plugin não instalado) caem
 * em `null` silenciosamente — exibição da versão não pode quebrar UI.
 */
export async function getAppVersionInfo(): Promise<AppVersionInfo> {
  const base = getAppVersionInfoSync()
  let nativeBuild: string | null = null

  // Apenas Capacitor (iOS/Android nativo) expõe getInfo. Tauri tem
  // sua própria API que poderia ser usada futuramente; por enquanto
  // o version do `package.json` é suficiente em desktop.
  if (base.platform === 'ios' || base.platform === 'android') {
    try {
      const { App } = await import('@capacitor/app')
      const info = await App.getInfo()
      nativeBuild = typeof info.build === 'string' ? info.build : null
    } catch {
      nativeBuild = null
    }
  }

  return { ...base, nativeBuild }
}

/**
 * String compacta para exibição em footers/menu nativo:
 *   "0.1.0 · build a64c9a0"  (web/desktop)
 *   "0.1.0 (5) · build a64c9a0"  (mobile nativo)
 */
export function formatVersionShort(info: AppVersionInfo): string {
  const parts: string[] = [info.version]
  if (info.nativeBuild) {
    parts[0] = `${info.version} (${info.nativeBuild})`
  }
  if (info.commit && info.commit !== 'unknown') {
    parts.push(`build ${info.commit}`)
  }
  return parts.join(' · ')
}

/**
 * Label legível da plataforma para exibição.
 */
export function formatPlatform(platform: PlatformSource): string {
  switch (platform) {
    case 'macos':
      return 'macOS'
    case 'ios':
      return 'iOS'
    case 'android':
      return 'Android'
    case 'web':
      return 'Web'
  }
}
