import decodeWebmAudio from 'npm:@audio/webm-decode'
import { createDecodeAudioModule } from './vendor/audio-file-decoder-module.js'
import { decodeAudioWasmBase64 } from './vendor/decode-audio-wasm.ts'

export type SegmentationReason =
  | 'strong-delimiter'
  | 'probable-silence'
  | 'structural-silence'
  | 'session-end'
  | 'manual-stop'
  | 'single-pass'
  | 'fallback'
  | 'unknown'

export interface SegmentationSettings {
  mediumSilenceMs: number
  longSilenceMs: number
  minChunkMs: number
  analysisWindowMs: number
  strongDelimiterPhrase?: string | null
}

export interface AudioSegmentPlan {
  startMs: number
  endMs: number
  durationMs: number
  segmentationReason: SegmentationReason
}

interface ParsedSegmentableAudio {
  sampleRate: number
  samples: Float32Array
  durationMs: number
  sourceFormat: 'wav-pcm' | 'decoded-compressed'
}

export interface AudioSegmentationDiagnostics {
  detectedContainer: 'wav' | 'mp4' | 'webm' | 'unknown'
  parsedFormat: ParsedSegmentableAudio['sourceFormat'] | null
  compressedDecodeError: string | null
}

export interface SegmentationResult {
  segments: AudioSegmentPlan[]
  usedFallback: boolean
  strategy: 'wav-silence' | 'single-pass'
  strongDelimiterPrepared: boolean
  settings: SegmentationSettings
  totalDurationMs: number
}

const DEFAULT_SETTINGS: SegmentationSettings = {
  mediumSilenceMs: 1250,
  longSilenceMs: 2600,
  minChunkMs: 4000,
  analysisWindowMs: 150,
  strongDelimiterPhrase: null,
}

let decodeAudioWasmBytes: Uint8Array | null = null

function clampSettings(input: Partial<SegmentationSettings>): SegmentationSettings {
  const mediumSilenceMs = Math.min(2500, Math.max(600, Math.floor(input.mediumSilenceMs ?? DEFAULT_SETTINGS.mediumSilenceMs)))
  const longSilenceMs = Math.min(8000, Math.max(1400, Math.floor(input.longSilenceMs ?? DEFAULT_SETTINGS.longSilenceMs)))
  const minChunkMs = Math.min(12000, Math.max(2500, Math.floor(input.minChunkMs ?? DEFAULT_SETTINGS.minChunkMs)))
  const analysisWindowMs = Math.min(400, Math.max(80, Math.floor(input.analysisWindowMs ?? DEFAULT_SETTINGS.analysisWindowMs)))

  return {
    mediumSilenceMs,
    longSilenceMs: Math.max(longSilenceMs, mediumSilenceMs + 600),
    minChunkMs,
    analysisWindowMs,
    strongDelimiterPhrase: input.strongDelimiterPhrase?.trim() || null,
  }
}

function getPercentile(sortedValues: number[], ratio: number) {
  if (!sortedValues.length) {
    return 0
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor(sortedValues.length * ratio)),
  )

  return sortedValues[index] || 0
}

function classifySilenceRun(
  durationMs: number,
  settings: SegmentationSettings,
): 'probable-silence' | 'structural-silence' | null {
  if (durationMs >= settings.longSilenceMs) {
    return 'structural-silence'
  }

  if (durationMs >= settings.mediumSilenceMs) {
    return 'probable-silence'
  }

  return null
}

function readAscii(view: DataView, offset: number, length: number) {
  let value = ''

  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index))
  }

  return value
}

