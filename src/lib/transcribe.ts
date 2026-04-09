import { getAuthenticatedFunctionHeaders } from './functionAuth'
import { isSupabaseConfigured, supabaseUrl } from './supabase'
import { sanitizeTranscript } from './speech'

interface TranscriptionResponse {
  text?: string
  error?: string
}

const MAX_TRANSCRIBE_FILE_BYTES = 10 * 1024 * 1024

function mapTranscriptionErrorMessage(message: string): string {
  if (message.includes('401')) {
    return 'Sua sessao expirou. Entre novamente para continuar transcrevendo audio.'
  }

  if (message.includes('429')) {
    return 'Voce atingiu o limite diario desta transcricao. Use o fluxo de captura por sessoes para continuar.'
  }

  if (message.includes('10 MB limit')) {
    return 'Esse audio ficou grande demais para a transcricao rapida. Use a captura por sessao para arquivos maiores.'
  }

  if (message.includes('404')) {
    return 'A funcao de transcricao ainda nao foi publicada no Supabase.'
  }

  if (message.includes('shorter than 0.1 seconds')) {
    return 'O audio chegou invalido para transcricao. Tente gravar de novo falando por um pouco mais de tempo.'
  }

  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'Nao foi possivel enviar o audio para transcricao. Verifique sua conexao.'
  }

  return message || 'Falha ao transcrever o audio.'
}

type BrowserAudioContextConstructor = new () => AudioContext

function getAudioContextConstructor(): BrowserAudioContextConstructor | null {
  if (typeof window === 'undefined') return null

  const browserWindow = window as Window & {
    webkitAudioContext?: BrowserAudioContextConstructor
  }
  const standardAudioContext = typeof AudioContext !== 'undefined'
    ? (AudioContext as BrowserAudioContextConstructor)
    : null

  return standardAudioContext || browserWindow.webkitAudioContext || null
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

function audioBufferToWavBlob(audioBuffer: AudioBuffer): Blob {
  const channelCount = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const frameCount = audioBuffer.length
  const bytesPerSample = 2
  const blockAlign = bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = frameCount * bytesPerSample
  const outputBuffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(outputBuffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sample = 0

    for (let channel = 0; channel < channelCount; channel += 1) {
      sample += audioBuffer.getChannelData(channel)[frame] || 0
    }

    sample /= channelCount || 1
    const clampedSample = Math.max(-1, Math.min(1, sample))
    const pcmValue = clampedSample < 0
      ? clampedSample * 0x8000
      : clampedSample * 0x7fff

    view.setInt16(offset, pcmValue, true)
    offset += bytesPerSample
  }

  return new Blob([outputBuffer], { type: 'audio/wav' })
}

async function normalizeAudioBlob(blob: Blob): Promise<Blob> {
  const AudioContextConstructor = getAudioContextConstructor()
  if (!AudioContextConstructor) return blob

  let audioContext: AudioContext | null = null

  try {
    const inputBuffer = await blob.arrayBuffer()
    if (!inputBuffer.byteLength) return blob

    audioContext = new AudioContextConstructor()
    const audioBuffer = await audioContext.decodeAudioData(inputBuffer.slice(0))
    const normalizedBlob = audioBufferToWavBlob(audioBuffer)

    return normalizedBlob.size > 0 ? normalizedBlob : blob
  } catch {
    return blob
  } finally {
    if (audioContext) {
      void audioContext.close().catch(() => undefined)
    }
  }
}

function getTranscribeEndpoint(): string {
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/transcribe`
}

async function parseTranscribeResponse(response: Response): Promise<TranscriptionResponse> {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    try {
      return await response.json() as TranscriptionResponse
    } catch {
      return {}
    }
  }

  try {
    const text = await response.text()
    return text ? { error: text } : {}
  } catch {
    return {}
  }
}

function getFileExtension(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('m4a')) return 'm4a'
  return 'webm'
}

async function sendTranscriptionRequest(formData: FormData, forceRefresh = false) {
  return fetch(getTranscribeEndpoint(), {
    method: 'POST',
    headers: await getAuthenticatedFunctionHeaders({}, { forceRefresh }),
    body: formData,
  })
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase nao configurado para transcrever audio.')
  }

  const normalizedBlob = await normalizeAudioBlob(blob)
  const mimeType = normalizedBlob.type || blob.type || 'audio/webm'
  const extension = getFileExtension(mimeType)
  const formData = new FormData()

  if (normalizedBlob.size > MAX_TRANSCRIBE_FILE_BYTES) {
    throw new Error('Esse audio ficou grande demais para a transcricao rapida. Use a captura por sessao para arquivos maiores.')
  }

  formData.append('file', normalizedBlob, `voice-note.${extension}`)
  formData.append('language', 'pt')

  let response = await sendTranscriptionRequest(formData)

  if (response.status === 401) {
    response = await sendTranscriptionRequest(formData, true)
  }

  const data = await parseTranscribeResponse(response)

  if (!response.ok) {
    throw new Error(mapTranscriptionErrorMessage(data.error || `Falha HTTP ${response.status}.`))
  }

  const text = sanitizeTranscript(data?.text || '')
  if (!text) {
    throw new Error('Nao foi possivel entender o audio gravado.')
  }

  return text
}
