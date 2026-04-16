import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export type BridgeExportDestination = 'cenax' | 'bardo'
export type BridgeExportContentType = 'note' | 'organized_idea'
export type BridgeExportValidationStatus = 'valid' | 'blocked'

export interface BridgeExportValidationIssue {
  code: string
  message: string
}

export interface BridgeExportEligibility {
  contentType: BridgeExportContentType
  contentId: string
  destination: BridgeExportDestination
  eligible: boolean
  sourceSessionMode: 'safe_capture' | null
  sourceSessionIds: string[]
  validationStatus: BridgeExportValidationStatus
  validationIssues: BridgeExportValidationIssue[]
  reason: string | null
}

export interface BridgeExportEnvelope {
  bridgeVersion: 'voiceideas.bridge-export.v1'
  domain: 'voiceideas'
  destination: BridgeExportDestination
  contentType: BridgeExportContentType
  contentId: string
  scopeType: 'project'
  sourceSessionMode: 'safe_capture' | null
  sourceSessionIds: string[]
  validationStatus: BridgeExportValidationStatus
  validationIssues: BridgeExportValidationIssue[]
  deliveryPayload: Record<string, unknown> | null
}

interface NoteRow {
  id: string
  user_id: string
  raw_text: string
  title: string | null
  folder_id: string | null
  source_capture_session_id: string | null
  source_audio_chunk_id: string | null
  created_at: string
}

interface FolderRow {
  id: string
  name: string
}

interface CaptureSessionRow {
  id: string
  user_id: string
  status: 'active' | 'completed' | 'cancelled' | 'failed'
  processing_status: string
  raw_storage_path: string | null
  ended_at: string | null
}

interface AudioChunkRow {
  id: string
  queue_status: string
}

interface OrganizedContentSection {
  title: string
  items: string[]
}

interface OrganizedIdeaRow {
  id: string
  user_id: string
  note_ids: string[]
  type: 'topicos' | 'plano' | 'roteiro' | 'mapa'
  title: string
  tags: string[] | null
  content: {
    sections: OrganizedContentSection[]
    summary?: string | null
  }
  created_at: string
}

interface SourceNotePreview {
  id: string
  title: string | null
  raw_text: string
  created_at: string
}

