/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B2 (2026-05-15)
 *
 * Barrel re-exporter dos adapters do CaptureEngine.
 *
 * **Status (B2):** TODOS os exports são stubs que lançam erro se
 * chamados em runtime. Nenhuma implementação real ainda. Nenhum
 * consumo no app — só validação de tipos e esqueleto.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §2.
 */

// Permission ─────────────────────────────────────────────────────────
export type {
  PermissionAdapter,
  PermissionSnapshot,
  PermissionChangeListener,
  PermissionAdapterErrorCode,
} from './permissionAdapter'
export {
  PermissionAdapterUnimplementedError,
  createPermissionAdapterStub,
  // B6: implementação real
  createPermissionAdapter,
} from './permissionAdapter'

// Media sources ──────────────────────────────────────────────────────
export type {
  MediaSourceLifecycle,
  MediaSourceResult,
  MediaSourceChunk,
  MediaRecorderSource,
  MediaRecorderSourceErrorCode,
} from './mediaRecorderSource'
export {
  MediaRecorderSourceUnimplementedError,
  createMediaRecorderSourceStub,
  // B6: implementação real
  MediaRecorderSourceError,
  createMediaRecorderSource,
} from './mediaRecorderSource'

export type {
  WebAudioSource,
  WebAudioSourceErrorCode,
} from './webAudioSource'
export {
  WebAudioSourceUnimplementedError,
  createWebAudioSourceStub,
  // B6: implementação real
  WebAudioSourceError,
  createWebAudioSource,
} from './webAudioSource'
