import { getErrorMessage } from '../lib/errors'
import { DEFAULT_LOCALE, type AppLocale } from '../lib/i18n'
import { segmentCaptureSession } from './captureSessionService'
import { transcribeChunk } from './transcriptionQueueService'
import type { CreateCapturedNoteInput } from '../hooks/useNotes'
import type { Note, OrganizedIdea } from '../types/database'
import type { VoiceSegmentationSettings } from '../types/segmentation'
import type {
  CaptureMagicMode,
  CaptureMagicProgress,
  CaptureMagicResult,
  CaptureMagicSkippedChunk,
  CaptureMagicFailedChunk,
} from '../types/magicCapture'

interface UpsertCapturedNoteResult {
  note: Note
  existed: boolean
}

interface RunCaptureMagicOptions {
  sessionId: string
  mode: CaptureMagicMode
  locale?: AppLocale
  segmentationSettings: VoiceSegmentationSettings
  saveCapturedNote: (input: CreateCapturedNoteInput) => Promise<UpsertCapturedNoteResult>
  createInitialGrouping?: (notes: Note[]) => Promise<OrganizedIdea | null>
  onProgress?: (progress: CaptureMagicProgress) => void
}

function emitProgress(
  onProgress: RunCaptureMagicOptions['onProgress'],
  progress: CaptureMagicProgress,
) {
  onProgress?.(progress)
}

function isDailyLimitError(message: string) {
  const normalized = message.toLocaleLowerCase('pt-BR')
  return normalized.includes('limite diario atingido') || normalized.includes('daily limit')
}

function uniqueNotes(notes: Note[]) {
  const noteById = new Map<string, Note>()

  for (const note of notes) {
    noteById.set(note.id, note)
  }

  return Array.from(noteById.values())
}

