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

import type { ReactNode } from 'react'

export interface TechnicalDetailsDisclosureProps {
  visible: boolean
  children: ReactNode
}

export function TechnicalDetailsDisclosure({
  visible,
  children,
}: TechnicalDetailsDisclosureProps) {
  if (!visible) return null
  return <>{children}</>
}
