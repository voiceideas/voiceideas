import { useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Filesystem } from '@capacitor/filesystem'
import { useMobileAudioCapture } from './useMobileAudioCapture'

const IOS_CAPTURE_MIN_VALID_BYTES = 1024
const IOS_CAPTURE_READ_RETRY_DELAYS_MS = [0, 150, 300, 600, 1000, 1500]

export interface MobileCaptureSessionResult {
  durationMs: number
  file: File
  mimeType: string
  uri: string | null
}

function normalizeCapturedAudioMimeType(mimeType: string | null | undefined) {
  if (!mimeType) {
    return 'audio/mp4'
  }

  const normalizedMimeType = mimeType.toLowerCase()
  if (normalizedMimeType === 'audio/m4a' || normalizedMimeType === 'audio/x-m4a') {
    return 'audio/mp4'
  }

  return mimeType
}

function inferMimeType(uri: string | null, fallback = 'audio/mp4') {
  if (!uri) return fallback

  const lowerUri = uri.toLowerCase()
  if (lowerUri.endsWith('.wav')) return 'audio/wav'
  if (lowerUri.endsWith('.mp3')) return 'audio/mpeg'
  if (lowerUri.endsWith('.ogg')) return 'audio/ogg'
  if (lowerUri.endsWith('.webm')) return 'audio/webm'
  if (lowerUri.endsWith('.m4a') || lowerUri.endsWith('.mp4')) return 'audio/mp4'
  return fallback
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  return 'm4a'
}

function stripDataUrlPrefix(data: string) {
  const separatorIndex = data.indexOf(',')
  if (separatorIndex === -1) {
    return data
  }

  const prefix = data.slice(0, separatorIndex)
  if (!prefix.includes(';base64')) {
    return data
  }

  return data.slice(separatorIndex + 1)
}

function base64ToBlob(base64Data: string, mimeType: string) {
  const normalizedData = stripDataUrlPrefix(base64Data)
  const binary = atob(normalizedData)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: mimeType })
}

function sleep(delayMs: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}

function normalizeBlobMimeType(blob: Blob, mimeType: string) {
  if (!mimeType || blob.type === mimeType) {
    return blob
  }

  return new Blob([blob], { type: mimeType })
}

function isBlobPlausiblyRecordedAudio(blob: Blob) {
  return blob.size >= IOS_CAPTURE_MIN_VALID_BYTES
}

async function readFilesystemBlobWithDiagnostics(path: string, mimeType: string) {
  let statSize: number | null = null
  let base64Length: number | null = null

  try {
    const statResult = await Filesystem.stat({ path })
    statSize = typeof statResult.size === 'number' ? statResult.size : null
  } catch {
    // Stat can fail on some path variants; keep trying readFile.
  }

  const result = await Filesystem.readFile({ path })

  if (result.data instanceof Blob) {
    const blob = normalizeBlobMimeType(result.data, mimeType)

    return {
      blob,
      statSize,
      base64Length,
    }
  }

  if (typeof result.data === 'string' && result.data.length > 0) {
    const normalizedBase64 = stripDataUrlPrefix(result.data)
    base64Length = normalizedBase64.length
    const blob = base64ToBlob(normalizedBase64, mimeType)

    return {
      blob,
      statSize,
      base64Length,
    }
  }

  return {
    blob: null,
    statSize,
    base64Length,
  }
}

async function readNativeCaptureBlobFromFilesystem(uri: string, mimeType: string) {
  const pathCandidates = [uri]

  if (uri.startsWith('file://')) {
    pathCandidates.push(uri.replace(/^file:\/\//, ''))
  }

  for (let attemptIndex = 0; attemptIndex < IOS_CAPTURE_READ_RETRY_DELAYS_MS.length; attemptIndex += 1) {
    const retryDelayMs = IOS_CAPTURE_READ_RETRY_DELAYS_MS[attemptIndex]

    if (retryDelayMs > 0) {
      await sleep(retryDelayMs)
    }

    for (const path of pathCandidates) {
      try {
        const result = await readFilesystemBlobWithDiagnostics(path, mimeType)

        console.debug('[voiceideas:mobile-capture]', {
          event: 'ios-read-capture-attempt',
          uri,
          path,
          attempt: attemptIndex + 1,
          retryDelayMs,
          statSize: result.statSize,
          base64Length: result.base64Length,
          blobSize: result.blob?.size ?? 0,
          mimeType,
        })

        if (result.blob && isBlobPlausiblyRecordedAudio(result.blob)) {
          return result.blob
        }
      } catch (readError) {
        console.debug('[voiceideas:mobile-capture]', {
          event: 'ios-read-capture-attempt-failed',
          uri,
          path,
          attempt: attemptIndex + 1,
          retryDelayMs,
          mimeType,
          error: readError instanceof Error ? readError.message : String(readError),
        })
      }
    }
  }

  throw new Error('Nao foi possivel ler um arquivo de audio valido salvo no aparelho.')
}

async function readNativeCaptureBlob(uri: string, mimeType: string) {
  if (Capacitor.getPlatform() === 'ios') {
    return readNativeCaptureBlobFromFilesystem(uri, mimeType)
  }

  const nativeUrl = Capacitor.convertFileSrc(uri)
  const response = await fetch(nativeUrl)

  if (!response.ok) {
    throw new Error('Nao foi possivel ler o audio bruto salvo no aparelho.')
  }

  return response.blob()
}

export function useMobileCaptureSession() {
  const audioCapture = useMobileAudioCapture()

  const stopCapture = useCallback(async () => {
    const captureResult = await audioCapture.stopCapture()

    if (!captureResult) {
      return null
    }

    let audioBlob = captureResult.blob

    if ((!audioBlob || !audioBlob.size) && captureResult.uri) {
      const fallbackMimeType = captureResult.mimeType || inferMimeType(captureResult.uri)
      audioBlob = await readNativeCaptureBlob(captureResult.uri, fallbackMimeType)
    }

    if (!audioBlob || !audioBlob.size) {
      throw new Error('A captura movel terminou sem um arquivo de audio valido.')
    }

    const mimeType = normalizeCapturedAudioMimeType(
      audioBlob.type || captureResult.mimeType || inferMimeType(captureResult.uri),
    )
    const normalizedBlob = normalizeBlobMimeType(audioBlob, mimeType)

    console.debug('[voiceideas:mobile-capture]', {
      event: 'mobile-capture-blob-ready',
      platform: Capacitor.getPlatform(),
      uri: captureResult.uri,
      durationMs: captureResult.durationMs,
      incomingBlobSize: audioBlob.size,
      normalizedBlobSize: normalizedBlob.size,
      mimeType,
    })

    if (Capacitor.getPlatform() === 'ios' && !isBlobPlausiblyRecordedAudio(normalizedBlob)) {
      throw new Error('A captura movel do iPhone terminou com um arquivo de audio truncado.')
    }

    const file = new File(
      [normalizedBlob],
      `captura-mobile-${Date.now()}.${extensionFromMimeType(mimeType)}`,
      { type: mimeType },
    )

    console.debug('[voiceideas:mobile-capture]', {
      event: 'mobile-capture-file-ready',
      platform: Capacitor.getPlatform(),
      uri: captureResult.uri,
      durationMs: captureResult.durationMs,
      fileSize: file.size,
      mimeType,
      fileName: file.name,
    })

    return {
      durationMs: captureResult.durationMs,
      file,
      mimeType,
      uri: captureResult.uri,
    } satisfies MobileCaptureSessionResult
  }, [audioCapture])

  return {
    ...audioCapture,
    stopCapture,
  }
}
