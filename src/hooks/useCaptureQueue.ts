import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { normalizeAppError, serializeErrorForDebug } from '../lib/errors'
import type { AudioChunk, AudioChunkFilters, AudioChunkQueueStatus, CreateAudioChunkInput, UpdateAudioChunkInput } from '../types/chunk'
import type {
  ChunkTranscriptionState,
  CreateTranscriptionJobInput,
  TranscriptionJob,
  TranscriptionJobFilters,
  UpdateTranscriptionJobInput,
} from '../types/transcription'
import {
  createAudioChunk,
  deleteAudioChunkFile,
  listAudioChunks,
  updateAudioChunk,
  uploadAudioChunkFile,
} from '../services/audioChunkService'
import {
  createTranscriptionJob,
  listTranscriptionJobs,
  updateTranscriptionJob,
} from '../services/transcriptionQueueService'

export interface UseCaptureQueueOptions {
  chunkFilters?: AudioChunkFilters
  jobFilters?: TranscriptionJobFilters
}

function resolveChunkTranscriptionState(
  chunkId: string,
  chunkQueueStatus: AudioChunkQueueStatus | undefined,
  jobs: TranscriptionJob[],
): ChunkTranscriptionState {
  const sortedJobs = [...jobs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const latestJob = sortedJobs[0] ?? null
  const activeJob = sortedJobs.find((job) => job.status === 'pending' || job.status === 'processing') ?? null
  const latestCompletedJob = sortedJobs.find((job) => job.status === 'completed') ?? null
  const latestFailedJob = sortedJobs.find((job) => job.status === 'failed') ?? null

  let status: ChunkTranscriptionState['status'] = 'awaiting-transcription'

  if (activeJob || chunkQueueStatus === 'transcribing') {
    status = 'transcribing'
  } else if (latestCompletedJob || chunkQueueStatus === 'transcribed' || chunkQueueStatus === 'materialized' || chunkQueueStatus === 'ready') {
    status = 'transcribed'
  } else if (latestFailedJob || chunkQueueStatus === 'failed') {
    status = 'failed'
  }

  return {
    chunkId,
    status,
    latestJob,
    activeJob,
    latestCompletedJob,
    latestFailedJob,
    canStart: !activeJob && !latestCompletedJob,
    canRetry: !activeJob && Boolean(latestFailedJob),
    canReuseCompleted: !activeJob && Boolean(latestCompletedJob),
  }
}

export function useCaptureQueue(options: UseCaptureQueueOptions = {}) {
  const [chunks, setChunks] = useState<AudioChunk[]>([])
  const [jobs, setJobs] = useState<TranscriptionJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [chunkData, jobData] = await Promise.all([
        listAudioChunks(options.chunkFilters),
        listTranscriptionJobs(options.jobFilters),
      ])

      setChunks(chunkData)
      setJobs(jobData)
    } catch (fetchError) {
      console.debug('[voiceideas:capture-queue-load-error]', serializeErrorForDebug(fetchError, 'Falha ao carregar a fila de captura.'))
      setError(normalizeAppError(fetchError, 'Falha ao carregar a fila de captura.').message)
    } finally {
      setLoading(false)
    }
  }, [options.chunkFilters, options.jobFilters])

  const fetchQueueEvent = useEffectEvent(fetchQueue)

  useEffect(() => {
    void fetchQueueEvent()
  }, [])

  const jobsByChunk = new Map<string, TranscriptionJob[]>()

  for (const job of jobs) {
    const chunkJobs = jobsByChunk.get(job.chunkId) ?? []
    chunkJobs.push(job)
    jobsByChunk.set(job.chunkId, chunkJobs)
  }

  const addChunk = async (input: CreateAudioChunkInput) => {
    const chunk = await createAudioChunk(input)
    setChunks((prev) => [chunk, ...prev])
    return chunk
  }

  const patchChunk = async (id: string, input: UpdateAudioChunkInput) => {
    const chunk = await updateAudioChunk(id, input)
    setChunks((prev) => prev.map((item) => (item.id === id ? chunk : item)))
    return chunk
  }

  const attachChunkAudio = async (
    sessionId: string,
    chunkId: string,
    file: Blob & { name?: string },
  ) => {
    const storagePath = await uploadAudioChunkFile(sessionId, chunkId, file)
    const chunk = await patchChunk(chunkId, { storagePath })
    return { chunk, storagePath }
  }

  const removeChunkAudio = async (chunkId: string, storagePath: string) => {
    await deleteAudioChunkFile(storagePath)
    return patchChunk(chunkId, { storagePath: '' })
  }

  const addJob = async (input: CreateTranscriptionJobInput) => {
    const job = await createTranscriptionJob(input)
    setJobs((prev) => [job, ...prev])
    return job
  }

  const patchJob = async (id: string, input: UpdateTranscriptionJobInput) => {
    const job = await updateTranscriptionJob(id, input)
    setJobs((prev) => prev.map((item) => (item.id === id ? job : item)))
    return job
  }

  return {
    chunks,
    jobs,
    jobsByChunk,
    loading,
    error,
    getChunkTranscriptionState: (chunkId: string, chunkQueueStatus?: AudioChunkQueueStatus) =>
      resolveChunkTranscriptionState(chunkId, chunkQueueStatus, jobsByChunk.get(chunkId) ?? []),
    createChunk: addChunk,
    updateChunk: patchChunk,
    attachChunkAudio,
    removeChunkAudio,
    createJob: addJob,
    updateJob: patchJob,
    refetch: fetchQueue,
  }
}
