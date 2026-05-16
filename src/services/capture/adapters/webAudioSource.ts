/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B2 (2026-05-15)
 *
 * `WebAudioSource` — adapter de fonte de áudio baseado em Web Audio API
 * (AudioContext + MediaStreamSource + ScriptProcessorNode + WAV encode).
 * Reproduz a lógica que hoje vive em `useAudioTranscription` (Manual
 * web): captura samples Float32, downsample 16kHz, encoda WAV
 * compatível com edge `transcribe`.
 *
 * **Quando é necessário?**
 *   - Manual mode no browser/desktop sem plugin nativo Capacitor.
 *   - Quando profile pede `audioPreprocessor: 'downsample_16k_wav'`
 *     (modo legado / opt-in).
 *
 * **Quando NÃO é necessário?**
 *   - Per D2 (formato nativo), o default em retainAudio=true é
 *     `audioPreprocessor: 'native'` — engine usa MediaRecorderSource
 *     ou CapacitorPluginSource diretamente, sem este preprocessor.
 *   - Manual no native shell (Capacitor) usa CapacitorPluginSource.
 *
 * **Status (B2):** APENAS interface + stub.
 *   - Nenhum hook consome.
 *   - `useAudioTranscription` permanece intocado.
 *   - Implementação real (extração da lógica WAV/downsample) em B3+.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §2 (adapter chain).
 */

import type { MediaSourceLifecycle } from './mediaRecorderSource'

// Re-export para conveniência (consumers podem importar MediaSourceLifecycle
// daqui se já estiverem usando WebAudioSource — evita 2 imports).
export type { MediaSourceLifecycle }

/**
 * Source baseado em Web Audio API + downsample manual.
 * Específico para Manual web quando precisamos garantir formato WAV
 * 16kHz mono compatível com a edge function `transcribe` legada.
 */
export interface WebAudioSource extends MediaSourceLifecycle {
  readonly kind: 'web-audio'
  /** Sample rate de saída (alvo do downsample). Default 16000. */
  readonly targetSampleRate: number
}

export class WebAudioSourceUnimplementedError extends Error {
  constructor(method: string) {
    super(`WebAudioSource.${method} is not implemented yet (BREAK B2 stub).`)
    this.name = 'WebAudioSourceUnimplementedError'
  }
}

/**
 * Stub factory. Retorna source cujos métodos lançam erro. Não toca
 * AudioContext nem MediaStream.
 *
 * **Não consumir em produção em B2.** Implementação real (extração
 * da lógica de `useAudioTranscription`/`src/lib/transcribe.ts`) em
 * B3+.
 */
export function createWebAudioSourceStub(): WebAudioSource {
  return {
    kind: 'web-audio',
    isRecording: false,
    targetSampleRate: 16000,
    start: async () => {
      throw new WebAudioSourceUnimplementedError('start')
    },
    stop: async () => {
      throw new WebAudioSourceUnimplementedError('stop')
    },
    cancel: async () => {
      throw new WebAudioSourceUnimplementedError('cancel')
    },
  }
}
