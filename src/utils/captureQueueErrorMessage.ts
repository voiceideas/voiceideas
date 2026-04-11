import { normalizeAppError } from '../lib/errors'

export type CaptureQueueErrorContext =
  | 'generic'
  | 'load'
  | 'pending-upload'
  | 'segment'
  | 'rename'
  | 'transcribe'
  | 'save-note'
  | 'materialize'
  | 'export'
  | 'delete-chunk'
  | 'delete-session'
  | 'discard-local-upload'

function defaultMessageForContext(context: CaptureQueueErrorContext) {
  return ({
    load: 'Nao foi possivel atualizar a fila agora.',
    'pending-upload': 'Nao foi possivel enviar esta captura agora.',
    segment: 'Nao foi possivel separar esta sessao agora.',
    rename: 'Nao foi possivel salvar o nome final agora.',
    transcribe: 'Nao foi possivel transcrever este trecho agora.',
    'save-note': 'Nao foi possivel salvar esta nota agora.',
    materialize: 'Nao foi possivel gerar o rascunho agora.',
    export: 'Nao foi possivel enviar para a integracao externa agora.',
    'delete-chunk': 'Nao foi possivel excluir este trecho agora.',
    'delete-session': 'Nao foi possivel excluir esta sessao agora.',
    'discard-local-upload': 'Nao foi possivel excluir esta copia local agora.',
    generic: 'Algo deu errado. Tente novamente.',
  }[context] ?? 'Algo deu errado. Tente novamente.')
}

function normalizeVisibleProductText(value: string) {
  return value
    .replace(/\bcenax\b/gi, 'Cenax')
    .replace(/\bbardo\b/gi, 'Bardo')
}

function isNetworkErrorMessage(lowerMessage: string) {
  return [
    'failed to fetch',
    'networkerror',
    'network request failed',
    'load failed',
    'fetch failed',
    'sem conexao',
    'sem conexão',
    'offline',
  ].some((pattern) => lowerMessage.includes(pattern))
}

function isAuthSessionErrorMessage(lowerMessage: string) {
  return [
    'invalid jwt',
    'jwt expired',
    'jwt malformed',
    'token has expired',
    'unauthorized',
    'not authenticated',
    'auth session missing',
  ].some((pattern) => lowerMessage.includes(pattern))
}

function isTechnicalInfrastructureError(lowerMessage: string) {
  return [
    'failed to send a request to the edge function',
    'edge function',
    'functionsfetcherror',
    'functionshttperror',
    'non-2xx',
    'status code',
    'typeerror:',
    'mime type',
    'rawstoragepath',
    'filesystem',
    'storage',
    'blob',
    'supabase',
    'request failed',
    'timeout',
  ].some((pattern) => lowerMessage.includes(pattern))
}

export function mapCaptureQueueErrorMessage(
  error: unknown,
  context: CaptureQueueErrorContext = 'generic',
) {
  const rawMessage = normalizeVisibleProductText(normalizeAppError(error, '').message.trim())

  if (!rawMessage) {
    return defaultMessageForContext(context)
  }

  const lowerMessage = rawMessage.toLowerCase()

  if (isNetworkErrorMessage(lowerMessage)) {
    return 'Sem conexao. Tente novamente.'
  }

  if (isAuthSessionErrorMessage(lowerMessage)) {
    return 'Sua sessao expirou. Entre novamente e tente de novo.'
  }

  if (isTechnicalInfrastructureError(lowerMessage)) {
    return defaultMessageForContext(context)
  }

  return rawMessage
}
