/**
 * VI_CAPTURE_ENGINE_UNIFICATION — BREAK B2 (2026-05-15)
 *
 * `MediaRecorderSource` — adapter de fonte de áudio baseado na Web
 * MediaRecorder API. Usado por Safe Capture quando a plataforma é
 * web/desktop (não-Capacitor). Em B3+ vai consolidar a lógica que
 * hoje vive em `useSafeCaptureMode` (chunks via MediaRecorder, MIME
 * negotiation opus/webm/mp4).
 *
 * Para Capacitor nativo (iOS/Android com plugin), o source análogo
 * será `CapacitorPluginSource` — arquivo separado em B3.
 *
 * Para Manual no browser (downsample WAV via Web Audio API), ver
 * `webAudioSource.ts`.
 *
 * **Status (B2):** APENAS interface + stub que lança erro.
 *   - Nenhum hook consome.
 *   - Não inicia captura real.
 *   - `useSafeCaptureMode` permanece intocado.
 *
 * Spec: `docs/VI_CAPTURE_ENGINE_UNIFICATION_PLAN.md` §2 (adapter chain).
 */

import type { CaptureProfile, CaptureResult } from '../captureEngine'

/**
 * Resultado de um ciclo de captura no nível do source (antes do engine
 * orquestrar persist/transcribe/upload).
 */
export interface MediaSourceResult {
  /** Blob bruto produzido pelo source. */
  blob: Blob
  /** Formato detectado pelo MediaRecorder (depende de MIME negotiation). */
  format: CaptureResult['format']
  /** Duração estimada em milissegundos. */
  durationMs: number
  /**
   * Chunks intermediários se o source operou em modo segmentado.
   * Vazio para sources que produzem só um blob final.
   */
  chunks: ReadonlyArray<MediaSourceChunk>
}

/**
 * Fragmento de áudio produzido durante a gravação. Sources com
 * `MediaRecorder.start(timeslice)` emitem múltiplos chunks; sources
 * que produzem blob único reportam um único chunk equivalente ao
 * blob final.
 */
export interface MediaSourceChunk {
  id: string
  blob: Blob
  /** Sequência monotônica (0-indexed) na sessão. */
  sequence: number
  /** Timestamp relativo ao start() em ms. */
  startedAtMs: number
}

/**
 * Lifecycle comum a TODOS os sources (MediaRecorder, WebAudio,
 * CapacitorPlugin). Cada implementação preenche os métodos de acordo
 * com sua API nativa, mas a forma é a mesma.
 */
export interface MediaSourceLifecycle {
  /**
   * Configura e inicia gravação. O profile dita comportamento (chunks
   * vs blob único, formato preferido). Idempotente se já recording
   * com mesmo profile; reject se profile diferente.
   */
  start(profile: CaptureProfile): Promise<void>
  /** Para gravação e finaliza blob/chunks. */
  stop(): Promise<MediaSourceResult>
  /** Cancela gravação em andamento. Descarta blob. NÃO emite resultado. */
  cancel(): Promise<void>
  /** Indica se há gravação corrente. */
  readonly isRecording: boolean
}

/**
 * Source baseado em Web MediaRecorder API.
 * Usado por Safe Capture web/desktop quando plugin nativo não disponível.
 */
export interface MediaRecorderSource extends MediaSourceLifecycle {
  readonly kind: 'media-recorder'
}

/**
 * Erro lançado por stubs B2.
 */
export class MediaRecorderSourceUnimplementedError extends Error {
  constructor(method: string) {
    super(`MediaRecorderSource.${method} is not implemented yet (BREAK B2 stub).`)
    this.name = 'MediaRecorderSourceUnimplementedError'
  }
}

/**
 * Stub factory. Retorna source cujos métodos lançam erro. Não consome
 * MediaStream nem inicia gravação. Apenas para validação de tipos.
 *
 * **Mantido em B6** para tests/sentinel. Produção usa
 * `createMediaRecorderSource()`.
 */
