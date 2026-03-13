import { useState } from 'react'
import { Mic, MicOff, Save, RotateCcw, Loader2 } from 'lucide-react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'

interface VoiceRecorderProps {
  onSave: (text: string) => Promise<void>
  canSave?: boolean
  remainingNotes?: number
  todayCount?: number
  dailyLimit?: number
}

export function VoiceRecorder({ onSave, canSave = true, remainingNotes: _remainingNotes, todayCount, dailyLimit }: VoiceRecorderProps) {
  const {
    isListening,
    transcript,
    interimTranscript,
    error,
    isSupported,
    start,
    stop,
    reset,
    setTranscript,
  } = useSpeechRecognition()
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  if (!isSupported) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <MicOff className="w-12 h-12 text-amber-500 mx-auto mb-3" />
        <p className="text-amber-800 font-medium">Navegador sem suporte</p>
        <p className="text-amber-600 text-sm mt-1">
          Use o Google Chrome ou Microsoft Edge para gravacao de voz.
        </p>
      </div>
    )
  }

  const handleSave = async () => {
    if (!transcript.trim()) return
    setSaving(true)
    try {
      await onSave(transcript.trim())
      reset()
    } catch {
      // error handled by parent
    } finally {
      setSaving(false)
    }
  }

  const fullText = transcript + (interimTranscript ? ' ' + interimTranscript : '')

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      {/* Record button */}
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={isListening ? stop : start}
          className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
            isListening
              ? 'bg-red-500 hover:bg-red-600 animate-pulse-recording shadow-lg shadow-red-200'
              : 'bg-primary hover:bg-primary-dark shadow-lg shadow-indigo-200'
          }`}
        >
          {isListening ? (
            <MicOff className="w-8 h-8 text-white" />
          ) : (
            <Mic className="w-8 h-8 text-white" />
          )}
        </button>
        <p className="text-sm text-gray-500">
          {isListening ? 'Ouvindo... Toque para parar' : 'Toque para gravar'}
        </p>
        {dailyLimit !== undefined && todayCount !== undefined && (
          <div className={`text-xs font-medium px-3 py-1 rounded-full ${
            canSave ? 'bg-indigo-50 text-primary' : 'bg-red-50 text-red-600'
          }`}>
            {todayCount} de {dailyLimit} notas hoje
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Transcript preview */}
      {fullText && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">Texto capturado</label>
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="text-xs text-primary hover:text-primary-dark"
            >
              {isEditing ? 'Pronto' : 'Editar'}
            </button>
          </div>
          {isEditing ? (
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              className="w-full h-32 p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          ) : (
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-800 min-h-[80px]">
              {transcript}
              {interimTranscript && (
                <span className="text-gray-400 italic">{interimTranscript}</span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleSave}
              disabled={saving || !transcript.trim() || !canSave}
              className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark disabled:bg-gray-300 text-white py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {canSave ? 'Salvar Nota' : 'Limite atingido'}
            </button>
            <button
              onClick={reset}
              className="flex items-center justify-center gap-2 text-gray-500 hover:text-gray-700 py-2.5 px-4 rounded-lg text-sm border border-gray-200 hover:border-gray-300 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
