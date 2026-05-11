/**
 * Allowlist + builder seguro para o callback do fluxo `/connect-bardo`.
 *
 * Existe para permitir que o Bardo abra o VoiceIdeas com um callback de
 * retorno (`return_url` / `callback_url`) sem expor o VI a open-redirect.
 * Qualquer URL fora do allowlist é tratada como ausente — a página
 * `/connect-bardo` simplesmente não redireciona.
 *
 * Regras:
 *   - Origens permitidas em produção: https://obardo.app, https://www.obardo.app
 *   - Em desenvolvimento (DEV): origens localhost com http(s):// são aceitas
 *   - Nada mais — qualquer outro host (incluindo IPs, subdomínios não
 *     mapeados, schemes custom) é recusado
 *   - URL precisa ser absoluta e ter scheme http/https
 *   - Os parâmetros do callback são reescritos pelo VI usando `URLSearchParams`,
 *     então nada que o usuário/atacante coloque na URL original sobrevive
 *     além do `state` (que é passado adiante apenas se for string e curto)
 */

const PRODUCTION_BARDO_ORIGINS = new Set<string>([
  'https://obardo.app',
  'https://www.obardo.app',
])

const MAX_STATE_LENGTH = 256
const ALLOWED_LINK_STATUS_VALUES = new Set(['success', 'missing_bardo_user_id', 'error'])

function isLocalhostOrigin(origin: string): boolean {
  // Aceita apenas em DEV (import.meta.env.DEV true em vite dev).
  if (!import.meta.env?.DEV) return false
  try {
    const url = new URL(origin)
    const host = url.hostname
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (host === 'localhost' || host === '127.0.0.1' || host === '::1')
    )
  } catch {
    return false
  }
}

export function isAllowedBardoCallback(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  // Apenas http(s); bloqueia javascript:, data:, file:, etc.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false
  }
  const origin = `${parsed.protocol}//${parsed.host}`
  if (PRODUCTION_BARDO_ORIGINS.has(origin)) return true
  return isLocalhostOrigin(origin)
}

export type BardoLinkStatus = 'success' | 'missing_bardo_user_id' | 'error'

interface CallbackParams {
  status: BardoLinkStatus
  state?: string | null
}

/**
 * Constrói uma URL de callback segura ou retorna null se a base não for
 * permitida ou se algum parâmetro for inválido.
 *
 * A URL final contém:
 *   - `voiceideas_link=<status>`
 *   - `state=<state>` (apenas se for string curta e não vazia)
 *
 * Quaisquer outros query params que estavam na `rawCallback` são preservados
 * (URL nativa do JS já faz isso), mas o atacante não consegue forjar nada
 * porque a base host é validada pelo allowlist.
 */
export function buildBardoCallbackUrl(
  rawCallback: string | null | undefined,
  params: CallbackParams,
): string | null {
  if (!isAllowedBardoCallback(rawCallback)) return null
  if (!ALLOWED_LINK_STATUS_VALUES.has(params.status)) return null

  try {
    const url = new URL(rawCallback as string)
    url.searchParams.set('voiceideas_link', params.status)
    if (
      params.state &&
      typeof params.state === 'string' &&
      params.state.length > 0 &&
      params.state.length <= MAX_STATE_LENGTH
    ) {
      url.searchParams.set('state', params.state)
    }
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Normaliza um `state` arbitrário vindo da URL.
 * Retorna null se for inválido (não-string, vazio, muito longo).
 */
export function normalizeBardoState(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_STATE_LENGTH) return null
  return trimmed
}
