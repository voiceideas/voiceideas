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

interface ParsedWavAudio {
  sampleRate: number
  samples: Float32Array
  durationMs: number
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
  mediumSilenceMs: 800,
  longSilenceMs: 1800,
  minChunkMs: 4000,
  analysisWindowMs: 150,
  strongDelimiterPhrase: null,
}

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

function parseWavPcm(audioBuffer: ArrayBuffer): ParsedWavAudio | null {
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
  parsedAudio: ParsedWavAudio,
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
    settings.analysisWindowMs * 2,
    Math.min(600, Math.floor(settings.mediumSilenceMs * 0.45)),
  )
  const bridgeSpeechMs = Math.max(
    300,
    Math.min(900, Math.floor(settings.mediumSilenceMs * 0.6)),
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
      : settings.minChunkMs

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

export function planAudioSegmentation(
  audioBuffer: ArrayBuffer,
  totalDurationMs: number,
  input: Partial<SegmentationSettings>,
): SegmentationResult {
  const settings = clampSettings(input)
  const parsedAudio = parseWavPcm(audioBuffer)

  if (!parsedAudio) {
    const fallback = buildSinglePassSegments(totalDurationMs)

    return {
      ...fallback,
      strongDelimiterPrepared: Boolean(settings.strongDelimiterPhrase),
      settings,
    }
  }

  const plannedSegments = deriveSilenceBoundaries(parsedAudio, settings)

  if (!plannedSegments.length) {
    const fallback = buildSinglePassSegments(parsedAudio.durationMs || totalDurationMs)

    return {
      ...fallback,
      strongDelimiterPrepared: Boolean(settings.strongDelimiterPhrase),
      settings,
      totalDurationMs: parsedAudio.durationMs || totalDurationMs,
    }
  }

  return {
    segments: plannedSegments,
    usedFallback: false,
    strategy: 'wav-silence',
    strongDelimiterPrepared: Boolean(settings.strongDelimiterPhrase),
    settings,
    totalDurationMs: parsedAudio.durationMs || totalDurationMs,
  }
}

export function buildChunkAudioFile(
  audioBuffer: ArrayBuffer,
  segment: AudioSegmentPlan,
): Uint8Array | null {
  const parsedAudio = parseWavPcm(audioBuffer)

  if (!parsedAudio) {
    return null
  }

  const startSample = Math.max(0, Math.floor((segment.startMs / 1000) * parsedAudio.sampleRate))
  const endSample = Math.min(parsedAudio.samples.length, Math.ceil((segment.endMs / 1000) * parsedAudio.sampleRate))

  if (endSample <= startSample) {
    return null
  }

  return encodeWavMono16(parsedAudio.samples.slice(startSample, endSample), parsedAudio.sampleRate)
}
