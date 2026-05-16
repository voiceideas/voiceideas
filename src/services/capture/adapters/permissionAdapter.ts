/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B2 (2026-05-15)
 *
 * `PermissionAdapter` — interface para gerenciar permissão do microfone
 * de forma consistente entre browser, Capacitor (iOS/Android) e Tauri.
 *
 * **Status (B2):** APENAS interface + stub que lança erro.
 *   - Nenhum hook consome.
 *   - Implementações reais (BrowserPermissionAdapter, CapacitorPermissionAdapter)
 *     ficam para B3+.
 *   - Não toca `useAudioTranscription` nem `useSafeCaptureMode`.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §2 (adapter chain).
 */

import type { CapturePermission, CaptureAvailability } from '../captureEngine'

/**
 * Resultado consolidado de uma checagem de permissão. `permission` é
 * o estado puro do navigator/Capacitor; `availability` agrega contexto
 * (foreground required, interrupted, etc).
 */
export interface PermissionSnapshot {
  permission: CapturePermission
  availability: CaptureAvailability
  /** Motivo da indisponibilidade quando availability !== 'available'. */
  reason: string | null
}

/**
 * Listener para mudanças assíncronas de permissão (revogação no SO,
 * mudança de contexto background → foreground, etc).
 */
export type PermissionChangeListener = (snapshot: PermissionSnapshot) => void

/**
 * Contrato do adapter de permissão. Implementações concretas vêm em
 * B3+: `BrowserPermissionAdapter` (navigator.permissions + getUserMedia
 * dry-run) e `CapacitorPermissionAdapter` (`@capgo/capacitor-audio-recorder.requestPermissions`).
 */
export interface PermissionAdapter {
  /** Snapshot mais recente. Pode ser stale; chamar `refresh()` força re-check. */
  readonly snapshot: PermissionSnapshot
  /**
   * Re-lê estado do sistema. Não dispara prompt — só refresca cache.
   * Resolve com snapshot atualizado.
   */
  refresh(): Promise<PermissionSnapshot>
  /**
   * Dispara prompt de permissão se estado for 'prompt'. No-op se já
   * granted/denied. Resolve com snapshot final pós-prompt.
   */
  request(): Promise<PermissionSnapshot>
  /**
   * Subscribe para mudanças assíncronas (system-level revoke, etc).
   * Retorna unsubscribe. Implementações sem fonte de eventos podem
   * retornar listener no-op.
   */
  subscribe(listener: PermissionChangeListener): () => void
}

/**
 * Erro lançado por stubs B2 quando algum consumidor acidentalmente
 * tenta usar o adapter antes da implementação real.
 */
export class PermissionAdapterUnimplementedError extends Error {
  constructor(method: string) {
    super(`PermissionAdapter.${method} is not implemented yet (BREAK B2 stub).`)
    this.name = 'PermissionAdapterUnimplementedError'
  }
}

/**
 * Stub factory. Retorna adapter cujos métodos lançam
 * `PermissionAdapterUnimplementedError`. Snapshot inicial é
 * `unavailable` para deixar claro que não há resolução real.
 *
 * **Mantido em B6** para uso em tests e como sentinel de consumidor
 * acidental. Produção deve usar `createPermissionAdapter()`.
 */
export function createPermissionAdapterStub(): PermissionAdapter {
  const snapshot: PermissionSnapshot = {
    permission: 'unavailable',
    availability: 'unavailable',
    reason: 'B2 stub — implementação real em B3+',
  }

  return {
    snapshot,
    refresh: async () => {
      throw new PermissionAdapterUnimplementedError('refresh')
    },
    request: async () => {
      throw new PermissionAdapterUnimplementedError('request')
    },
    subscribe: () => {
      throw new PermissionAdapterUnimplementedError('subscribe')
    },
  }
}

// ─── B6: implementação real (BrowserPermissionAdapter) ───────────────

/**
 * Códigos de erro tipados para consumers que precisam diferenciar
 * causas de falha. Não aborta o adapter — usado em `snapshot.reason`.
 */
export type PermissionAdapterErrorCode =
  | 'navigator-unavailable'
  | 'mediadevices-unavailable'
  | 'getusermedia-unavailable'
  | 'permission-api-failed'
  | 'getusermedia-rejected'

