import { useEffect, useRef, useState } from 'react'
import { Headphones, Loader2, PauseCircle, PlayCircle } from 'lucide-react'
import type { AudioPlaybackSource } from '../../services/audioPlaybackService'

interface AudioPlayerProps {
  playerId: string
  activePlayerId: string | null
  onActivePlayerChange: (playerId: string | null) => void
  listenLabel: string
  description?: string
  loadSource: () => Promise<AudioPlaybackSource>
}

export function AudioPlayer({
  playerId,
  activePlayerId,
  onActivePlayerChange,
  listenLabel,
  description,
  loadSource,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [source, setSource] = useState<AudioPlaybackSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isActive = activePlayerId === playerId

  useEffect(() => {
    if (isActive) {
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
    }

    if (source?.revokeOnDispose) {
      URL.revokeObjectURL(source.url)
      setSource(null)
    }
  }, [isActive, source])

  useEffect(() => () => {
    if (audioRef.current) {
      audioRef.current.pause()
    }

    if (source?.revokeOnDispose) {
      URL.revokeObjectURL(source.url)
    }
  }, [source])

  const handleToggle = async () => {
    if (isActive) {
      onActivePlayerChange(null)
      return
    }

    onActivePlayerChange(playerId)
    setError(null)

    if (source || loading) {
      return
    }

    setLoading(true)

    try {
      const resolvedSource = await loadSource()
      setSource(resolvedSource)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nao foi possivel carregar o audio.')
      onActivePlayerChange(null)
    } finally {
      setLoading(false)
    }
  }

  const handleAudioLoadedMetadata = () => {
    console.debug('[voiceideas:audio-playback]', {
      event: 'audio-loaded-metadata',
      playerId,
      sourceUrl: source?.url,
      originalUrl: source?.originalUrl,
      mimeType: source?.mimeType,
    })
  }

  const handleAudioCanPlay = () => {
    console.debug('[voiceideas:audio-playback]', {
      event: 'audio-can-play',
      playerId,
      sourceUrl: source?.url,
      originalUrl: source?.originalUrl,
      mimeType: source?.mimeType,
    })
  }

  const handleAudioError = () => {
    const mediaError = audioRef.current?.error
    const errorMessage = source?.originalUrl
      ? 'Nao foi possivel reproduzir este audio remoto no aparelho.'
      : 'Nao foi possivel reproduzir este audio.'

    console.debug('[voiceideas:audio-playback]', {
      event: 'audio-error',
      playerId,
      sourceUrl: source?.url,
      originalUrl: source?.originalUrl,
      mimeType: source?.mimeType,
      mediaErrorCode: mediaError?.code ?? null,
      mediaErrorMessage: mediaError?.message ?? null,
    })

    setError(errorMessage)
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          void handleToggle()
        }}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isActive ? (
          <PauseCircle className="h-4 w-4" />
        ) : (
          <PlayCircle className="h-4 w-4" />
        )}
        {isActive ? 'Ocultar player' : listenLabel}
      </button>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {isActive && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500">
            <Headphones className="h-3.5 w-3.5" />
            auditoria de audio
          </div>

          {description && (
            <p className="mt-2 text-xs text-slate-600">{description}</p>
          )}

          {loading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Carregando audio...
            </div>
          ) : null}
          {source ? (
            <audio
              ref={audioRef}
              controls
              preload="metadata"
              className="mt-3 w-full"
              onLoadedMetadata={handleAudioLoadedMetadata}
              onCanPlay={handleAudioCanPlay}
              onError={handleAudioError}
            >
              <source src={source.url} type={source.mimeType || undefined} />
              Seu aparelho nao conseguiu reproduzir este audio.
            </audio>
          ) : null}
        </div>
      )}
    </div>
  )
}
