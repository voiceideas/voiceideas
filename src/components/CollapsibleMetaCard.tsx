import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * CollapsibleMetaCard — bloco de metadados/status que colapsa por
 * padrão. Dois modos:
 *
 *  - **Sempre fechado** (Bardo bridge, exportação, rejeição):
 *    `defaultOpen={false}`, `forceOpenOnDesktop={false}`.
 *    O usuário precisa expandir manualmente em qualquer viewport.
 *
 *  - **Fechado só no mobile** (tags, notas-fonte, pastas, metadados
 *    secundários): `defaultOpen={false}`, `forceOpenOnDesktop={true}`.
 *    Em viewport `md+` o conteúdo é sempre visível (via CSS), o
 *    chevron some, e a barra de resumo desaparece.
 *
 * Decisões UX (VI_UX.MOBILE_COMPACTION 2026-05-13):
 *   - Status crítico (Bardo) **nunca** deve sumir — sempre aparece
 *     no header (statusLabel) mesmo fechado.
 *   - O resumo (`summary`) é a "1 linha" que substitui o conteúdo
 *     quando fechado.
 *   - O componente é não-opinativo sobre o conteúdo expandido —
 *     `children` recebe tudo (detalhes, datas, histórico, ações).
 */

type StatusVariant = 'neutral' | 'success' | 'warning' | 'error' | 'info'

interface CollapsibleMetaCardProps {
  title: string
  statusLabel?: string
  statusVariant?: StatusVariant
  summary?: ReactNode
  defaultOpen?: boolean
  /**
   * Quando `true`, o card é expandido sempre em viewport `md+`
   * (>=768px). O state interno controla só o mobile.
   *
   * Use para metadados (tags, notas-fonte, pastas). NÃO use para
   * status crítico Bardo — esse fica sempre colapsado em qualquer
   * viewport para reduzir verbosidade.
   */
  forceOpenOnDesktop?: boolean
  /**
   * Conteúdo adicional no header (ex.: badge de contagem, ícone).
   * Renderizado entre o título e o chevron.
   */
  headerAccessory?: ReactNode
  /**
   * Classe extra no container externo (margin/spacing).
   */
  className?: string
  children: ReactNode
}

const statusToneClass: Record<StatusVariant, string> = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
}

export function CollapsibleMetaCard({
  title,
  statusLabel,
  statusVariant = 'neutral',
  summary,
  defaultOpen = false,
  forceOpenOnDesktop = false,
  headerAccessory,
  className,
  children,
}: CollapsibleMetaCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  const containerClass = [
    'rounded-xl border border-slate-200 bg-white',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const chevronVisibilityClass = forceOpenOnDesktop ? 'md:hidden' : ''
  const summaryVisibilityClass = forceOpenOnDesktop ? 'md:hidden' : ''
  const contentVisibilityClass = open
    ? 'block'
    : forceOpenOnDesktop
      ? 'hidden md:block'
      : 'hidden'

  return (
    <div className={containerClass}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={forceOpenOnDesktop ? true : open}
        aria-controls={contentId}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left ${forceOpenOnDesktop ? 'md:cursor-default' : ''}`}
      >
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        {statusLabel && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${statusToneClass[statusVariant]}`}
          >
            {statusLabel}
          </span>
        )}
        {headerAccessory && (
          <span className="ml-1 flex items-center text-xs text-slate-500">
            {headerAccessory}
          </span>
        )}
        <span className="ml-auto flex items-center">
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''} ${chevronVisibilityClass}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {summary && !open && (
        <div
          className={`border-t border-slate-100 px-3 py-2 text-xs text-slate-500 ${summaryVisibilityClass}`}
        >
          {summary}
        </div>
      )}

      <div
        id={contentId}
        className={`${contentVisibilityClass} border-t border-slate-100 px-3 py-3`}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * CompactDisclosure — variação mais leve para metadados secundários
 * (tags pequenas, contadores, pastas de origem dentro de um card).
 * Sem borda, sem padding pesado. Só uma linha clicável + resumo.
 *
 * Use quando o bloco NÃO precisa parecer um card próprio (já está
 * dentro de outro card). Para blocos top-level use `CollapsibleMetaCard`.
 */
interface CompactDisclosureProps {
  title: string
  summary?: ReactNode
  defaultOpen?: boolean
  forceOpenOnDesktop?: boolean
  className?: string
  children: ReactNode
}

export function CompactDisclosure({
  title,
  summary,
  defaultOpen = false,
  forceOpenOnDesktop = false,
  className,
  children,
}: CompactDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  const wrapperClass = ['space-y-1.5', className].filter(Boolean).join(' ')
  const chevronVisibilityClass = forceOpenOnDesktop ? 'md:hidden' : ''
  const summaryVisibilityClass = forceOpenOnDesktop ? 'md:hidden' : ''
  const contentVisibilityClass = open
    ? 'block'
    : forceOpenOnDesktop
      ? 'hidden md:block'
      : 'hidden'

  return (
    <div className={wrapperClass}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={forceOpenOnDesktop ? true : open}
        aria-controls={contentId}
        className={`flex w-full items-center gap-2 text-left ${forceOpenOnDesktop ? 'md:cursor-default' : ''}`}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </span>
        {summary && (
          <span
            className={`text-xs text-slate-500 ${summaryVisibilityClass}`}
          >
            {summary}
          </span>
        )}
        <span className="ml-auto">
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''} ${chevronVisibilityClass}`}
            aria-hidden="true"
          />
        </span>
      </button>

      <div id={contentId} className={contentVisibilityClass}>
        {children}
      </div>
    </div>
  )
}