function parseWavPcm(audioBuffer: ArrayBuffer): ParsedSegmentableAudio | null {
  const view = new DataView(audioBuffer)

  if (view.byteLength < 44) return null
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    return null
  }

  let offset = 12
  let audioFormat = 0
  let channelCount = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let dataOffset = 0
  let dataLength = 0

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4)
    const chunkSize = view.getUint32(offset + 4, true)
    const chunkDataOffset = offset + 8

    if (chunkId === 'fmt ' && chunkSize >= 16) {
      audioFormat = view.getUint16(chunkDataOffset, true)
      channelCount = view.getUint16(chunkDataOffset + 2, true)
      sampleRate = view.getUint32(chunkDataOffset + 4, true)
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true)
    }

    if (chunkId === 'data') {
      dataOffset = chunkDataOffset
      dataLength = chunkSize
      break
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2)
  }

  if (!dataOffset || !dataLength || !sampleRate || !channelCount || !bitsPerSample) {
    return null
  }

  const bytesPerSample = bitsPerSample / 8
  const bytesPerFrame = bytesPerSample * channelCount

  if (!bytesPerFrame || dataLength % bytesPerFrame !== 0) {
    return null
  }

  if (!(audioFormat === 1 || audioFormat === 3)) {
    return null
  }

  if (!(bitsPerSample === 16 || bitsPerSample === 24 || bitsPerSample === 32)) {
    return null
  }

  const frameCount = Math.floor(dataLength / bytesPerFrame)
  const samples = new Float32Array(frameCount)

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let total = 0

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sampleOffset = dataOffset + frameIndex * bytesPerFrame + channelIndex * bytesPerSample

      if (audioFormat === 3 && bitsPerSample === 32) {
        total += view.getFloat32(sampleOffset, true)
      } else if (audioFormat === 1 && bitsPerSample === 32) {
        total += view.getInt32(sampleOffset, true) / 0x80000000
      } else if (audioFormat === 1 && bitsPerSample === 24) {
        const byte0 = view.getUint8(sampleOffset)
        const byte1 = view.getUint8(sampleOffset + 1)
        const byte2 = view.getUint8(sampleOffset + 2)
        const packed = byte0 | (byte1 << 8) | (byte2 << 16)
        const signed = (packed << 8) >> 8

        total += signed / 0x800000
      } else {
        total += view.getInt16(sampleOffset, true) / 0x8000
      }
    }

    samples[frameIndex] = total / channelCount
  }

  return {
    sampleRate,
    samples,
    durationMs: Math.round((frameCount / sampleRate) * 1000),
    sourceFormat: 'wav-pcm',
  }
}

function detectAudioContainer(audioBuffer: ArrayBuffer) {
  const view = new DataView(audioBuffer)

  if (view.byteLength >= 12 && readAscii(view, 0, 4) === 'RIFF' && readAscii(view, 8, 4) === 'WAVE') {
    return 'wav'
  }

  if (view.byteLength >= 12 && readAscii(view, 4, 4) === 'ftyp') {
    return 'mp4'
  }

  if (
    view.byteLength >= 4
    && view.getUint8(0) === 0x1a
    && view.getUint8(1) === 0x45
    && view.getUint8(2) === 0xdf
    && view.getUint8(3) === 0xa3
  ) {
    return 'webm'
  }

  return 'unknown'
}

function getDecodeAudioWasmBytes() {
  if (!decodeAudioWasmBytes) {
    const binary = atob(decodeAudioWasmBase64)
    decodeAudioWasmBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  }

  return decodeAudioWasmBytes
}

