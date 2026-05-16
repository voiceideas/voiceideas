/**
 * VI_CAPTURE_ENGINE_UNIFICATION — E3 (2026-05-16)
 *
 * Wrapper minimalista de logging estruturado. Substitui `console.*`
 * espalhado por `log.info/warn/error/debug(scope, message, context?)`
 * com formato consistente:
 *
 *   `[voiceideas:${scope}] ${message}` { ...context }
 *
 * **Escopo desta entrega:** apenas o wrapper + tipo. Instrumentação do
 * engine path (B9D `createCaptureEngine`) é o consumidor inicial. Hooks
 * legados (`useAudioTranscription`, `useSafeCaptureMode`, etc) NÃO são
 * migrados nesta task — fica para iteração futura se for útil.
 *
 * **Sem sink externo** (Sentry/PostHog/etc não conectados). Os calls
 * delegam para `console.[level]` puro; UA de produção (Chrome devtools,
 * Xcode console em Capacitor) recebe os logs com prefixo padronizado.
 *
 * Para adicionar sink externo no futuro, basta modificar `emit()`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogContext = Record<string, unknown>

interface ConsoleLike {
  debug?: (...args: unknown[]) => void
  info?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
  error?: (...args: unknown[]) => void
  log?: (...args: unknown[]) => void
}

function getConsole(): ConsoleLike | null {
  if (typeof globalThis === 'undefined') return null
  const c = (globalThis as unknown as { console?: ConsoleLike }).console
  return c ?? null
}

function pickConsoleFn(
  con: ConsoleLike,
  level: LogLevel,
): ((...args: unknown[]) => void) | null {
  return con[level] ?? con.log ?? null
}

function emit(
  level: LogLevel,
  scope: string,
  message: string,
  context?: LogContext,
): void {
  const con = getConsole()
  if (!con) return
  const fn = pickConsoleFn(con, level)
  if (!fn) return
  const prefix = `[voiceideas:${scope}]`
  if (context && Object.keys(context).length > 0) {
    fn(prefix, message, context)
  } else {
    fn(prefix, message)
  }
}

export const log = {
  debug(scope: string, message: string, context?: LogContext): void {
    emit('debug', scope, message, context)
  },
  info(scope: string, message: string, context?: LogContext): void {
    emit('info', scope, message, context)
  },
  warn(scope: string, message: string, context?: LogContext): void {
    emit('warn', scope, message, context)
  },
  error(scope: string, message: string, context?: LogContext): void {
    emit('error', scope, message, context)
  },
}
