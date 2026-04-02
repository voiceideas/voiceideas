import {
  completeCaptureSession,
  updateCaptureSession,
  uploadCaptureSessionAudio,
} from './captureSessionService'
import { AppError, wrapAppError } from '../lib/errors'
import {
  getPendingCaptureUpload,
  patchPendingCaptureUpload,
  removePendingCaptureUpload,
  type PendingCaptureUploadRecord,
} from './mobileLocalCaptureStore'
import type { CaptureSession } from '../types/capture'

export interface ProcessedPendingCaptureUploadSession {
  sessionId: string
  provisionalFolderName: string
  rawStoragePath: string
  startedAt: string
  endedAt: string | null
  platformSource: CaptureSession['platformSource']
  processingStatus: CaptureSession['processingStatus']
  status: CaptureSession['status']
}

function mapPendingCaptureUploadError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Permita o uso do microfone para iniciar uma captura segura.'
    }

    if (error.name === 'NotFoundError') {
      return 'Nenhum microfone foi encontrado neste aparelho.'
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    if (message.includes('microfone') || message.includes('permission')) {
      return 'Permita o uso do microfone para iniciar uma captura segura.'
    }

    return error.message
  }

  return 'Nao foi possivel gravar e salvar a sessao de captura.'
}

export async function flushPendingCaptureUploadRecord(
  pendingUpload: PendingCaptureUploadRecord,
): Promise<ProcessedPendingCaptureUploadSession> {
  let storagePath = pendingUpload.rawStoragePath

  await patchPendingCaptureUpload(pendingUpload.sessionId, {
    status: 'uploading',
    stage: resolvePendingUploadStage(storagePath),
    lastError: null,
  })

  if (!storagePath) {
    if (!pendingUpload.blob || !pendingUpload.blob.size) {
      throw new AppError({
        message: 'A captura local nao tem mais um arquivo valido para reenviar.',
        code: 'missing_local_blob',
        status: null,
        details: null,
        raw: null,
      })
    }

    try {
      const pendingFile = new File(
        [pendingUpload.blob],
        pendingUpload.fileName,
        { type: pendingUpload.mimeType },
      )
      const upload = await uploadCaptureSessionAudio(pendingUpload.sessionId, pendingFile)
      storagePath = upload.storagePath
    } catch (uploadError) {
      const message = mapPendingCaptureUploadError(uploadError)
      await patchPendingCaptureUpload(pendingUpload.sessionId, {
        status: 'failed',
        stage: 'storage-upload',
        lastError: message,
      })
      throw await wrapAppError(uploadError, message)
    }

    await patchPendingCaptureUpload(pendingUpload.sessionId, {
      rawStoragePath: storagePath,
      blob: null,
      status: 'pending-upload',
      stage: 'metadata-persist',
    })
  }

  try {
    await updateCaptureSession(pendingUpload.sessionId, {
      rawStoragePath: storagePath,
    })
  } catch (persistError) {
    const message = mapPendingCaptureUploadError(persistError)
    await patchPendingCaptureUpload(pendingUpload.sessionId, {
      rawStoragePath: storagePath,
      status: 'failed',
      stage: 'metadata-persist',
      lastError: message,
    })
    throw await wrapAppError(persistError, message)
  }

  try {
    const completedSession = await completeCaptureSession(pendingUpload.sessionId, {
      endedAt: pendingUpload.endedAt,
      status: 'completed',
      processingStatus: 'awaiting-segmentation',
    })

    await patchPendingCaptureUpload(pendingUpload.sessionId, {
      rawStoragePath: storagePath,
      status: 'uploaded',
      stage: 'session-complete',
      lastError: null,
    })

    const persistedSession = {
      sessionId: completedSession.id,
      provisionalFolderName: completedSession.provisionalFolderName,
      rawStoragePath: storagePath,
      startedAt: completedSession.startedAt,
      endedAt: completedSession.endedAt,
      platformSource: completedSession.platformSource,
      processingStatus: completedSession.processingStatus,
      status: completedSession.status,
    } satisfies ProcessedPendingCaptureUploadSession

    await removePendingCaptureUpload(pendingUpload.sessionId)
    return persistedSession
  } catch (completeError) {
    const message = mapPendingCaptureUploadError(completeError)
    await patchPendingCaptureUpload(pendingUpload.sessionId, {
      rawStoragePath: storagePath,
      status: 'failed',
      stage: 'session-complete',
      lastError: message,
    })
    throw await wrapAppError(completeError, message)
  }
}

export async function retryPendingCaptureUpload(sessionId: string) {
  const pendingUpload = await getPendingCaptureUpload(sessionId)

  if (!pendingUpload) {
    throw new AppError({
      message: 'Nao foi possivel encontrar a captura pendente para reenviar.',
      code: 'pending_upload_not_found',
      status: null,
      details: null,
      raw: null,
    })
  }

  return flushPendingCaptureUploadRecord(pendingUpload)
}

export async function discardPendingCaptureUpload(sessionId: string) {
  const pendingUpload = await getPendingCaptureUpload(sessionId)

  if (!pendingUpload) {
    throw new AppError({
      message: 'Nao foi possivel encontrar a captura pendente para excluir.',
      code: 'pending_upload_not_found',
      status: null,
      details: null,
      raw: null,
    })
  }

  await removePendingCaptureUpload(sessionId)
}

function resolvePendingUploadStage(storagePath: string | null) {
  return storagePath ? 'metadata-persist' : 'storage-upload'
}