async function decodeWebmAudioBuffer(audioBuffer: ArrayBuffer): Promise<{
  parsedAudio: ParsedSegmentableAudio | null
  error: string | null
}> {
  try {
    const decoded = await decodeWebmAudio(audioBuffer.slice(0))
    const channelData = Array.isArray(decoded?.channelData) ? decoded.channelData : []
    const sampleRate = decoded?.sampleRate

    if (!Number.isFinite(sampleRate) || sampleRate <= 0 || channelData.length === 0) {
      return { parsedAudio: null, error: 'webm decoder returned no usable audio channels' }
    }

    const frameCount = channelData[0]?.length ?? 0
    if (frameCount <= 0) {
      return { parsedAudio: null, error: 'webm decoder returned empty PCM output' }
    }

    const monoSamples = new Float32Array(frameCount)
    for (let channelIndex = 0; channelIndex < channelData.length; channelIndex += 1) {
      const channelSamples = channelData[channelIndex]
      if (!(channelSamples instanceof Float32Array) || channelSamples.length !== frameCount) {
        return { parsedAudio: null, error: 'webm decoder returned inconsistent channel lengths' }
      }

      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        monoSamples[frameIndex] += channelSamples[frameIndex] / channelData.length
      }
    }

    return {
      parsedAudio: {
        sampleRate,
        samples: monoSamples,
        durationMs: Math.round((frameCount / sampleRate) * 1000),
        sourceFormat: 'decoded-compressed',
      },
      error: null,
    }
  } catch (error) {
    return {
      parsedAudio: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function decodeCompressedAudio(audioBuffer: ArrayBuffer): Promise<{
  parsedAudio: ParsedSegmentableAudio | null
  error: string | null
}> {
  const container = detectAudioContainer(audioBuffer)
  if (!(container === 'mp4' || container === 'webm')) {
    return { parsedAudio: null, error: null }
  }

  let webmDecodeError: string | null = null
  if (container === 'webm') {
    const webmDecodedAudio = await decodeWebmAudioBuffer(audioBuffer)
    if (webmDecodedAudio.parsedAudio) {
      return webmDecodedAudio
    }

    webmDecodeError = webmDecodedAudio.error
  }

  const inputFileName = container === 'webm' ? 'input.webm' : 'input.mp4'
  let decoderModule: Awaited<ReturnType<typeof createDecodeAudioModule>> | null = null

  try {
    decoderModule = await createDecodeAudioModule({
      wasmBinary: getDecodeAudioWasmBytes().slice(),
    })
    decoderModule.FS.writeFile(inputFileName, new Uint8Array(audioBuffer.slice(0)))

    const properties = decoderModule.getProperties(inputFileName)
    const propertyStatus = properties?.status?.status ?? -1
    if (propertyStatus < 0) {
      return {
        parsedAudio: null,
        error: [
          webmDecodeError,
          properties?.status?.error || 'decoder could not inspect compressed audio input',
        ].filter(Boolean).join(' | '),
      }
    }

    const sampleRate = properties?.sampleRate
    const decoded = decoderModule.decodeAudio(inputFileName, 0, -1, { multiChannel: false })
    const decodeStatus = decoded?.status?.status ?? -1
    const decodeError = decoded?.status?.error || 'decoder returned an unknown audio decode error'

    if (decodeStatus < 0) {
      decoded?.samples?.delete?.()
      return {
        parsedAudio: null,
        error: [webmDecodeError, decodeError].filter(Boolean).join(' | '),
      }
    }

    const sampleCount = decoded?.samples?.size?.() ?? 0
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleCount <= 0) {
      decoded?.samples?.delete?.()
      return { parsedAudio: null, error: 'decoder returned empty or invalid PCM output' }
    }

    const samples = new Float32Array(sampleCount)
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = decoded.samples.get(index)
    }
    decoded.samples.delete()

    return {
      parsedAudio: {
        sampleRate,
        samples,
        durationMs: Math.round((samples.length / sampleRate) * 1000),
        sourceFormat: 'decoded-compressed',
      },
      error: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const combinedError = [webmDecodeError, message].filter(Boolean).join(' | ')
    console.warn('[segment-audio] compressed decode failed', {
      container,
      error: combinedError,
    })
    return { parsedAudio: null, error: combinedError }
  } finally {
    try {
      decoderModule?.FS.unlink(inputFileName)
    } catch {
      // Best effort cleanup only. Each decode call uses an isolated module instance.
    }
  }
}

async function parseAudioForSegmentation(audioBuffer: ArrayBuffer) {
  const detectedContainer = detectAudioContainer(audioBuffer)
  const parsedWavAudio = parseWavPcm(audioBuffer)
  if (parsedWavAudio) {
    return {
      parsedAudio: parsedWavAudio,
      diagnostics: {
        detectedContainer,
        parsedFormat: parsedWavAudio.sourceFormat,
        compressedDecodeError: null,
      },
    }
  }

  const decodedCompressedAudio = await decodeCompressedAudio(audioBuffer)

  return {
    parsedAudio: decodedCompressedAudio.parsedAudio,
    diagnostics: {
      detectedContainer,
      parsedFormat: decodedCompressedAudio.parsedAudio?.sourceFormat ?? null,
      compressedDecodeError: decodedCompressedAudio.error,
    },
  }
}

function encodeWavMono16(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2
  const dataLength = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataLength, true)

  let bufferOffset = 44

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] || 0))
    const pcmValue = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    view.setInt16(bufferOffset, pcmValue, true)
    bufferOffset += bytesPerSample
  }

  return new Uint8Array(buffer)
}

