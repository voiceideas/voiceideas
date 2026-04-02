import type { PlatformSource } from '../lib/platform'

const LOCAL_CAPTURE_DB_NAME = 'voiceideas-local-capture-store'
const LOCAL_CAPTURE_DB_VERSION = 1
const PENDING_CAPTURE_UPLOADS_STORE = 'pending_capture_uploads'

export type PendingCaptureUploadStatus =
  | 'captured-locally'
  | 'pending-upload'
  | 'uploading'
  | 'uploaded'
  | 'failed'

export type PendingCaptureUploadStage =
  | 'local-capture'
  | 'storage-upload'
  | 'metadata-persist'
  | 'session-complete'

export interface PendingCaptureUploadRecord {
  sessionId: string
  userId: string
  provisionalFolderName: string
  platformSource: PlatformSource
  startedAt: string
  endedAt: string
  durationMs: number
  fileName: string
  mimeType: string
  blob: Blob | null
  rawStoragePath: string | null
  status: PendingCaptureUploadStatus
  stage: PendingCaptureUploadStage
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface CreatePendingCaptureUploadInput {
  sessionId: string
  userId: string
  provisionalFolderName: string
  platformSource: PlatformSource
  startedAt: string
  endedAt: string
  durationMs: number
  fileName: string
  mimeType: string
  blob: Blob
}

export interface PatchPendingCaptureUploadInput {
  blob?: Blob | null
  rawStoragePath?: string | null
  status?: PendingCaptureUploadStatus
  stage?: PendingCaptureUploadStage
  lastError?: string | null
}

function ensureIndexedDbSupport() {
  if (typeof indexedDB === 'undefined') {
    throw new Error('O armazenamento local de capturas nao esta disponivel neste ambiente.')
  }
}

function openLocalCaptureDatabase(): Promise<IDBDatabase> {
  ensureIndexedDbSupport()

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_CAPTURE_DB_NAME, LOCAL_CAPTURE_DB_VERSION)

    request.onerror = () => {
      reject(request.error ?? new Error('Nao foi possivel abrir o banco local de capturas.'))
    }

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(PENDING_CAPTURE_UPLOADS_STORE)) {
        const store = database.createObjectStore(PENDING_CAPTURE_UPLOADS_STORE, {
          keyPath: 'sessionId',
        })
        store.createIndex('userId', 'userId', { unique: false })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }
  })
}

function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  return openLocalCaptureDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(PENDING_CAPTURE_UPLOADS_STORE, mode)
    const store = transaction.objectStore(PENDING_CAPTURE_UPLOADS_STORE)

    transaction.oncomplete = () => {
      database.close()
    }

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Falha na transacao local de capturas.'))
      database.close()
    }

    transaction.onabort = () => {
      reject(transaction.error ?? new Error('A transacao local de capturas foi abortada.'))
      database.close()
    }

    Promise.resolve(callback(store)).then(resolve).catch((error) => {
      reject(error)
      transaction.abort()
    })
  }))
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Falha em operacao local de capturas.'))
  })
}

export function isLocalCaptureStoreSupported() {
  return typeof indexedDB !== 'undefined'
}

export async function listPendingCaptureUploads(userId?: string) {
  const records = await withStore('readonly', async (store) => {
    const request = store.getAll()
    return requestToPromise(request)
  })

  return (records as PendingCaptureUploadRecord[])
    .filter((record) => !userId || record.userId === userId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function getPendingCaptureUpload(sessionId: string) {
  const record = await withStore('readonly', async (store) => {
    const request = store.get(sessionId)
    return requestToPromise(request)
  })

  return (record as PendingCaptureUploadRecord | undefined) ?? null
}

export async function createPendingCaptureUpload(input: CreatePendingCaptureUploadInput) {
  const now = new Date().toISOString()
  const record: PendingCaptureUploadRecord = {
    sessionId: input.sessionId,
    userId: input.userId,
    provisionalFolderName: input.provisionalFolderName,
    platformSource: input.platformSource,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: input.durationMs,
    fileName: input.fileName,
    mimeType: input.mimeType,
    blob: input.blob,
    rawStoragePath: null,
    status: 'captured-locally',
    stage: 'local-capture',
    lastError: null,
    createdAt: now,
    updatedAt: now,
  }

  await withStore('readwrite', async (store) => {
    const request = store.put(record)
    await requestToPromise(request)
  })

  return record
}

export async function patchPendingCaptureUpload(sessionId: string, patch: PatchPendingCaptureUploadInput) {
  return withStore('readwrite', async (store) => {
    const existing = await requestToPromise(store.get(sessionId)) as PendingCaptureUploadRecord | undefined

    if (!existing) {
      throw new Error('Nao foi possivel localizar a captura pendente para atualizar.')
    }

    const updatedRecord: PendingCaptureUploadRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    }

    await requestToPromise(store.put(updatedRecord))
    return updatedRecord
  })
}

export async function removePendingCaptureUpload(sessionId: string) {
  await withStore('readwrite', async (store) => {
    const request = store.delete(sessionId)
    await requestToPromise(request)
  })
}