export function createMediaRecorderSourceStub(): MediaRecorderSource {
  return {
    kind: 'media-recorder',
    isRecording: false,
    start: async () => {
      throw new MediaRecorderSourceUnimplementedError('start')
    },
    stop: async () => {
      throw new MediaRecorderSourceUnimplementedError('stop')
    },
    cancel: async () => {
      throw new MediaRecorderSourceUnimplementedError('cancel')
    },
  }
}

// ─── B6: implementação real (BrowserMediaRecorderSource) ─────────────

import type { CaptureProfile as _CaptureProfile } from '../captureEngine'
type CaptureProfileForCheck = _CaptureProfile

export type MediaRecorderSourceErrorCode =
  | 'unsupported'
  | 'mediarecorder-unavailable'
  | 'no-supported-mime'
  | 'getusermedia-unavailable'
  | 'permission-denied'
  | 'profile-mismatch'
  | 'not-recording'
  | 'recorder-error'

export class MediaRecorderSourceError extends Error {
  readonly code: MediaRecorderSourceErrorCode
  constructor(code: MediaRecorderSourceErrorCode, message: string) {
    super(`MediaRecorderSource[${code}]: ${message}`)
    this.name = 'MediaRecorderSourceError'
    this.code = code
  }
}

const PREFERRED_MIME_TYPES: ReadonlyArray<string> = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

const DEFAULT_AUTO_SEGMENTATION_TIMESLICE_MS = 5000

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const candidate of PREFERRED_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate
    } catch {
      // Browsers antigos podem throw em isTypeSupported.
    }
  }
  return null
}

function detectFormat(mimeType: string): MediaSourceResult['format'] {
  const lower = mimeType.toLowerCase()
  if (lower.includes('opus') && lower.includes('webm')) return 'opus'
  if (lower.includes('webm')) return 'webm'
  if (lower.includes('mp4')) return 'm4a'
  if (lower.includes('ogg')) return 'opus'
  return 'webm'
}

function profilesEquivalentForRecorder(
  a: CaptureProfileForCheck | null,
  b: CaptureProfileForCheck,
): boolean {
  if (!a) return false
  return (
    a.mode === b.mode &&
    a.autoSegmentation === b.autoSegmentation &&
    a.audioPreprocessor === b.audioPreprocessor &&
    a.retainAudio === b.retainAudio
  )
}

/**
 * Implementação real do source baseada em Web MediaRecorder API.
 *
 * **Limitações conhecidas (B6):**
 *   - Browser-only. Não cobre Capacitor native shell.
 *   - MIME negotiation segue lista priorizada estática (opus > webm >
 *     mp4 > ogg). Sem override por profile ainda.
 *   - `chunks` só é populado quando `profile.autoSegmentation === true`
 *     (timeslice 5s). Sem segmentação, retorna 1 chunk equivalente
 *     ao blob final para preservar o contrato.
 *   - Não consome `audioPreprocessor` — esse campo é responsabilidade
 *     do orquestrador (engine) que decide se troca MediaRecorderSource
 *     por WebAudioSource para downsample.
 *   - Idempotência de `start()` exige profile equivalente; profile
 *     diferente lança `profile-mismatch`. Sem reconfig em-vôo.
 *   - Cleanup é síncrono no fim de `stop()`/`cancel()` — se o caller
 *     chamar `stop()` e ignorar a Promise, recursos podem demorar a
 *     liberar (track stop é chamado mesmo assim).
 */
class BrowserMediaRecorderSource implements MediaRecorderSource {
  readonly kind = 'media-recorder' as const

  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private collectedBlobs: Blob[] = []
  private chunkRecords: MediaSourceChunk[] = []
  private mimeType = ''
  private startedAt = 0
  private currentProfile: CaptureProfileForCheck | null = null

  get isRecording(): boolean {
    return this.recorder?.state === 'recording'
  }