export async function runCaptureMagicFlow({
  sessionId,
  mode,
  locale = DEFAULT_LOCALE,
  segmentationSettings,
  saveCapturedNote,
  createInitialGrouping,
  onProgress,
}: RunCaptureMagicOptions): Promise<CaptureMagicResult> {
  emitProgress(onProgress, {
    phase: 'segmenting',
    label: mode === 'magic'
      ? (locale === 'en' ? 'Splitting the recording into ideas...' : locale === 'es' ? 'Separando la grabación en ideas...' : 'Separando a gravação em ideias...')
      : (locale === 'en' ? 'Preparing a raw note from the recording...' : locale === 'es' ? 'Preparando una nota bruta de la grabación...' : 'Preparando uma nota bruta da gravação...'),
  })

  const segmentation = await segmentCaptureSession(
    {
      sessionId,
      mediumSilenceMs: segmentationSettings.mediumSilenceMs,
      longSilenceMs: segmentationSettings.longSilenceMs,
      minChunkMs: segmentationSettings.minChunkMs,
      analysisWindowMs: segmentationSettings.analysisWindowMs,
      strongDelimiterPhrase: segmentationSettings.strongDelimiterPhrase,
    },
  )

  const fallbackChunkCount = segmentation.chunks.filter((chunk) =>
    chunk.segmentationReason === 'single-pass' || chunk.segmentationReason === 'fallback',
  ).length

  const createdNotes: Note[] = []
  const groupedIdeas: OrganizedIdea[] = []
  const skippedChunks: CaptureMagicSkippedChunk[] = []
  const failedChunks: CaptureMagicFailedChunk[] = []
  let createdNotesCount = 0
  let existingNotesCount = 0
  let reusedTranscriptionsCount = 0
  let limitReachedMessage: string | null = null
  const rawTranscriptParts: string[] = []

  for (let index = 0; index < segmentation.chunks.length; index += 1) {
    const chunk = segmentation.chunks[index]
    const current = index + 1
    const total = segmentation.chunks.length

    emitProgress(onProgress, {
      phase: 'transcribing',
      label: locale === 'en'
        ? `Transcribing chunk ${current} of ${total}...`
        : locale === 'es'
          ? `Transcribiendo fragmento ${current} de ${total}...`
          : `Transcrevendo trecho ${current} de ${total}...`,
      current,
      total,
    })

    let transcriptText = ''

    try {
      const transcription = await transcribeChunk({ chunkId: chunk.id })
      transcriptText = transcription.transcriptText?.trim() || ''
      if (transcription.reused) {
        reusedTranscriptionsCount += 1
      }
    } catch (transcriptionError) {
      failedChunks.push({
        chunkId: chunk.id,
        stage: 'transcribe',
        message: getErrorMessage(
          transcriptionError,
          locale === 'en'
            ? 'Could not transcribe this chunk.'
            : locale === 'es'
              ? 'No se pudo transcribir este fragmento.'
              : 'Não foi possível transcrever este trecho.',
        ),
      })
      continue
    }

    if (!transcriptText) {
      skippedChunks.push({
        chunkId: chunk.id,
        reason: 'empty-transcript',
        message: locale === 'en'
          ? 'This chunk ended up empty or silent after transcription.'
          : locale === 'es'
            ? 'Este fragmento quedó vacío o silencioso después de la transcripción.'
            : 'O trecho ficou vazio ou silencioso depois da transcrição.',
      })
      continue
    }

    if (mode === 'raw') {
      rawTranscriptParts.push(transcriptText)
      continue
    }

    emitProgress(onProgress, {
      phase: 'saving-notes',
      label: locale === 'en'
        ? `Saving note ${current} of ${total}...`
        : locale === 'es'
          ? `Guardando nota ${current} de ${total}...`
          : `Salvando nota ${current} de ${total}...`,
      current,
      total,
    })

    try {
      const { note, existed } = await saveCapturedNote({
        rawText: transcriptText,
        sourceCaptureSessionId: sessionId,
        sourceAudioChunkId: chunk.id,
      })

      createdNotes.push(note)

      if (existed) {
        existingNotesCount += 1
      } else {
        createdNotesCount += 1
      }
    } catch (saveError) {
      const message = getErrorMessage(
        saveError,
        locale === 'en'
          ? 'Could not save the note from this chunk.'
          : locale === 'es'
            ? 'No se pudo guardar la nota de este fragmento.'
            : 'Não foi possível salvar a nota deste trecho.',
      )
      failedChunks.push({
        chunkId: chunk.id,
        stage: 'save-note',
        message,
      })

      if (isDailyLimitError(message)) {
        skippedChunks.push({
          chunkId: chunk.id,
          reason: 'limit-reached',
          message,
        })
        limitReachedMessage = message
        break
      }
    }
  }

  if (mode === 'raw' && rawTranscriptParts.length > 0) {
    emitProgress(onProgress, {
      phase: 'saving-notes',
      label: locale === 'en'
        ? 'Saving the raw note from the recording...'
        : locale === 'es'
          ? 'Guardando la nota bruta de la grabación...'
          : 'Salvando a nota bruta da gravação...',
      current: 1,
      total: 1,
    })

    try {
      const { note, existed } = await saveCapturedNote({
        rawText: rawTranscriptParts.join('\n\n'),
        sourceCaptureSessionId: sessionId,
      })

      createdNotes.push(note)

      if (existed) {
        existingNotesCount += 1
      } else {
        createdNotesCount += 1
      }
    } catch (saveError) {
      const message = getErrorMessage(
        saveError,
        locale === 'en'
          ? 'Could not save the raw note from the recording.'
          : locale === 'es'
            ? 'No se pudo guardar la nota bruta de la grabación.'
            : 'Não foi possível salvar a nota bruta da gravação.',
      )
      failedChunks.push({
        chunkId: segmentation.chunks[0]?.id ?? sessionId,
        stage: 'save-note',
        message,
      })

      if (isDailyLimitError(message)) {
        limitReachedMessage = message
      }
    }
  }

  let groupingError: string | null = null
  const uniqueCreatedNotes = uniqueNotes(createdNotes)

  if (mode === 'magic' && uniqueCreatedNotes.length >= 2 && createInitialGrouping) {
    emitProgress(onProgress, {
      phase: 'grouping',
      label: locale === 'en'
        ? 'Grouping initial themes...'
        : locale === 'es'
          ? 'Agrupando temas iniciales...'
          : 'Agrupando temas iniciais...',
    })

    try {
      const groupedIdea = await createInitialGrouping(uniqueCreatedNotes)
      if (groupedIdea) {
        groupedIdeas.push(groupedIdea)
      }
    } catch (groupError) {
      groupingError = getErrorMessage(
        groupError,
        locale === 'en'
          ? 'Could not create the initial thematic grouping.'
          : locale === 'es'
            ? 'No se pudo crear la agrupación temática inicial.'
            : 'Não foi possível criar o agrupamento temático inicial.',
      )
    }
  }

  emitProgress(onProgress, {
    phase: 'completed',
    label: locale === 'en' ? 'All set.' : locale === 'es' ? 'Todo listo.' : 'Tudo pronto.',
  })

  if (limitReachedMessage && createdNotesCount === 0 && existingNotesCount === 0) {
    throw new Error(limitReachedMessage)
  }

  if (createdNotesCount === 0 && existingNotesCount === 0) {
    throw new Error(
      mode === 'raw'
        ? (locale === 'en'
          ? 'The recording did not generate enough text to save a raw note.'
          : locale === 'es'
            ? 'La grabación no generó suficiente texto para guardar una nota bruta.'
            : 'A gravação não gerou texto suficiente para salvar uma nota bruta.')
        : (locale === 'en'
          ? 'The recording did not generate automatic notes. Use the manual path to review the chunks.'
          : locale === 'es'
            ? 'La grabación no generó notas automáticas. Usa el camino manual para revisar los fragmentos.'
            : 'A gravação não gerou notas automáticas. Use o caminho manual para revisar os trechos.'),
    )
  }

  return {
    sessionId,
    mode,
    chunks: segmentation.chunks,
    notes: uniqueCreatedNotes,
    createdNotesCount,
    existingNotesCount,
    groupedIdeas,
    fallbackChunkCount,
    reusedTranscriptionsCount,
    skippedChunks,
    failedChunks,
    groupingError,
    singlePass: mode === 'raw' || segmentation.strategy === 'single-pass',
  }
}
