/**
 * VI_QUEUE_TRIAGE_UX_PHASE_1 (2026-05-20)
 *
 * Wrapper que renderiza children apenas quando `visible` é true.
 * No commit 2 ele recebe `recorderUiPreferences.showCaptureFileDetails`
 * vindo do `useRecorderUiPreferences` global. Aqui a contract fica
 * isolada: o consumidor decide a fonte de truth do toggle, este
 * componente apenas aplica.
 *
 * NÃO usa estado próprio. NÃO criar nova flag (per ordem).
 */

import { Fragment, createElement, type ReactNode } from 'react'

export interface TechnicalDetailsDisclosureProps {
  visible: boolean
  children: ReactNode
}

/**
 * Implementado via `createElement` (sem JSX shorthand) para que seja
 * agnóstico ao runtime JSX do consumidor — particularmente útil quando
 * o smoke unit `__smoke__/queueCompactVisibility.smoke.tsx` é executado
 * via tsx em Node sem que o jsx-runtime esteja configurado.
 */
export function TechnicalDetailsDisclosure({
  visible,
  children,
}: TechnicalDetailsDisclosureProps) {
  if (!visible) return null
  return createElement(Fragment, null, children)
}