  async start(profile: CaptureProfileForCheck): Promise<void> {
    if (this.isRecording) {
      if (profilesEquivalentForRecorder(this.currentProfile, profile)) {
        return
      }
      throw new MediaRecorderSourceError(
        'profile-mismatch',
        'Já gravando com profile diferente; pare antes de iniciar outro.',
      )
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new MediaRecorderSourceError(
        'getusermedia-unavailable',
        'navigator.mediaDevices.getUserMedia indisponível no contexto.',
      )
    }

    if (typeof MediaRecorder === 'undefined') {
      throw new MediaRecorderSourceError(
        'mediarecorder-unavailable',
        'MediaRecorder API indisponível no contexto.',
      )
    }

    const mimeType = pickMimeType()
    if (!mimeType) {
      throw new MediaRecorderSourceError(
        'no-supported-mime',
        'Nenhum MIME suportado pelo MediaRecorder neste navegador.',
      )
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'denied'
      throw new MediaRecorderSourceError(
        'permission-denied',
        `getUserMedia rejeitado: ${reason}`,
      )
    }

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType })
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop())
      throw new MediaRecorderSourceError(
        'recorder-error',
        err instanceof Error ? err.message : 'falha ao instanciar MediaRecorder',
      )
    }

    this.collectedBlobs = []
    this.chunkRecords = []
    this.startedAt = Date.now()

    recorder.addEventListener('dataavailable', (event) => {
      const data = event.data
      if (data && data.size > 0) {
        this.collectedBlobs.push(data)
        this.chunkRecords.push({
          id: `mr-${this.startedAt}-${this.chunkRecords.length}`,
          blob: data,
          sequence: this.chunkRecords.length,
          startedAtMs: Date.now() - this.startedAt,
        })
      }
    })

    this.stream = stream
    this.recorder = recorder
    this.mimeType = mimeType
    this.currentProfile = profile

    if (profile.autoSegmentation) {
      recorder.start(DEFAULT_AUTO_SEGMENTATION_TIMESLICE_MS)
    } else {
      recorder.start()
    }
  }

  async stop(): Promise<MediaSourceResult> {
    const recorder = this.recorder
    if (!recorder || !this.stream) {
      throw new MediaRecorderSourceError(
        'not-recording',
        'stop() chamado sem gravação ativa.',
      )
    }

    return new Promise<MediaSourceResult>((resolve, reject) => {
      const handleStop = () => {
        try {
          const durationMs = Date.now() - this.startedAt
          const blob = new Blob(this.collectedBlobs, { type: this.mimeType })
          const format = detectFormat(this.mimeType)
          const finalChunks =
            this.chunkRecords.length > 0
              ? this.chunkRecords
              : [
                  {
                    id: `mr-${this.startedAt}-final`,
                    blob,
                    sequence: 0,
                    startedAtMs: 0,
                  },
                ]
          this.cleanup()
          resolve({ blob, format, durationMs, chunks: finalChunks })
        } catch (err) {
          this.cleanup()
          reject(
            err instanceof Error
              ? err
              : new MediaRecorderSourceError('recorder-error', 'stop handler falhou'),
          )
        }
      }

      const handleError = (event: Event) => {
        const message =
          event instanceof ErrorEvent ? event.message : 'erro do MediaRecorder'
        this.cleanup()
        reject(new MediaRecorderSourceError('recorder-error', message))
      }

      recorder.addEventListener('stop', handleStop, { once: true })
      recorder.addEventListener('error', handleError, { once: true })

      try {
        recorder.stop()
      } catch (err) {
        recorder.removeEventListener('stop', handleStop)
        recorder.removeEventListener('error', handleError)
        this.cleanup()
        reject(
          err instanceof Error
            ? err
            : new MediaRecorderSourceError('recorder-error', 'stop() lançou'),
        )
      }
    })
  }

  async cancel(): Promise<void> {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop()
      } catch {
        // swallow — cleanup garante release.
      }
    }
    this.cleanup()
  }

  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
    }
    this.stream = null
    this.recorder = null
    this.collectedBlobs = []
    this.chunkRecords = []
    this.mimeType = ''
    this.currentProfile = null
    this.startedAt = 0
  }
}

/**
 * Cria source real `MediaRecorderSource`. Em B6 NÃO é consumido por
 * nenhum hook — apenas existe e é instanciável.
 */
export function createMediaRecorderSource(): MediaRecorderSource {
  return new BrowserMediaRecorderSource()
}