/**
 * Adapter real para browsers. Lê `navigator.permissions.query` quando
 * suportado, fallback para getUserMedia dry-run em `request()`.
 *
 * **Limitações conhecidas (B6):**
 *   - Não cobre Capacitor native shell (iOS/Android plugin) — adapter
 *     dedicado virá em iteração futura.
 *   - `availability` não modela `foreground-required` nem `interrupted`
 *     (esses estados são específicos do Safe Capture nativo).
 *   - `subscribe()` só dispara em mudanças do `PermissionStatus`
 *     (Permissions API). Browsers sem Permissions API não notificam
 *     mudanças assíncronas — listener nunca é chamado nesse caso.
 *   - O hook `useSafeCaptureMode` continua usando seu próprio caminho
 *     em B6; este adapter NÃO é consumido em runtime ainda.
 */
class BrowserPermissionAdapter implements PermissionAdapter {
  private internalSnapshot: PermissionSnapshot
  private readonly listeners = new Set<PermissionChangeListener>()
  private permissionStatus: PermissionStatus | null = null

  constructor() {
    this.internalSnapshot = {
      permission: 'prompt',
      availability: 'permission-required',
      reason: null,
    }
  }

  get snapshot(): PermissionSnapshot {
    return this.internalSnapshot
  }

  async refresh(): Promise<PermissionSnapshot> {
    if (typeof navigator === 'undefined') {
      this.update({
        permission: 'unavailable',
        availability: 'unavailable',
        reason: 'navigator-unavailable',
      })
      return this.internalSnapshot
    }

    if (!navigator.mediaDevices) {
      this.update({
        permission: 'unavailable',
        availability: 'unavailable',
        reason: 'mediadevices-unavailable',
      })
      return this.internalSnapshot
    }

    if (navigator.permissions?.query) {
      try {
        // 'microphone' não está em PermissionName padrão TS, mas é suportado
        // na maioria dos browsers modernos (Chromium/Firefox/Safari recentes).
        const status = (await navigator.permissions.query({
          name: 'microphone' as PermissionName,
        })) as PermissionStatus
        this.bindStatus(status)
        this.update(this.fromQueryState(status.state))
        return this.internalSnapshot
      } catch {
        // Fallback abaixo (Permissions API não suporta 'microphone').
      }
    }

    // Sem Permissions API: assume prompt — request() vai resolver real.
    this.update({
      permission: 'prompt',
      availability: 'permission-required',
      reason: null,
    })
    return this.internalSnapshot
  }

  async request(): Promise<PermissionSnapshot> {
    await this.refresh()

    if (this.internalSnapshot.permission === 'granted') {
      return this.internalSnapshot
    }
    if (this.internalSnapshot.permission === 'unavailable') {
      return this.internalSnapshot
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.update({
        permission: 'unavailable',
        availability: 'unavailable',
        reason: 'getusermedia-unavailable',
      })
      return this.internalSnapshot
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Dry-run: para todas as tracks imediatamente — request é só para
      // resolver o estado de permissão, não inicia gravação.
      stream.getTracks().forEach((track) => track.stop())
      this.update({
        permission: 'granted',
        availability: 'available',
        reason: null,
      })
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'getusermedia-rejected'
      this.update({
        permission: 'denied',
        availability: 'permission-denied',
        reason: errName,
      })
    }

    return this.internalSnapshot
  }

  subscribe(listener: PermissionChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private bindStatus(status: PermissionStatus): void {
    if (this.permissionStatus === status) return
    this.permissionStatus = status
    status.onchange = () => {
      this.update(this.fromQueryState(status.state))
    }
  }

  private fromQueryState(state: PermissionState): PermissionSnapshot {
    switch (state) {
      case 'granted':
        return { permission: 'granted', availability: 'available', reason: null }
      case 'denied':
        return { permission: 'denied', availability: 'permission-denied', reason: null }
      default:
        return { permission: 'prompt', availability: 'permission-required', reason: null }
    }
  }

  private update(next: PermissionSnapshot): void {
    this.internalSnapshot = next
    for (const listener of this.listeners) {
      try {
        listener(next)
      } catch {
        // Listener não pode quebrar broadcast.
      }
    }
  }
}

/**
 * Cria um `PermissionAdapter` real para browser. Em B6 NÃO é
 * consumido por nenhum hook — apenas existe e é instanciável.
 */
export function createPermissionAdapter(): PermissionAdapter {
  return new BrowserPermissionAdapter()
}
