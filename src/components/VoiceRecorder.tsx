import { useState } from 'react'
import { Mic, MicOff, Save, RotateCcw, Loader2, Radio } from 'lucide-react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useAudioTranscription } from '../hooks/useAudioTranscription'
import { sanitizeTranscript } from '../lib/speech'

interface VoiceRecorderProps {
  onSave: (text: string) => Promise<void>
  canSave?: boolean
  remainingNotes?: number
  todayCount?: number
  dailyLimit?: number
}

const BUILD_MARKER = 'BUILD MANUAL SERVER 16-03 09:16'

export function VoiceRecorder({ onSave, canSave = true, todayCount, dailyLimit }: VoiceRecorderProps) {
  const {
    isListening: isSpeechListening,
    transcript: speechTranscript,
    interimTranscript,
    error: speechError,
    isSupported: isSpeechSupported,
    isContinuousMode,
    stop: stopSpeech,
    startContinuous,
    stopContinuous,
  } = useSpeechRecognition()
  const {
    isSupported: isManualSupported,
    isRecording,
    isTranscribing,
    transcript: manualTranscript,
    error: manualError,
    start: startRecording,
    stop: stopRecording,
    reset: resetRecording,
    setTranscript: setManualTranscript,
  } = useAudioTranscription()
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [mode, setMode] = useState<'manual' | 'continuous'>('manual')
  const [autoSaveFlash, setAutoSaveFlash] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)
  const isManualMode = mode === 'manual'
  const manualBusy = isRecording || isTranscribing
  const activeTranscript = isManualMode ? manualTranscript : speechTranscript
  const activeError = isManualMode ? manualError : speechError
  const fullText = isManualMode
    ? sanitizeTranscript(manualTranscript)
    : sanitizeTranscript(`${speechTranscript} ${interimTranscript}`)
  const hasVoiceSupport = isManualSupported || isSpeechSupported

  if (!hasVoiceSupport) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <MicOff className="w-12 h-12 text-amber-500 mx-auto mb-3" />
        <p className="text-amber-800 font-medium">Navegador sem suporte</p>
        <p className="text-amber-600 text-sm mt-1">
          Use um navegador com acesso ao microfone para gravacao e transcricao de voz.
        </p>
      </div>
    )
  }

  const handleSave = async () => {
    const text = sanitizeTranscript(manualTranscript)
    if (!text) return
    setSaving(true)
    try {
      await onSave(text)
      resetRecording()
    } catch {
      // error handled by parent
    } finally {
      setSaving(false)
    }
  }

  const showAutoSaveFlash = () => {
    setAutoSaveFlash(true)
    setTimeout(() => setAutoSaveFlash(false), 2000)
  }

  const handleStartContinuous = () => {
    if (!canSave) return
    setSessionCount(0)
    startContinuous({
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
    const remaining = sanitizeTranscript(speechTranscript)
    stopContinuous()
    setSessionCount(0)
    if (!remaining) return

    void onSave(remaining).catch(() => {
      // error handled by parent
    })
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="mb-3 text-center text-[10px] font-bold tracking-[0.18em] text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-200 rounded-full px-3 py-1">
        {BUILD_MARKER}
      </div>
      {/* Mode toggle */}
      <div className="flex items-center justify-center gap-1 mb-5 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => {
            if (isContinuousMode) stopContinuous()
            if (isSpeechListening && !isContinuousMode) stopSpeech()
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
            if (isRecording) stopRecording()
            if (isSpeechListening && !isContinuousMode) stopSpeech()
            setMode('continuous')
          }}
          disabled={!isSpeechSupported}
          className={`flex-1 text-xs font-medium py-2 px-3 rounded-md transition-colors ${
            mode === 'continuous'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Radio className="w-3.5 h-3.5 inline mr-1" />
          Contínuo antigo
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
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
            Manual via servidor novo
          </div>
          <button
            onClick={() => {
              if (isRecording) {
                stopRecording()
                return
              }

              void startRecording()
            }}
            disabled={!isManualSupported || isTranscribing}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
              isRecording
                ? 'bg-red-500 hover:bg-red-600 animate-pulse-recording shadow-lg shadow-red-200'
                : isTranscribing
                  ? 'bg-amber-500 shadow-lg shadow-amber-200'
                : 'bg-primary hover:bg-primary-dark shadow-lg shadow-indigo-200'
            }`}
          >
            {isRecording ? (
              <MicOff className="w-8 h-8 text-white" />
            ) : isTranscribing ? (
              <Loader2 className="w-8 h-8 text-white animate-spin" />
            ) : (
              <Mic className="w-8 h-8 text-white" />
            )}
          </button>
          <p className="text-sm text-gray-500">
            {isRecording
              ? 'Gravando audio... Toque para parar'
              : isTranscribing
                ? 'Transcrevendo audio...'
                : isManualSupported
                  ? 'Toque para gravar'
                  : 'Gravacao de audio indisponivel neste navegador'}
          </p>
          <p className="text-xs text-gray-400 text-center max-w-xs">
            O modo manual grava o audio primeiro e depois transcreve, o que costuma funcionar melhor no celular.
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
        /* ========== CONTINUOUS MODE ========== */
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={isContinuousMode ? handleStopContinuous : handleStartContinuous}
            disabled={!canSave && !isContinuousMode}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
              isContinuousMode
                ? 'bg-green-500 hover:bg-green-600 shadow-lg shadow-green-200 animate-pulse-recording'
                : canSave
                  ? 'bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-200'
                  : 'bg-gray-300'
            }`}
          >
            <Radio className="w-8 h-8 text-white" />
          </button>
          <p className="text-sm text-gray-500">
            {isContinuousMode
              ? 'Escuta ativa — toque para parar'
              : canSave
                ? 'Toque para iniciar escuta contínua'
                : 'Limite diário atingido'}
          </p>

          {isContinuousMode && sessionCount > 0 && (
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
          {isContinuousMode && (
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
      {activeError && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {activeError}
        </div>
      )}

      {/* Transcript preview */}
      {fullText && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              {isContinuousMode ? 'Gravando...' : 'Texto transcrito'}
            </label>
            {!isContinuousMode && (
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="text-xs text-primary hover:text-primary-dark"
              >
                {isEditing ? 'Pronto' : 'Editar'}
              </button>
            )}
          </div>
          {isEditing && !isContinuousMode ? (
            <textarea
              value={manualTranscript}
              onChange={(e) => setManualTranscript(e.target.value)}
              className="w-full h-32 p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          ) : (
            <div className={`rounded-lg p-4 text-sm min-h-[80px] ${
              isContinuousMode ? 'bg-green-50 text-gray-800 border border-green-100' : 'bg-gray-50 text-gray-800'
            }`}>
              {activeTranscript}
              {interimTranscript && (
                !isManualMode && <span className="text-gray-400 italic"> {interimTranscript}</span>
              )}
            </div>
          )}

          {/* Actions (manual mode only) */}
          {!isContinuousMode && (
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleSave}
                disabled={saving || manualBusy || !manualTranscript.trim() || !canSave}
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
                onClick={resetRecording}
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
