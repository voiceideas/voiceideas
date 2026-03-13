import { useState } from 'react'
import { Mic, MicOff, Save, RotateCcw, Loader2, Radio, Wifi } from 'lucide-react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useWhisperRecorder } from '../hooks/useWhisperRecorder'
import { isSpeechRecognitionSupported } from '../lib/speech'

interface VoiceRecorderProps {
  onSave: (text: string) => Promise<void>
  canSave?: boolean
  remainingNotes?: number
  todayCount?: number
  dailyLimit?: number
}

type RecordingEngine = 'webspeech' | 'whisper'

export function VoiceRecorder({ onSave, canSave = true, remainingNotes: _remainingNotes, todayCount, dailyLimit }: VoiceRecorderProps) {
  // Web Speech API (Chrome/Edge)
  const speech = useSpeechRecognition()

  // Whisper fallback (Firefox/Safari/all)
  const whisper = useWhisperRecorder()

  const hasWebSpeech = isSpeechRecognitionSupported()
  const engine: RecordingEngine = hasWebSpeech ? 'webspeech' : 'whisper'

  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [mode, setMode] = useState<'manual' | 'continuous'>('manual')
  const [autoSaveFlash, setAutoSaveFlash] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)

  // Unified state
  const isListening = engine === 'webspeech' ? speech.isListening : whisper.isRecording
  const transcript = engine === 'webspeech' ? speech.transcript : whisper.transcript
  const interimTranscript = engine === 'webspeech' ? speech.interimTranscript : ''
  const error = engine === 'webspeech' ? speech.error : whisper.error
  const isTranscribing = engine === 'whisper' && whisper.isTranscribing
  const isSupported = engine === 'webspeech' ? speech.isSupported : whisper.isSupported
  const setTranscript = engine === 'webspeech' ? speech.setTranscript : whisper.setTranscript

  if (!isSupported) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <MicOff className="w-12 h-12 text-amber-500 mx-auto mb-3" />
        <p className="text-amber-800 font-medium">Navegador sem suporte</p>
        <p className="text-amber-600 text-sm mt-1">
          Seu navegador nao suporta gravacao de audio.
        </p>
      </div>
    )
  }

  // ====== Manual mode handlers ======
  const handleStartManual = () => {
    if (engine === 'webspeech') {
      speech.start()
    } else {
      whisper.startRecording()
    }
  }

  const handleStopManual = async () => {
    if (engine === 'webspeech') {
      speech.stop()
    } else {
      await whisper.stopRecording()
    }
  }

  const handleSave = async () => {
    if (!transcript.trim()) return
    setSaving(true)
    try {
      await onSave(transcript.trim())
      if (engine === 'webspeech') {
        speech.reset()
      } else {
        whisper.reset()
      }
    } catch {
      // error handled by parent
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (engine === 'webspeech') {
      speech.reset()
    } else {
      whisper.reset()
    }
  }

  // ====== Continuous mode (Web Speech only) ======
  const showAutoSaveFlash = () => {
    setAutoSaveFlash(true)
    setTimeout(() => setAutoSaveFlash(false), 2000)
  }

  const handleStartContinuous = () => {
    if (!canSave) return
    setSessionCount(0)
    speech.startContinuous({
      onAutoSave: async (text) => {
        if (!text.trim()) return
        try {
          await onSave(text.trim())
          setSessionCount((c) => c + 1)
          showAutoSaveFlash()
        } catch {
          // error handled by parent
        }
      },
      onAutoCancel: () => {
        showAutoSaveFlash()
      },
    })
  }

  const handleStopContinuous = () => {
    const remaining = speech.transcript.trim()
    if (remaining) {
      onSave(remaining).then(() => {
        setSessionCount((c) => c + 1)
      }).catch(() => {})
    }
    speech.stopContinuous()
    setSessionCount(0)
  }

  const fullText = transcript + (interimTranscript ? ' ' + interimTranscript : '')

  // Continuous mode only available with Web Speech API
  const canUseContinuous = hasWebSpeech

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      {/* Engine badge */}
      <div className="flex justify-center mb-3">
        <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
          engine === 'webspeech' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'
        }`}>
          <Wifi className="w-3 h-3" />
          {engine === 'webspeech' ? 'Transcrição em tempo real' : 'Transcrição via Whisper AI'}
        </span>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center justify-center gap-1 mb-5 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => {
            if (speech.isContinuousMode) speech.stopContinuous()
            if (isListening && !speech.isContinuousMode) handleStopManual()
            setMode('manual')
          }}
          className={`flex-1 text-xs font-medium py-2 px-3 rounded-md transition-colors ${
            mode === 'manual'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Mic className="w-3.5 h-3.5 inline mr-1" />
          Manual
        </button>
        <button
          onClick={() => {
            if (isListening && !speech.isContinuousMode) handleStopManual()
            setMode('continuous')
          }}
          disabled={!canUseContinuous}
          className={`flex-1 text-xs font-medium py-2 px-3 rounded-md transition-colors ${
            !canUseContinuous
              ? 'text-gray-300 cursor-not-allowed'
              : mode === 'continuous'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
          }`}
          title={!canUseContinuous ? 'Modo continuo disponivel apenas no Chrome/Edge' : ''}
        >
          <Radio className="w-3.5 h-3.5 inline mr-1" />
          Contínuo
        </button>
      </div>

      {/* Auto-save flash */}
      {autoSaveFlash && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 text-center animate-pulse">
          ✓ Nota salva automaticamente!
        </div>
      )}

      {mode === 'manual' ? (
        /* ========== MANUAL MODE ========== */
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={isListening ? handleStopManual : handleStartManual}
            disabled={isTranscribing}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
              isTranscribing
                ? 'bg-blue-400 shadow-lg shadow-blue-200'
                : isListening
                  ? 'bg-red-500 hover:bg-red-600 animate-pulse-recording shadow-lg shadow-red-200'
                  : 'bg-primary hover:bg-primary-dark shadow-lg shadow-indigo-200'
            }`}
          >
            {isTranscribing ? (
              <Loader2 className="w-8 h-8 text-white animate-spin" />
            ) : isListening ? (
              <MicOff className="w-8 h-8 text-white" />
            ) : (
              <Mic className="w-8 h-8 text-white" />
            )}
          </button>
          <p className="text-sm text-gray-500">
            {isTranscribing
              ? 'Transcrevendo audio...'
              : isListening
                ? 'Ouvindo... Toque para parar'
                : 'Toque para gravar'}
          </p>
          {dailyLimit !== undefined && todayCount !== undefined && (
            <div className={`text-xs font-medium px-3 py-1 rounded-full ${
              canSave ? 'bg-indigo-50 text-primary' : 'bg-red-50 text-red-600'
            }`}>
              {todayCount} de {dailyLimit} notas hoje
            </div>
          )}
        </div>
      ) : (
        /* ========== CONTINUOUS MODE (Web Speech only) ========== */
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={speech.isContinuousMode ? handleStopContinuous : handleStartContinuous}
            disabled={!canSave && !speech.isContinuousMode}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
              speech.isContinuousMode
                ? 'bg-green-500 hover:bg-green-600 shadow-lg shadow-green-200 animate-pulse-recording'
                : canSave
                  ? 'bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-200'
                  : 'bg-gray-300'
            }`}
          >
            <Radio className="w-8 h-8 text-white" />
          </button>
          <p className="text-sm text-gray-500">
            {speech.isContinuousMode
              ? 'Escuta ativa — toque para parar'
              : canSave
                ? 'Toque para iniciar escuta contínua'
                : 'Limite diário atingido'}
          </p>

          {speech.isContinuousMode && sessionCount > 0 && (
            <div className="text-xs font-medium px-3 py-1 rounded-full bg-green-50 text-green-700">
              {sessionCount} {sessionCount === 1 ? 'nota salva' : 'notas salvas'} nesta sessão
            </div>
          )}

          {dailyLimit !== undefined && todayCount !== undefined && (
            <div className={`text-xs font-medium px-3 py-1 rounded-full ${
              canSave ? 'bg-indigo-50 text-primary' : 'bg-red-50 text-red-600'
            }`}>
              {todayCount} de {dailyLimit} notas hoje
            </div>
          )}

          {/* Keyword hints */}
          {speech.isContinuousMode && (
            <div className="w-full bg-gray-50 rounded-lg p-3 mt-1">
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-2">Comandos de voz:</p>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">"Salvar nota"</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">"Pronto"</span>
                <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">"Cancelar"</span>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">5s silêncio = salva</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Transcript preview */}
      {(fullText || isTranscribing) && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              {isTranscribing
                ? 'Transcrevendo...'
                : speech.isContinuousMode
                  ? 'Gravando...'
                  : 'Texto capturado'}
            </label>
            {!speech.isContinuousMode && !isTranscribing && fullText && (
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="text-xs text-primary hover:text-primary-dark"
              >
                {isEditing ? 'Pronto' : 'Editar'}
              </button>
            )}
          </div>

          {isTranscribing ? (
            <div className="rounded-lg p-4 bg-blue-50 border border-blue-100 flex items-center justify-center gap-2 min-h-[80px]">
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              <span className="text-sm text-blue-600">Processando audio com Whisper AI...</span>
            </div>
          ) : isEditing && !speech.isContinuousMode ? (
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              className="w-full h-32 p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          ) : (
            <div className={`rounded-lg p-4 text-sm min-h-[80px] ${
              speech.isContinuousMode ? 'bg-green-50 text-gray-800 border border-green-100' : 'bg-gray-50 text-gray-800'
            }`}>
              {transcript}
              {interimTranscript && (
                <span className="text-gray-400 italic"> {interimTranscript}</span>
              )}
            </div>
          )}

          {/* Actions (manual mode only) */}
          {!speech.isContinuousMode && !isTranscribing && (
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
                onClick={handleReset}
                className="flex items-center justify-center gap-2 text-gray-500 hover:text-gray-700 py-2.5 px-4 rounded-lg text-sm border border-gray-200 hover:border-gray-300 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Limpar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
