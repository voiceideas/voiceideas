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
 * **Não consumir em produção em B2.** Só serve para validar tipos
 * e servir como esqueleto para implementações reais em B3+.
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
