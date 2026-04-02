import { AlertTriangle, CheckCircle2 } from 'lucide-react'

interface ProvisionalFolderBadgeProps {
  needsRename: boolean
}

export function ProvisionalFolderBadge({ needsRename }: ProvisionalFolderBadgeProps) {
  if (needsRename) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
        <AlertTriangle className="h-3 w-3" />
        pasta provisoria
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      <CheckCircle2 className="h-3 w-3" />
      nome final
    </span>
  )
}
