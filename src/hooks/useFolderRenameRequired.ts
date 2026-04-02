import { useMemo } from 'react'
import type { CaptureSession } from '../types/capture'

export interface CaptureSessionFolderState {
  displayName: string
  provisionalName: string
  finalName: string | null
  needsRename: boolean
  isFinalized: boolean
  helperText: string
}

function buildFolderState(session: CaptureSession): CaptureSessionFolderState {
  const needsRename = session.renameRequired || !session.finalFolderName
  const finalName = session.finalFolderName?.trim() || null

  return {
    displayName: finalName || session.provisionalFolderName,
    provisionalName: session.provisionalFolderName,
    finalName,
    needsRename,
    isFinalized: !needsRename,
    helperText: needsRename
      ? 'A captura ja esta segura, mas ainda vive com nome temporario. Defina um nome final aqui mesmo para ela nao virar arquivo morto.'
      : 'Esta sessao ja saiu do estado provisório e agora aparece com nome final proprio.',
  }
}

export function useFolderRenameRequired(sessions: CaptureSession[]) {
  const orderedSessions = useMemo(() => {
    return [...sessions].sort((left, right) => {
      if (left.renameRequired !== right.renameRequired) {
        return left.renameRequired ? -1 : 1
      }

      return new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
    })
  }, [sessions])

  const pendingRenameCount = useMemo(
    () => sessions.filter((session) => buildFolderState(session).needsRename).length,
    [sessions],
  )

  const finalizedCount = sessions.length - pendingRenameCount

  return {
    orderedSessions,
    pendingRenameCount,
    finalizedCount,
    getFolderState: buildFolderState,
  }
}
