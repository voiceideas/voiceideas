export interface NormalizedAppError {
  message: string
  code: string | null
  status: number | null
  details: string | null
  raw: unknown
}

type AppErrorOptions = NormalizedAppError

const GENERIC_TRANSPORT_PATTERNS = [
  'edge function returned a non-2xx status code',
  'failed to send a request to the edge function',
  'functionsfetcherror',
  'functionshttperror',
  'request failed',
]

export class AppError extends Error {
  code: string | null
  status: number | null
  details: string | null
  raw: unknown

  constructor(options: AppErrorOptions) {
    super(options.message)
    this.name = 'AppError'
    this.code = options.code
    this.status = options.status
    this.details = options.details
    this.raw = options.raw
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isResponseLike(value: unknown): value is {
  status?: unknown
  statusText?: unknown
  url?: unknown
  clone?: () => { text: () => Promise<string> }
  text?: () => Promise<string>
} {
  return isRecord(value)
    && ('status' in value || 'statusText' in value || 'url' in value)
    && (typeof value.text === 'function' || typeof value.clone === 'function')
}

function cleanText(value: unknown) {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  return null
}

function truncateText(value: string, maxLength = 1200) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1)}...`
    : value
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function extractMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    return cleanText(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  if (value instanceof Error) {
    return cleanText(value.message)
  }

  if (!isRecord(value)) {
    return null
  }

  const directMessage = cleanText(value.message)
    ?? cleanText(value.error_description)
    ?? cleanText(value.description)
    ?? cleanText(value.detail)
    ?? cleanText(value.reason)

  if (directMessage) {
    return directMessage
  }

  const nestedError = value.error

  if (typeof nestedError === 'string') {
    return cleanText(nestedError)
  }

  if (nestedError && nestedError !== value) {
    const nestedMessage = extractMessage(nestedError)
    if (nestedMessage) {
      return nestedMessage
    }
  }

  const nestedCause = value.cause
  if (nestedCause && nestedCause !== value) {
    return extractMessage(nestedCause)
  }

  return null
}

function extractDetails(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  const directDetails = cleanText(value.details)
    ?? cleanText(value.hint)
    ?? cleanText(value.error_description)
    ?? cleanText(value.description)
    ?? cleanText(value.statusText)

  if (directDetails) {
    return directDetails
  }

  const nestedError = value.error
  if (nestedError && nestedError !== value) {
    return extractDetails(nestedError)
  }

  return null
}

function extractCode(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  return cleanText(value.code)
    ?? cleanText(value.errorCode)
    ?? cleanText(value.error_code)
}

function extractStatus(value: unknown): number | null {
  if (!isRecord(value)) {
    return null
  }

  return readNumber(value.status)
    ?? readNumber(value.statusCode)
    ?? readNumber(value.status_code)
    ?? (isRecord(value.response) ? extractStatus(value.response) : null)
}

function summarizeRawValue(value: unknown, depth = 0): unknown {
  if (
    value === null
    || value === undefined
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'bigint') {
    return String(value)
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: depth === 0 ? value.stack : undefined,
    }
  }

  if (isResponseLike(value)) {
    return {
      status: readNumber(value.status),
      statusText: cleanText(value.statusText),
      url: cleanText(value.url),
    }
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((entry) => summarizeRawValue(entry, depth + 1))
  }

  if (!isRecord(value)) {
    return String(value)
  }

  if (depth >= 1) {
    return Object.keys(value).slice(0, 12)
  }

  const summary: Record<string, unknown> = {}

  for (const key of Object.keys(value).slice(0, 12)) {
    summary[key] = summarizeRawValue(value[key], depth + 1)
  }

  return summary
}

function shouldReplaceMessageWithContext(message: string, fallback: string) {
  const lowerMessage = message.toLowerCase()
  const lowerFallback = fallback.toLowerCase()

  return lowerMessage === lowerFallback
    || GENERIC_TRANSPORT_PATTERNS.some((pattern) => lowerMessage.includes(pattern))
}

async function readResponseBody(response: {
  clone?: () => { text: () => Promise<string> }
  text?: () => Promise<string>
}) {
  try {
    if (typeof response.clone === 'function') {
      return await response.clone().text()
    }

    if (typeof response.text === 'function') {
      return await response.text()
    }
  } catch {
    return null
  }

  return null
}

async function extractResponseErrorContext(context: unknown) {
  if (!isResponseLike(context)) {
    return null
  }

  const status = readNumber(context.status)
  const statusText = cleanText(context.statusText)
  const responseText = await readResponseBody(context)
  const trimmedResponseText = responseText ? truncateText(responseText.trim()) : null
  const responsePayload = trimmedResponseText ? safeJsonParse(trimmedResponseText) : null
  const message = extractMessage(responsePayload)
    ?? trimmedResponseText
    ?? statusText
  const details = extractDetails(responsePayload)
    ?? (trimmedResponseText && trimmedResponseText !== message ? trimmedResponseText : null)
    ?? statusText
  const code = extractCode(responsePayload)
  const raw = {
    response: summarizeRawValue(context),
    body: summarizeRawValue(responsePayload ?? trimmedResponseText),
  }

  return {
    message,
    code,
    status,
    details,
    raw,
  }
}

export function normalizeAppError(error: unknown, fallback = 'Algo deu errado.'): NormalizedAppError {
  if (error instanceof AppError) {
    return {
      message: cleanText(error.message) ?? fallback,
      code: error.code,
      status: error.status,
      details: error.details,
      raw: error.raw,
    }
  }

  const message = extractMessage(error) ?? fallback

  return {
    message,
    code: extractCode(error),
    status: extractStatus(error),
    details: extractDetails(error),
    raw: summarizeRawValue(error),
  }
}

export async function createAppError(error: unknown, fallback = 'Algo deu errado.') {
  const normalized = normalizeAppError(error, fallback)

  if (isRecord(error) && 'context' in error) {
    const responseContext = await extractResponseErrorContext(error.context)

    if (responseContext) {
      const message = responseContext.message && shouldReplaceMessageWithContext(normalized.message, fallback)
        ? responseContext.message
        : normalized.message

      return new AppError({
        message,
        code: normalized.code ?? responseContext.code ?? null,
        status: normalized.status ?? responseContext.status ?? null,
        details: normalized.details ?? responseContext.details ?? null,
        raw: {
          source: summarizeRawValue(error),
          context: responseContext.raw,
        },
      })
    }
  }

  return new AppError(normalized)
}

export async function wrapAppError(error: unknown, message: string) {
  const normalized = await createAppError(error, message)

  return new AppError({
    message,
    code: normalized.code,
    status: normalized.status,
    details: normalized.message !== message ? normalized.message : normalized.details,
    raw: normalized.raw,
  })
}

export function serializeErrorForDebug(error: unknown, fallback = 'Algo deu errado.') {
  const normalized = normalizeAppError(error, fallback)
  const stack = error instanceof Error ? error.stack : null

  return {
    name: error instanceof Error ? error.name : null,
    message: normalized.message,
    code: normalized.code,
    status: normalized.status,
    details: normalized.details,
    stack,
    raw: normalized.raw,
  }
}

export function getErrorMessage(error: unknown, fallback: string) {
  return normalizeAppError(error, fallback).message
}
