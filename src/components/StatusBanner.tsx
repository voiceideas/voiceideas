import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'

type StatusVariant = 'success' | 'error' | 'info' | 'warning'
type StatusBannerSize = 'default' | 'compact'

interface StatusBannerProps {
  variant: StatusVariant
  children: ReactNode
  title?: string
  onDismiss?: () => void
  dismissible?: boolean
  autoDismissMs?: number | null
  size?: StatusBannerSize
  className?: string
}

const VARIANT_STYLES: Record<StatusVariant, string> = {
  success: 'border-green-200 bg-green-50 text-green-700',
  error: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-slate-300 bg-slate-100 text-slate-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
}

const VARIANT_ICON: Record<StatusVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
  warning: AlertTriangle,
}

const SIZE_STYLES: Record<StatusBannerSize, {
  root: string
  icon: string
  title: string
  content: string
}> = {
  default: {
    root: 'rounded-xl p-4',
    icon: 'h-5 w-5',
    title: 'text-sm font-medium',
    content: 'text-sm',
  },
  compact: {
    root: 'rounded-lg p-3',
    icon: 'h-4 w-4',
    title: 'text-xs font-medium',
    content: 'text-xs',
  },
}

export function StatusBanner({
  variant,
  children,
  title,
  onDismiss,
  dismissible,
  autoDismissMs,
  size = 'default',
  className = '',
}: StatusBannerProps) {
  const { t } = useI18n()
  const Icon = VARIANT_ICON[variant]
  const sizeStyles = SIZE_STYLES[size]
  const [dismissed, setDismissed] = useState(false)
  const effectiveDismissible = dismissible ?? variant !== 'error'
  const effectiveAutoDismissMs = autoDismissMs === undefined
    ? (variant === 'success'
      ? 5000
      : variant === 'info' || variant === 'warning'
        ? 9000
        : null)
    : autoDismissMs

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    onDismiss?.()
  }, [onDismiss])

  useEffect(() => {
    if (dismissed || !effectiveAutoDismissMs) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      handleDismiss()
    }, effectiveAutoDismissMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [dismissed, effectiveAutoDismissMs, handleDismiss])

  if (dismissed) {
    return null
  }

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      className={`border ${sizeStyles.root} ${VARIANT_STYLES[variant]} ${className}`.trim()}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 shrink-0 ${sizeStyles.icon}`} aria-hidden="true" />
        <div className="flex-1">
          {title && <p className={sizeStyles.title}>{title}</p>}
          <div className={title ? `mt-1 ${sizeStyles.content}` : sizeStyles.content}>{children}</div>
        </div>
        {(effectiveDismissible || onDismiss) && (
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t('common.dismissNotice')}
            className="rounded-lg p-1 transition-colors hover:bg-black/5"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
