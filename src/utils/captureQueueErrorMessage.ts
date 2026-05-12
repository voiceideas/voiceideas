import { classifyAppError, normalizeAppError } from '../lib/errors'

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

function infraMessageForContext(context: CaptureQueueErrorContext) {
  // Mesma mensagem de fallback do contexto mas com sufixo opcional para
  // distinguir infra de ações genéricas. Mantido igual ao default por
  // enquanto para não mudar UI em estados conhecidos.
  return defaultMessageForContext(context)
}

function normalizeVisibleProductText(value: string) {
  return value
    .replace(/\bcenax\b/gi, 'Cenax')
    .replace(/\bbardo\b/gi, 'Bardo')
}

// Mensagens transport/boilerplate que vazam do SDK sem informação útil ao
// usuário. Usado apenas quando classifyAppError retorna 'unknown'.
function isTransportBoilerplate(lowerMessage: string) {
  return [
    'failed to send a request to the edge function',
    'edge function returned a non-2xx status code',
    'edge function',
    'functionsfetcherror',
    'functionshttperror',
    'non-2xx',
    'status code',
    'typeerror:',
    'mime type',
    'rawstoragepath',
    'filesystem',
    'request failed',
    'timeout',
  ].some((pattern) => lowerMessage.includes(pattern))
}

export function mapCaptureQueueErrorMessage(
  error: unknown,
  context: CaptureQueueErrorContext = 'generic',
) {
  const normalized = normalizeAppError(error, '')
  const rawMessage = normalizeVisibleProductText(normalized.message.trim())
  const kind = classifyAppError(error)

  switch (kind) {
    case 'session_expired':
      return 'Sua sessao expirou. Entre novamente e tente de novo.'
    case 'not_authenticated':
      return 'Voce precisa entrar novamente para continuar.'
    case 'auth_denied':
      return 'Voce nao tem permissao para esta acao.'
    case 'network':
      return 'Sem conexao. Tente novamente.'
    case 'server_infra':
      // 5xx e similares: não fingir que é problema de auth, mas também não
      // exibir mensagem técnica crua.
      return infraMessageForContext(context)
    case 'not_found':
      return rawMessage || 'Conteudo nao encontrado.'
    case 'validation':
      // 4xx com mensagem legível do servidor — surfar para o usuário.
      return rawMessage || defaultMessageForContext(context)
    case 'unknown':
    default: {
      if (!rawMessage) {
        return defaultMessageForContext(context)
      }
      if (isTransportBoilerplate(rawMessage.toLowerCase())) {
        return defaultMessageForContext(context)
      }
      return rawMessage
    }
  }
}
