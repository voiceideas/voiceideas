/**
 * UserAvatar — componente reutilizável para identidade visual do usuário.
 *
 * VI_BRIDGE.UX_STATE_AND_PREFS.3 (2026-05-12):
 *   Adiciona presença visual da conta logada em header + Settings. Usa, em
 *   ordem de preferência:
 *     1. user.user_metadata.avatar_url ou .picture (Google OAuth popula)
 *     2. iniciais derivadas de full_name / name / email
 *
 *   Não há upload custom ainda — esse é um follow-up que precisa de bucket
 *   storage `avatars` + policy + endpoint update. Quando vier, esse mesmo
 *   componente passa a aceitar `customAvatarUrl` e o resto continua igual.
 */

import { useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'

interface UserAvatarProps {
  user: User | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-sm',
}

function pickDisplayName(user: User | null): string {
  if (!user) return ''
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const candidates = [meta.full_name, meta.name]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  // Fallback: parte local do email.
  if (user.email) {
    return user.email.split('@')[0] ?? user.email
  }
  return ''
}

function pickAvatarUrl(user: User | null): string | null {
  if (!user) return null
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const candidates = [meta.avatar_url, meta.picture]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().startsWith('http')) {
      return candidate.trim()
    }
  }
  return null
}

function computeInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  // 2 primeiras palavras → 1 letra cada (ex.: "Gian Carlo" → "GC")
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  // 1 palavra → 2 primeiras letras se possível
  const single = parts[0] ?? '?'
  return single.slice(0, Math.min(2, single.length)).toUpperCase()
}

export function getUserDisplayName(user: User | null) {
  return pickDisplayName(user)
}

export function UserAvatar({ user, size = 'md', className = '' }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false)
  const displayName = useMemo(() => pickDisplayName(user), [user])
  const avatarUrl = useMemo(() => pickAvatarUrl(user), [user])
  const initials = useMemo(() => computeInitials(displayName), [displayName])
  const sizeClass = SIZE_CLASSES[size]

  // Mostra foto se houver URL e a img carregou OK; senão, iniciais sobre
  // fundo neutro. Usa onError para detectar quebra de URL externa (token
  // de Google que expirou, etc.) e cair em initials sem flicker.
  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={displayName || 'usuário'}
        className={`${sizeClass} shrink-0 rounded-full object-cover ring-1 ring-black/5 ${className}`}
        onError={() => setImgError(true)}
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    )
  }

  return (
    <div
      className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-semibold uppercase tracking-tight text-slate-700 ring-1 ring-black/5 ${className}`}
      aria-label={displayName || 'usuário'}
      role="img"
    >
      {initials}
    </div>
  )
}