function buildSinglePassSegments(durationMs: number): SegmentationResult {
  const settings = clampSettings({})

  return {
    segments: [{
      startMs: 0,
      endMs: durationMs,
      durationMs,
      segmentationReason: 'single-pass',
    }],
    usedFallback: true,
    strategy: 'single-pass',
    strongDelimiterPrepared: false,
    settings,
    totalDurationMs: durationMs,
  }
}

function deriveSilenceBoundaries(
  parsedAudio: ParsedSegmentableAudio,
  settings: SegmentationSettings,
): AudioSegmentPlan[] {
  const windowSize = Math.max(1, Math.floor((parsedAudio.sampleRate * settings.analysisWindowMs) / 1000))
  const rmsWindows: Array<{ startMs: number; endMs: number; rms: number }> = []

  for (let offset = 0; offset < parsedAudio.samples.length; offset += windowSize) {
    const end = Math.min(parsedAudio.samples.length, offset + windowSize)
    let energy = 0

    for (let sampleIndex = offset; sampleIndex < end; sampleIndex += 1) {
      const sample = parsedAudio.samples[sampleIndex] || 0
      energy += sample * sample
    }

    const rms = Math.sqrt(energy / Math.max(1, end - offset))
    rmsWindows.push({
      startMs: Math.round((offset / parsedAudio.sampleRate) * 1000),
      endMs: Math.round((end / parsedAudio.sampleRate) * 1000),
      rms,
    })
  }

  if (!rmsWindows.length) {
    return []
  }

  const sortedRms = rmsWindows.map((window) => window.rms).sort((left, right) => left - right)
  const baseline = getPercentile(sortedRms, 0.18)
  const speechFloor = getPercentile(sortedRms, 0.6)
  const speechCeiling = getPercentile(sortedRms, 0.82)
  const dynamicRange = Math.max(0, speechFloor - baseline, speechCeiling - baseline)
  const adaptiveThreshold = baseline + Math.max(0.0006, dynamicRange * 0.18)
  const silenceThreshold = Math.min(
    Math.max(0.0015, adaptiveThreshold),
    Math.max(0.0032, speechFloor * 0.52),
  )
  const minimumTrackedSilenceMs = Math.max(
    Math.floor(settings.analysisWindowMs * 2.5),
    Math.min(850, Math.floor(settings.mediumSilenceMs * 0.52)),
  )
  const bridgeSpeechMs = Math.max(
    260,
    Math.min(720, Math.floor(settings.mediumSilenceMs * 0.42)),
  )

  const rawSilenceRuns: Array<{
    startMs: number
    endMs: number
  }> = []

  let runStart: number | null = null
  let runEnd = 0

  for (const window of rmsWindows) {
    if (window.rms <= silenceThreshold) {
      if (runStart === null) {
        runStart = window.startMs
      }
      runEnd = window.endMs
      continue
    }

    if (runStart !== null) {
      const silenceDuration = runEnd - runStart
      if (silenceDuration >= minimumTrackedSilenceMs) {
        rawSilenceRuns.push({ startMs: runStart, endMs: runEnd })
      }
      runStart = null
      runEnd = 0
    }
  }

  if (runStart !== null) {
    const silenceDuration = runEnd - runStart
    if (silenceDuration >= minimumTrackedSilenceMs) {
      rawSilenceRuns.push({ startMs: runStart, endMs: runEnd })
    }
  }

  const silenceRuns: Array<{
    startMs: number
    endMs: number
    reason: 'probable-silence' | 'structural-silence'
  }> = []

  for (const silenceRun of rawSilenceRuns) {
    const previousRun = silenceRuns[silenceRuns.length - 1]
    if (previousRun && silenceRun.startMs - previousRun.endMs <= bridgeSpeechMs) {
      const mergedEndMs = silenceRun.endMs
      const mergedDuration = mergedEndMs - previousRun.startMs
      const mergedReason = classifySilenceRun(mergedDuration, settings)

      previousRun.endMs = mergedEndMs
      previousRun.reason = mergedReason || previousRun.reason
      continue
    }

    const reason = classifySilenceRun(silenceRun.endMs - silenceRun.startMs, settings)
    if (!reason) {
      continue
    }

    silenceRuns.push({
      startMs: silenceRun.startMs,
      endMs: silenceRun.endMs,
      reason,
    })
  }

  const segments: AudioSegmentPlan[] = []
  let segmentStartMs = 0

  for (const silenceRun of silenceRuns) {
    const boundaryMs = Math.round((silenceRun.startMs + silenceRun.endMs) / 2)
    const segmentDuration = boundaryMs - segmentStartMs
    const minimumBoundarySegmentMs = silenceRun.reason === 'structural-silence'
      ? Math.max(2500, Math.floor(settings.minChunkMs * 0.75))
      : Math.max(settings.minChunkMs, Math.floor(settings.mediumSilenceMs * 3.2))

    if (segmentDuration < minimumBoundarySegmentMs) {
      continue
    }

    segments.push({
      startMs: segmentStartMs,
      endMs: boundaryMs,
      durationMs: segmentDuration,
      segmentationReason: silenceRun.reason,
    })
    segmentStartMs = boundaryMs
  }

  const remainingDuration = parsedAudio.durationMs - segmentStartMs

  if (!segments.length && remainingDuration > 0) {
    return []
  }

  if (remainingDuration >= Math.max(1500, Math.floor(settings.minChunkMs / 2))) {
    segments.push({
      startMs: segmentStartMs,
      endMs: parsedAudio.durationMs,
      durationMs: remainingDuration,
      segmentationReason: 'session-end',
    })
  } else if (segments.length > 0) {
    const lastSegment = segments[segments.length - 1]
    lastSegment.endMs = parsedAudio.durationMs
    lastSegment.durationMs = lastSegment.endMs - lastSegment.startMs
  }

  return segments.filter((segment) => segment.durationMs > 0)
}

