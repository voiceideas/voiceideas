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
 * **Mantido em B6** para tests/sentinel. Produção usa
 * `createWebAudioSource()`.
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

// ─── B6: implementação real (BrowserWebAudioSource) ──────────────────

import type { CaptureProfile, CaptureResult } from '../captureEngine'
import type { MediaSourceResult } from './mediaRecorderSource'

export type WebAudioSourceErrorCode =
  | 'unsupported'
  | 'audiocontext-unavailable'
  | 'getusermedia-unavailable'
  | 'permission-denied'
  | 'profile-mismatch'
  | 'not-recording'
  | 'audio-error'

export class WebAudioSourceError extends Error {
  readonly code: WebAudioSourceErrorCode
  constructor(code: WebAudioSourceErrorCode, message: string) {
    super(`WebAudioSource[${code}]: ${message}`)
    this.name = 'WebAudioSourceError'
    this.code = code
  }
}

const TARGET_SAMPLE_RATE_HZ = 16000
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096

type BrowserAudioContextConstructor = new (
  contextOptions?: AudioContextOptions,
) => AudioContext

function getAudioContextConstructor(): BrowserAudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  const browserWindow = window as Window & {
    webkitAudioContext?: BrowserAudioContextConstructor
  }
  const standard =
    typeof AudioContext !== 'undefined'
      ? (AudioContext as BrowserAudioContextConstructor)
      : null
  return standard || browserWindow.webkitAudioContext || null
}

/**
 * Concatena chunks Float32Array em um único buffer linear.
 * Implementação local (sem importar de `transcribe.ts`) para manter
 * o adapter self-contained per ordem B6.
 */
function flattenSampleChunks(chunks: ReadonlyArray<Float32Array>): Float32Array {
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * Downsample por interpolação linear de samples Float32 mono.
 * Heurística simples (não usa filtro anti-aliasing) — alinhada com o
 * comportamento de `useAudioTranscription` atual. Aceitável para a
 * pipeline `transcribe` (Whisper) que tolera artefatos leves.
 */
function downsampleMono(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (outputRate >= inputRate) {
    return new Float32Array(input)
  }
  const ratio = inputRate / outputRate
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i += 1) {
    const idx = i * ratio
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, input.length - 1)
    const frac = idx - lo
    out[i] = (input[lo] ?? 0) * (1 - frac) + (input[hi] ?? 0) * frac
  }
  return out
}

/**
 * Encoda samples Float32 mono em WAV PCM 16-bit (formato aceito pelo
 * edge function `transcribe`). Implementação local self-contained.
 */
function encodeWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const blockAlign = 2 // 16-bit mono
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // format = PCM
  view.setUint16(22, 1, true) // channels = mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0))
    const pcm = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    view.setInt16(offset, pcm, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function profilesEquivalentForWebAudio(
  a: CaptureProfile | null,
  b: CaptureProfile,
): boolean {
  if (!a) return false
  return (
    a.mode === b.mode &&
    a.audioPreprocessor === b.audioPreprocessor &&
    a.retainAudio === b.retainAudio
  )
}

/**
 * Implementação real do source baseada em Web Audio API (AudioContext
 * + MediaStreamSource + ScriptProcessorNode + downsample 16kHz WAV).
 *
 * Reproduz independentemente a lógica que vive hoje em
 * `useAudioTranscription` — SEM importar nem modificar esse hook,
 * conforme guardrail de B6. Quando consumo real chegar (B7+), pode-se
 * convergir as duas implementações ou aposentar a do hook.
 *
 * **Limitações conhecidas (B6):**
 *   - `ScriptProcessorNode` é deprecated; navegadores ainda suportam
 *     mas em algum momento será necessário migrar para `AudioWorklet`.
 *     Convergência com o caminho legado de `useAudioTranscription`
 *     fica para B7+.
 *   - Downsample por interpolação linear simples — sem filtro
 *     anti-aliasing. Aceitável para Whisper; ruim para playback Hi-Fi.
 *   - Sempre produz WAV 16kHz mono — ignora `audioPreprocessor` se
 *     for diferente de `'downsample_16k_wav'` (caller é responsável
 *     por escolher MediaRecorderSource quando quiser 'native').
 *   - Browser-only. Capacitor native shell tem `WebAudio` parcial em
 *     iOS; comportamento não validado neste adapter.
 *   - `chunks` retornado é vazio — WebAudio não emite chunks
 *     intermediários nesta implementação.
 *   - Sem suporte a iOS Safari pre-14.5 (AudioContext.resume() em
 *     cenários sem gesture). Risco mitigado em B7+ por capability check.
 */
class BrowserWebAudioSource implements WebAudioSource {
  readonly kind = 'web-audio' as const
  readonly targetSampleRate = TARGET_SAMPLE_RATE_HZ

  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private processorNode: ScriptProcessorNode | null = null
  private sampleChunks: Float32Array[] = []
  private currentProfile: CaptureProfile | null = null
  private startedAt = 0
  private inputSampleRate = 0

  get isRecording(): boolean {
    return (
      this.audioContext !== null && this.audioContext.state === 'running'
    )
  }

  async start(profile: CaptureProfile): Promise<void> {
    if (this.isRecording) {
      if (profilesEquivalentForWebAudio(this.currentProfile, profile)) {
        return
      }
      throw new WebAudioSourceError(
        'profile-mismatch',
        'Já gravando com profile diferente; pare antes de iniciar outro.',
      )
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new WebAudioSourceError(
        'getusermedia-unavailable',
        'navigator.mediaDevices.getUserMedia indisponível.',
      )
    }

    const AudioCtx = getAudioContextConstructor()
    if (!AudioCtx) {
      throw new WebAudioSourceError(
        'audiocontext-unavailable',
        'AudioContext indisponível neste contexto.',
      )
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'denied'
      throw new WebAudioSourceError(
        'permission-denied',
        `getUserMedia rejeitado: ${reason}`,
      )
    }

    let context: AudioContext
    let source: MediaStreamAudioSourceNode
    let processor: ScriptProcessorNode
    try {
      context = new AudioCtx()
      source = context.createMediaStreamSource(stream)
      processor = context.createScriptProcessor(
        SCRIPT_PROCESSOR_BUFFER_SIZE,
        1,
        1,
      )
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop())
      throw new WebAudioSourceError(
        'audio-error',
        err instanceof Error ? err.message : 'falha ao montar grafo de áudio',
      )
    }

    this.sampleChunks = []
    this.startedAt = Date.now()
    this.inputSampleRate = context.sampleRate

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      // Cópia para desacoplar do buffer do navegador (que pode reusar).
      this.sampleChunks.push(new Float32Array(input))
    }

    source.connect(processor)
    processor.connect(context.destination)

    this.audioContext = context
    this.mediaStream = stream
    this.sourceNode = source
    this.processorNode = processor
    this.currentProfile = profile
  }

  async stop(): Promise<MediaSourceResult> {
    if (!this.audioContext || !this.mediaStream) {
      throw new WebAudioSourceError(
        'not-recording',
        'stop() chamado sem gravação ativa.',
      )
    }

    const durationMs = Date.now() - this.startedAt
    const flattened = flattenSampleChunks(this.sampleChunks)
    const downsampled = downsampleMono(
      flattened,
      this.inputSampleRate,
      this.targetSampleRate,
    )
    const blob = encodeWavBlob(downsampled, this.targetSampleRate)

    this.cleanup()

    const format: CaptureResult['format'] = 'wav'
    return {
      blob,
      format,
      durationMs,
      chunks: [],
    }
  }

  async cancel(): Promise<void> {
    this.cleanup()
  }

  private cleanup(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect()
      } catch {
        // swallow
      }
    }
    if (this.processorNode) {
      try {
        this.processorNode.disconnect()
      } catch {
        // swallow
      }
      this.processorNode.onaudioprocess = null
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop())
    }
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined)
    }
    this.audioContext = null
    this.mediaStream = null
    this.sourceNode = null
    this.processorNode = null
    this.sampleChunks = []
    this.currentProfile = null
    this.startedAt = 0
    this.inputSampleRate = 0
  }
}

/**
 * Cria source real `WebAudioSource`. Em B6 NÃO é consumido por
 * nenhum hook — apenas existe e é instanciável.
 */
export function createWebAudioSource(): WebAudioSource {
  return new BrowserWebAudioSource()
}
