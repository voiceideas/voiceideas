import { supabase } from '../lib/supabase'
import { getPlatformSource } from '../lib/platform'

const CAPTURE_BUCKET = 'voice-captures'

export interface AudioPlaybackSource {
  url: string
  mimeType?: string
  originalUrl?: string
  revokeOnDispose?: boolean
}

function normalizePlaybackMimeType(mimeType: string | null | undefined) {
  if (!mimeType) {
    return 'audio/mp4'
  }

  const normalizedMimeType = mimeType.toLowerCase()

  if (normalizedMimeType.includes('audio/m4a') || normalizedMimeType.includes('audio/x-m4a')) {
    return 'audio/mp4'
  }

  if (normalizedMimeType.includes('audio/mp4')) {
    return 'audio/mp4'
  }

  if (normalizedMimeType.includes('audio/mpeg')) {
    return 'audio/mpeg'
  }

  if (normalizedMimeType.includes('audio/wav')) {
    return 'audio/wav'
  }

  if (normalizedMimeType.includes('audio/ogg')) {
    return 'audio/ogg'
  }

  if (normalizedMimeType.includes('audio/webm')) {
    return 'audio/webm'
  }

  return mimeType
}

function inferPlaybackMimeTypeFromStoragePath(storagePath: string, fallback = 'audio/mp4') {
  const lowerPath = storagePath.toLowerCase()

  if (lowerPath.endsWith('.wav')) return 'audio/wav'
  if (lowerPath.endsWith('.mp3')) return 'audio/mpeg'
  if (lowerPath.endsWith('.ogg')) return 'audio/ogg'
  if (lowerPath.endsWith('.webm')) return 'audio/webm'
  if (lowerPath.endsWith('.m4a') || lowerPath.endsWith('.mp4')) return 'audio/mp4'

  return fallback
}

async function createBlobPlaybackSourceFromSignedUrl(
  storagePath: string,
  signedUrl: string,
): Promise<AudioPlaybackSource> {
  const response = await fetch(signedUrl)

  if (!response.ok) {
    throw new Error('Nao foi possivel baixar o audio remoto para reproducao.')
  }

  const responseContentType = response.headers.get('content-type')
  const resolvedMimeType = normalizePlaybackMimeType(
    responseContentType || inferPlaybackMimeTypeFromStoragePath(storagePath),
  )
  const responseBlob = await response.blob()
  const normalizedBlob = responseBlob.type === resolvedMimeType
    ? responseBlob
    : new Blob([await responseBlob.arrayBuffer()], { type: resolvedMimeType })
  const objectUrl = URL.createObjectURL(normalizedBlob)

  console.debug('[voiceideas:audio-playback]', {
    event: 'remote-audio-blob-created',
    platform: getPlatformSource(),
    storagePath,
    signedUrl,
    responseContentType,
    resolvedMimeType,
    size: normalizedBlob.size,
  })

  return {
    url: objectUrl,
    mimeType: resolvedMimeType,
    originalUrl: signedUrl,
    revokeOnDispose: true,
  }
}

export async function createSignedCaptureAudioUrl(
  storagePath: string,
  expiresInSeconds = 60 * 30,
) {
  const { data, error } = await supabase.storage
    .from(CAPTURE_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds)

  if (error) {
    throw new Error(error.message)
  }

  if (!data?.signedUrl) {
    throw new Error('Nao foi possivel gerar a URL assinada do audio.')
  }

  return data.signedUrl
}

export async function createSignedCaptureAudioSource(storagePath: string): Promise<AudioPlaybackSource> {
  const url = await createSignedCaptureAudioUrl(storagePath)
  const inferredMimeType = inferPlaybackMimeTypeFromStoragePath(storagePath)

  console.debug('[voiceideas:audio-playback]', {
    event: 'signed-url-created',
    platform: getPlatformSource(),
    storagePath,
    signedUrl: url,
    inferredMimeType,
  })

  if (getPlatformSource() === 'ios') {
    return createBlobPlaybackSourceFromSignedUrl(storagePath, url)
  }

  return {
    url,
    mimeType: inferredMimeType,
    originalUrl: url,
  }
}

export function createLocalBlobAudioSource(blob: Blob): AudioPlaybackSource {
  const mimeType = normalizePlaybackMimeType(blob.type || 'audio/mp4')

  return {
    url: URL.createObjectURL(blob.type === mimeType ? blob : new Blob([blob], { type: mimeType })),
    mimeType,
    revokeOnDispose: true,
  }
}
