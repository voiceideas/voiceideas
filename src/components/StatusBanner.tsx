import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

type StatusVariant = 'success' | 'error' | 'info'

interface StatusBannerProps {
  variant: StatusVariant
  children: ReactNode
  title?: string
  onDismiss?: () => void
  className?: string
}

const VARIANT_STYLES: Record<StatusVariant, string> = {
  success: 'border-green-200 bg-green-50 text-green-700',
  error: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-slate-300 bg-slate-100 text-slate-700',
}

const VARIANT_ICON: Record<StatusVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
}

export function StatusBanner({
  variant,
  children,
  title,
  onDismiss,
  className = '',
}: StatusBannerProps) {
  const Icon = VARIANT_ICON[variant]

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      className={`rounded-xl border p-4 ${VARIANT_STYLES[variant]} ${className}`.trim()}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          {title && <p className="text-sm font-medium">{title}</p>}
          <div className={title ? 'mt-1 text-sm' : 'text-sm'}>{children}</div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Fechar mensagem"
            className="rounded-lg p-1 transition-colors hover:bg-black/5"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