export async function prepareAudioSegmentation(
  audioBuffer: ArrayBuffer,
  totalDurationMs: number,
  input: Partial<SegmentationSettings>,
): Promise<{
  segmentation: SegmentationResult
  parsedAudio: ParsedSegmentableAudio | null
  diagnostics: AudioSegmentationDiagnostics
}> {
  const settings = clampSettings(input)
  const { parsedAudio, diagnostics } = await parseAudioForSegmentation(audioBuffer)

  if (!parsedAudio) {
    const fallback = buildSinglePassSegments(totalDurationMs)

    return {
      segmentation: {
        ...fallback,
        strongDelimiterPrepared: Boolean(settings.strongDelimiterPhrase),
        settings,
      },
      parsedAudio: null,
      diagnostics,
    }
  }

  const plannedSegments = deriveSilenceBoundaries(parsedAudio, settings)

  if (!plannedSegments.length) {
    const fallback = buildSinglePassSegments(parsedAudio.durationMs || totalDurationMs)

    return {
      segmentation: {
        ...fallback,
        strongDelimiterPrepared: Boolean(settings.strongDelimiterPhrase),
        settings,
        totalDurationMs: parsedAudio.durationMs || totalDurationMs,
      },
      parsedAudio,
      diagnostics,
    }
  }

  return {
    segmentation: {
      segments: plannedSegments,
      usedFallback: false,
      strategy: 'wav-silence',
      strongDelimiterPrepared: Boolean(settings.strongDelimiterPhrase),
      settings,
      totalDurationMs: parsedAudio.durationMs || totalDurationMs,
    },
    parsedAudio,
    diagnostics,
  }
}

export function buildChunkAudioFileFromParsedAudio(
  parsedAudio: ParsedSegmentableAudio,
  segment: AudioSegmentPlan,
): Uint8Array | null {
  const startSample = Math.max(0, Math.floor((segment.startMs / 1000) * parsedAudio.sampleRate))
  const endSample = Math.min(parsedAudio.samples.length, Math.ceil((segment.endMs / 1000) * parsedAudio.sampleRate))

  if (endSample <= startSample) {
    return null
  }

  return encodeWavMono16(parsedAudio.samples.slice(startSample, endSample), parsedAudio.sampleRate)
}