const BRIDGE_VERSION = 'voiceideas.bridge-export.v1' as const
const BARDO_SCHEMA_VERSION = 'voiceideas.bardo-bridge.v1' as const
const DEFAULT_LOCALE = 'pt-BR' as const

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function summarizeText(text: string, maxLength = 180) {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) return null
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trimEnd()}...`
}

function normalizeStringList(values: string[]) {
  const normalized: string[] = []
  const seen = new Set<string>()

  values.forEach((value) => {
    const candidate = value.replace(/\s+/g, ' ').trim()
    if (!candidate) return

    const key = candidate.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) return

    seen.add(key)
    normalized.push(candidate)
  })

  return normalized
}

function buildPlainText(title: string, summary: string | null, sections: OrganizedContentSection[]) {
  const blocks = [
    title.trim(),
    summary?.trim() || null,
    ...sections.map((section) => [
      section.title.trim(),
      ...section.items.map((item) => item.trim()),
    ].filter(Boolean).join('\n')),
  ].filter((value): value is string => Boolean(value))

  return blocks.join('\n\n').trim()
}

function buildIssue(code: string, message: string): BridgeExportValidationIssue {
  return { code, message }
}

function summarizeIssues(issues: BridgeExportValidationIssue[]) {
  return issues[0]?.message ?? null
}

function createEligibility(input: {
  contentType: BridgeExportContentType
  contentId: string
  destination: BridgeExportDestination
  sourceSessionMode: 'safe_capture' | null
  sourceSessionIds: string[]
  validationIssues: BridgeExportValidationIssue[]
}): BridgeExportEligibility {
  const validationStatus: BridgeExportValidationStatus = input.validationIssues.length > 0 ? 'blocked' : 'valid'

  return {
    contentType: input.contentType,
    contentId: input.contentId,
    destination: input.destination,
    eligible: validationStatus === 'valid',
    sourceSessionMode: input.sourceSessionMode,
    sourceSessionIds: input.sourceSessionIds,
    validationStatus,
    validationIssues: input.validationIssues,
    reason: summarizeIssues(input.validationIssues),
  }
}

function createEnvelope(input: {
  contentType: BridgeExportContentType
  contentId: string
  destination: BridgeExportDestination
  sourceSessionMode: 'safe_capture' | null
  sourceSessionIds: string[]
  validationIssues: BridgeExportValidationIssue[]
  deliveryPayload: Record<string, unknown> | null
}): BridgeExportEnvelope {
  const validationStatus: BridgeExportValidationStatus = input.validationIssues.length > 0 ? 'blocked' : 'valid'

  return {
    bridgeVersion: BRIDGE_VERSION,
    domain: 'voiceideas',
    destination: input.destination,
    contentType: input.contentType,
    contentId: input.contentId,
    scopeType: 'project',
    sourceSessionMode: input.sourceSessionMode,
    sourceSessionIds: input.sourceSessionIds,
    validationStatus,
    validationIssues: input.validationIssues,
    deliveryPayload: input.deliveryPayload,
  }
}

function buildNoteDeliveryPayload(note: NoteRow, folderName: string | null) {
  const title = note.title?.trim() || summarizeText(note.raw_text, 60) || 'Nota sem titulo'

  return {
    schemaVersion: BARDO_SCHEMA_VERSION,
    sourceApp: 'voiceideas',
    targetApp: 'bardo',
    locale: DEFAULT_LOCALE,
    preparedAt: new Date().toISOString(),
    artifact: {
      id: note.id,
      type: 'raw-note',
      title,
      summary: summarizeText(note.raw_text),
      plainText: note.raw_text.trim(),
      tags: [],
      folders: normalizeStringList(folderName ? [folderName] : []),
      createdAt: note.created_at,
      sourceNoteIds: [note.id],
      sections: [
        {
          title: 'Texto bruto',
          items: [note.raw_text],
        },
      ],
      sourceReferences: [
        {
          kind: 'note',
          id: note.id,
          title: note.title?.trim() || null,
        },
      ],
      metadata: {
        origin: 'note',
        noteCount: 1,
        organizationType: null,
      },
    },
  } satisfies Record<string, unknown>
}

function buildOrganizedIdeaDeliveryPayload(
  idea: OrganizedIdeaRow,
  sourceNotes: SourceNotePreview[],
  folders: string[],
) {
  const sections = Array.isArray(idea.content?.sections)
    ? idea.content.sections
        .filter((section) => section && typeof section.title === 'string' && Array.isArray(section.items))
        .map((section) => ({
          title: section.title.trim() || 'Secao',
          items: section.items
            .map((item) => String(item).trim())
            .filter(Boolean),
        }))
    : []
  const title = idea.title.trim() || 'Ideia organizada'
  const summary = typeof idea.content?.summary === 'string' ? idea.content.summary.trim() || null : null

  return {
    schemaVersion: BARDO_SCHEMA_VERSION,
    sourceApp: 'voiceideas',
    targetApp: 'bardo',
    locale: DEFAULT_LOCALE,
    preparedAt: new Date().toISOString(),
    artifact: {
      id: idea.id,
      type: 'organized-idea',
      title,
      summary,
      plainText: buildPlainText(title, summary, sections),
      tags: normalizeStringList(idea.tags ?? []),
      folders: normalizeStringList(folders),
      createdAt: idea.created_at,
      sourceNoteIds: idea.note_ids,
      sections,
      sourceReferences: sourceNotes.map((note) => ({
        kind: 'note',
        id: note.id,
        title: note.title?.trim() || null,
      })),
      metadata: {
        origin: 'organized-idea',
        noteCount: idea.note_ids.length,
        organizationType: idea.type,
      },
    },
  } satisfies Record<string, unknown>
}

function validateNoteContext(note: NoteRow, session: CaptureSessionRow | null, chunk: AudioChunkRow | null) {
  const issues: BridgeExportValidationIssue[] = []

  if (!note.source_capture_session_id) {
    issues.push(buildIssue(
      'outside_safe_capture_scope',
      'Esta nota nao veio de captura segura. Nota unica e caminho manual ficam fora da bridge v1.',
    ))
  }

  if (!note.raw_text.trim()) {
    issues.push(buildIssue(
      'missing_note_content',
      'Esta nota ainda nao tem texto consolidado suficiente para exportar.',
    ))
  }

  if (note.source_capture_session_id && !session) {
    issues.push(buildIssue(
      'missing_capture_session',
      'A sessao de captura de origem nao foi encontrada para esta nota.',
    ))
  }

  if (session?.status !== 'completed') {
    issues.push(buildIssue(
      'session_not_completed',
      'A sessao de captura ainda nao foi encerrada de forma concluida.',
    ))
  }

  if (session && !session.raw_storage_path) {
    issues.push(buildIssue(
      'session_not_synced',
      'A sessao de captura ainda nao concluiu o sync canônico no backend.',
    ))
  }

  if (session?.processing_status === 'failed') {
    issues.push(buildIssue(
      'session_failed',
      'A sessao de captura tem falha pendente e nao pode exportar agora.',
    ))
  }

  if (note.source_audio_chunk_id && !chunk) {
    issues.push(buildIssue(
      'missing_source_chunk',
      'O trecho de origem desta nota nao foi encontrado.',
    ))
  }

  if (chunk?.queue_status === 'failed') {
    issues.push(buildIssue(
      'source_chunk_failed',
      'O trecho de origem desta nota ainda carrega falha pendente.',
    ))
  }

  return issues
}

async function loadFolderName(client: SupabaseClient, folderId: string | null) {
  if (!folderId) {
    return null
  }

  const { data } = await client
    .from('folders')
    .select('id, name')
    .eq('id', folderId)
    .maybeSingle()

  return (data as FolderRow | null)?.name ?? null
}

export async function resolveNoteBridgeExport(
  client: SupabaseClient,
  userId: string,
  noteId: string,
  destination: BridgeExportDestination,
) {
  const { data: noteData, error: noteError } = await client
    .from('notes')
    .select('id, user_id, raw_text, title, folder_id, source_capture_session_id, source_audio_chunk_id, created_at')
    .eq('id', noteId)
    .eq('user_id', userId)
    .maybeSingle()

  if (noteError) {
    throw new Error(`Nao foi possivel carregar a nota para exportar: ${noteError.message}`)
  }

  const note = noteData as NoteRow | null
  if (!note) {
    throw new Error('Nota nao encontrada.')
  }

  const [sessionResult, chunkResult, folderName] = await Promise.all([
    note.source_capture_session_id
      ? client
          .from('capture_sessions')
          .select('id, user_id, status, processing_status, raw_storage_path, ended_at')
          .eq('id', note.source_capture_session_id)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    note.source_audio_chunk_id
      ? client
          .from('audio_chunks')
          .select('id, queue_status')
          .eq('id', note.source_audio_chunk_id)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    loadFolderName(client, note.folder_id),
  ])

  if (sessionResult.error) {
    throw new Error(`Nao foi possivel carregar a sessao de origem da nota: ${sessionResult.error.message}`)
  }

  if (chunkResult.error) {
    throw new Error(`Nao foi possivel carregar o trecho de origem da nota: ${chunkResult.error.message}`)
  }

  const session = sessionResult.data as CaptureSessionRow | null
  const chunk = chunkResult.data as AudioChunkRow | null
  const validationIssues = validateNoteContext(note, session, chunk)
  const sourceSessionIds = uniqueStrings([note.source_capture_session_id])
  const sourceSessionMode = sourceSessionIds.length > 0 ? 'safe_capture' : null
  const eligibility = createEligibility({
    contentType: 'note',
    contentId: note.id,
    destination,
    sourceSessionMode,
    sourceSessionIds,
    validationIssues,
  })
  const envelope = createEnvelope({
    contentType: 'note',
    contentId: note.id,
    destination,
    sourceSessionMode,
    sourceSessionIds,
    validationIssues,
    deliveryPayload: eligibility.eligible ? buildNoteDeliveryPayload(note, folderName) : null,
  })

  return {
    contentId: note.id,
    noteId: note.id,
    eligibility,
    envelope,
  }
}

export async function resolveOrganizedIdeaBridgeExport(
  client: SupabaseClient,
  userId: string,
  organizedIdeaId: string,
  destination: BridgeExportDestination,
) {
  const { data: ideaData, error: ideaError } = await client
    .from('organized_ideas')
    .select('id, user_id, note_ids, type, title, tags, content, created_at')
    .eq('id', organizedIdeaId)
    .eq('user_id', userId)
    .maybeSingle()

  if (ideaError) {
    throw new Error(`Nao foi possivel carregar a ideia organizada para exportar: ${ideaError.message}`)
  }

  const idea = ideaData as OrganizedIdeaRow | null
  if (!idea) {
    throw new Error('Ideia organizada nao encontrada.')
  }

  const validationIssues: BridgeExportValidationIssue[] = []

  if (!Array.isArray(idea.note_ids) || idea.note_ids.length === 0) {
    validationIssues.push(buildIssue(
      'organized_idea_without_sources',
      'Esta ideia organizada nao tem notas-fonte suficientes para a bridge v1.',
    ))
  }

  const uniqueNoteIds = Array.from(new Set(idea.note_ids ?? []))
  const notesResult = uniqueNoteIds.length > 0
    ? await client
        .from('notes')
        .select('id, user_id, raw_text, title, folder_id, source_capture_session_id, source_audio_chunk_id, created_at')
        .in('id', uniqueNoteIds)
        .eq('user_id', userId)
    : { data: [], error: null }

  if (notesResult.error) {
    throw new Error(`Nao foi possivel carregar as notas-fonte da ideia organizada: ${notesResult.error.message}`)
  }

  const notes = ((notesResult.data as NoteRow[] | null) || [])
  const noteById = new Map(notes.map((note) => [note.id, note]))

  if (notes.length !== uniqueNoteIds.length) {
    validationIssues.push(buildIssue(
      'missing_source_notes',
      'Nem todas as notas-fonte desta ideia organizada ainda existem para exportacao.',
    ))
  }

  const sessionIds = uniqueStrings(notes.map((note) => note.source_capture_session_id))
  const chunkIds = uniqueStrings(notes.map((note) => note.source_audio_chunk_id))
  const folderIds = uniqueStrings(notes.map((note) => note.folder_id))

  const [{ data: sessionsData, error: sessionsError }, { data: chunksData, error: chunksError }, { data: foldersData, error: foldersError }] = await Promise.all([
    sessionIds.length > 0
      ? client
          .from('capture_sessions')
          .select('id, user_id, status, processing_status, raw_storage_path, ended_at')
          .in('id', sessionIds)
          .eq('user_id', userId)
      : Promise.resolve({ data: [], error: null }),
    chunkIds.length > 0
      ? client
          .from('audio_chunks')
          .select('id, queue_status')
          .in('id', chunkIds)
          .eq('user_id', userId)
      : Promise.resolve({ data: [], error: null }),
    folderIds.length > 0
      ? client
          .from('folders')
          .select('id, name')
          .in('id', folderIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (sessionsError) {
    throw new Error(`Nao foi possivel carregar as sessoes-fonte da ideia organizada: ${sessionsError.message}`)
  }

  if (chunksError) {
    throw new Error(`Nao foi possivel carregar os trechos-fonte da ideia organizada: ${chunksError.message}`)
  }

  if (foldersError) {
    throw new Error(`Nao foi possivel carregar as pastas da ideia organizada: ${foldersError.message}`)
  }

  const sessionById = new Map(((sessionsData as CaptureSessionRow[] | null) || []).map((session) => [session.id, session]))
  const chunkById = new Map(((chunksData as AudioChunkRow[] | null) || []).map((chunk) => [chunk.id, chunk]))
  const folderById = new Map(((foldersData as FolderRow[] | null) || []).map((folder) => [folder.id, folder.name]))

  uniqueNoteIds.forEach((noteId) => {
    const note = noteById.get(noteId)

    if (!note) {
      return
    }

    const noteIssues = validateNoteContext(
      note,
      note.source_capture_session_id ? sessionById.get(note.source_capture_session_id) ?? null : null,
      note.source_audio_chunk_id ? chunkById.get(note.source_audio_chunk_id) ?? null : null,
    )

    noteIssues.forEach((issue) => {
      validationIssues.push(buildIssue(
        `source_note:${issue.code}`,
        `A ideia organizada depende da nota ${note.title?.trim() || note.id.slice(0, 8)}: ${issue.message}`,
      ))
    })
  })

  const sections = Array.isArray(idea.content?.sections)
    ? idea.content.sections.filter((section) => Array.isArray(section?.items) && typeof section?.title === 'string')
    : []

  if (sections.length === 0) {
    validationIssues.push(buildIssue(
      'organized_idea_without_content',
      'Esta ideia organizada ainda nao tem estrutura consolidada suficiente para exportar.',
    ))
  }

  const sourceSessionIds = uniqueStrings(notes.map((note) => note.source_capture_session_id))
  const sourceSessionMode = sourceSessionIds.length > 0 ? 'safe_capture' : null
  const eligibility = createEligibility({
    contentType: 'organized_idea',
    contentId: idea.id,
    destination,
    sourceSessionMode,
    sourceSessionIds,
    validationIssues,
  })
  const sourceNotes: SourceNotePreview[] = uniqueNoteIds
    .map((noteId) => noteById.get(noteId))
    .filter((note): note is NoteRow => Boolean(note))
    .map((note) => ({
      id: note.id,
      title: note.title,
      raw_text: note.raw_text,
      created_at: note.created_at,
    }))
  const folders = notes
    .map((note) => note.folder_id ? folderById.get(note.folder_id) ?? null : null)
    .filter((folder): folder is string => Boolean(folder))
  const envelope = createEnvelope({
    contentType: 'organized_idea',
    contentId: idea.id,
    destination,
    sourceSessionMode,
    sourceSessionIds,
    validationIssues,
    deliveryPayload: eligibility.eligible
      ? buildOrganizedIdeaDeliveryPayload(idea, sourceNotes, folders)
      : null,
  })

  return {
    contentId: idea.id,
    organizedIdeaId: idea.id,
    eligibility,
    envelope,
  }
}
