import { useEffect, useState } from 'react'
import { Save, RotateCcw, Loader2, Radio, Shield } from 'lucide-react'
import { StatusBanner } from './StatusBanner'
import { VoiceIdeasRecorderIcon } from './VoiceIdeasIcons'
import { VoiceSegmentationSettings } from './settings/VoiceSegmentationSettings'
import { useContinuousSpeechController } from '../hooks/continuous/useContinuousSpeechController'
import { useAudioTranscription } from '../hooks/useAudioTranscription'
import { useSafeCaptureMode } from '../hooks/useSafeCaptureMode'
import { useVoiceSegmentationSettings } from '../hooks/useVoiceSegmentationSettings'
import { sanitizeTranscript } from '../lib/speech'
import { getErrorMessage } from '../lib/errors'
import { getPlatformSource } from '../lib/platform'
import { segmentCaptureSession } from '../services/captureSessionService'
import type { SegmentCaptureSessionResult } from '../types/segmentation'

interface VoiceRecorderProps {
  onSave: (text: string) => Promise<void>
  canSave?: boolean
  remainingNotes?: number
  todayCount?: number
  dailyLimit?: number
}

export function VoiceRecorder({ onSave, canSave = true, todayCount, dailyLimit }: VoiceRecorderProps) {
  const platformSource = getPlatformSource()
  const prefersSafeCaptureOnThisPlatform = platformSource === 'android' || platformSource === 'ios'
  const {
    isListening: isContinuousListening,
    transcript: continuousTranscript,
    interimTranscript,
    error: continuousError,
    isSupported: isContinuousSupported,
    supportsVoiceCommands,
    usesAudioOnlyContinuousFallback,
    isContinuousMode,
    state: continuousRuntimeState,
    strategy: continuousStrategy,
    currentTranscript: fullContinuousText,
    stopSingleSpeech,
    startContinuous,
    stopContinuous,
    clearError: clearContinuousError,
  } = useContinuousSpeechController()
  const {
    isSupported: isManualSupported,
    phase: manualPhase,
    isRecording,
    isSelectingAudio,
    isTranscribing,
    transcript: manualTranscript,
    error: manualError,
    start: startRecording,
    stop: stopRecording,
    reset: resetRecording,
    retry: retryManualTranscription,
    clearError: clearManualError,
    setTranscript: setManualTranscript,
    canRetry: canRetryManualTranscription,
  } = useAudioTranscription()
  const {
    isSupported: isSafeCaptureSupported,
    phase: safeCapturePhase,
    error: safeCaptureError,
    pendingUploadsError,
    savedSession,
    pendingUploads,
    currentPendingUpload,
    capabilities: safeCaptureCapabilities,
    permissionState: safeCapturePermissionState,
    availabilityState: safeCaptureAvailabilityState,
    interruptionReason: safeCaptureInterruptionReason,
    isPendingUploadStoreSupported,
    isRetryingPendingUpload,
    isRecording: isSafeCaptureRecording,
    isSavingSession: isSafeCaptureSaving,
    startCapture,
    stopCapture,
    retryPendingUpload,
    reset: resetSafeCapture,
    clearError: clearSafeCaptureError,
  } = useSafeCaptureMode()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [segmentationError, setSegmentationError] = useState<string | null>(null)
  const [segmentationResult, setSegmentationResult] = useState<SegmentCaptureSessionResult | null>(null)
  const [isSegmentingSession, setIsSegmentingSession] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [mode, setMode] = useState<'manual' | 'continuous' | 'safe-capture'>(
    prefersSafeCaptureOnThisPlatform ? 'safe-capture' : 'manual',
  )
  const [autoSaveFlash, setAutoSaveFlash] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)
  const {
    settings: segmentationSettings,
    updateSetting: updateSegmentationSetting,
    resetSettings: resetSegmentationSettings,
  } = useVoiceSegmentationSettings()
  const isManualMode = mode === 'manual'
  const isContinuousSelected = mode === 'continuous'
  const isSafeMode = mode === 'safe-capture'
  const manualBusy = manualPhase !== 'idle'
  const safeModeBusy = safeCapturePhase === 'recording' || safeCapturePhase === 'saving-session'
  const activeTranscript = isManualMode
    ? manualTranscript
    : isContinuousSelected
      ? continuousTranscript
      : ''
  const activeError = isManualMode
    ? manualError
    : isContinuousSelected
      ? continuousError
      : safeCaptureError
  const fullText = isManualMode
    ? sanitizeTranscript(manualTranscript)
    : isContinuousSelected
      ? fullContinuousText
      : ''
  const hasVoiceSupport = isManualSupported || isContinuousSupported || isSafeCaptureSupported
  const manualStatusMessage = isRecording
    ? 'Gravando audio... Toque para parar'
    : isSelectingAudio
      ? 'Abrindo o gravador do celular...'
      : isTranscribing
        ? 'Transcrevendo audio...'
        : isManualSupported
          ? 'Toque para gravar'
          : 'Gravacao de audio indisponivel neste navegador'
  const continuousStatusMessage = isContinuousMode
    ? ({
        starting: 'Iniciando escuta continua...',
        listening: usesAudioOnlyContinuousFallback
          ? 'Escuta ativa — siga falando; cada pausa vira uma nota'
          : 'Escuta ativa — toque para parar',
        'segment-finalizing': 'Finalizando a nota atual...',
        saving: 'Salvando a nota atual...',
        'restart-pending': 'Preparando a proxima escuta...',
        error: 'A sessao encontrou um erro. Veja a mensagem abaixo.',
        idle: canSave
          ? 'Toque para iniciar escuta contínua'
          : 'Limite diário atingido',
      }[continuousRuntimeState] ?? 'Escuta ativa — toque para parar')
    : canSave
      ? (usesAudioOnlyContinuousFallback
        ? 'Toque para iniciar e seguir despejando suas ideias'
        : 'Toque para iniciar escuta contínua')
      : 'Limite diário atingido'
  const safeCaptureStatusMessage = ({
    ready:
      !isSafeCaptureSupported
        ? 'Captura segura indisponivel neste ambiente'
        : currentPendingUpload
          ? 'Existe uma sessao gravada localmente aguardando envio.'
        : safeCaptureAvailabilityState === 'permission-required'
          ? 'Permissao de microfone necessaria para iniciar a sessao'
        : safeCaptureAvailabilityState === 'permission-denied'
            ? 'Permissao negada. Libere o microfone para continuar.'
            : safeCaptureAvailabilityState === 'foreground-required'
              ? 'Mantenha o app aberto e a tela ativa durante a sessao.'
            : safeCaptureAvailabilityState === 'interrupted'
              ? 'A sessao foi interrompida. Veja a mensagem abaixo.'
              : 'Toque para iniciar uma sessao de captura segura',
    recording: 'Gravando a sessao bruta... Toque para encerrar',
    'saving-session': 'Salvando a sessao bruta...',
    saved: 'Sessao salva. A segmentacao e a transcricao acontecem depois.',
    error: 'A captura encontrou um erro. Veja a mensagem abaixo.',
  }[safeCapturePhase] ?? 'Toque para iniciar uma sessao de captura segura')
  const safeCapturePermissionLabel = ({
    granted: 'concedida',
    denied: 'negada',
    prompt: 'pendente',
    unavailable: 'indisponivel',
  }[safeCapturePermissionState] ?? safeCapturePermissionState)
  const safeCaptureAvailabilityLabel = ({
    available: 'disponivel',
    'permission-required': 'precisa de permissao',
    'permission-denied': 'bloqueada por permissao',
    'foreground-required': 'requer primeiro plano',
    interrupted: 'interrompida',
    unavailable: 'indisponivel',
  }[safeCaptureAvailabilityState] ?? safeCaptureAvailabilityState)
  const safeCaptureInterruptionLabel = safeCaptureInterruptionReason
    ? ({
        'app-backgrounded': 'app saiu do primeiro plano',
        'recorder-error': 'erro do gravador',
        'media-stream-ended': 'fluxo de microfone encerrado',
        'platform-restriction': 'restricao da plataforma',
      }[safeCaptureInterruptionReason] ?? safeCaptureInterruptionReason)
    : null
  const pendingUploadStatusLabel = currentPendingUpload
    ? ({
        'captured-locally': 'gravada localmente',
        'pending-upload': 'pendente de envio',
        uploading: 'enviando',
        uploaded: 'enviada',
        failed: 'falhou no envio',
      }[currentPendingUpload.status] ?? currentPendingUpload.status)
    : null
  const pendingUploadStageLabel = currentPendingUpload
    ? ({
        'local-capture': 'captura local',
        'storage-upload': 'upload do arquivo',
        'metadata-persist': 'persistencia do rawStoragePath',
        'session-complete': 'conclusao da sessao',
      }[currentPendingUpload.stage] ?? currentPendingUpload.stage)
    : null
  const recommendedMode = isSafeCaptureSupported ? 'safe-capture' : isManualSupported ? 'manual' : 'continuous'
  const shouldShowSafeCaptureRecommendation = isSafeCaptureSupported && mode !== 'safe-capture'

  useEffect(() => {
    if (mode !== 'safe-capture' && mode !== 'manual' && mode !== 'continuous') {
      return
    }

    if (mode === 'safe-capture' && !isSafeCaptureSupported) {
      if (isManualSupported) {
        setMode('manual')
      } else if (isContinuousSupported) {
        setMode('continuous')
      }
    }
  }, [isContinuousSupported, isManualSupported, isSafeCaptureSupported, mode])

  if (!hasVoiceSupport) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <VoiceIdeasRecorderIcon className="w-12 h-12 mx-auto mb-3" />
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
    setSaveError(null)
    setSaving(true)
    try {
      await onSave(text)
      resetRecording()
    } catch (saveFailure) {
      setSaveError(getErrorMessage(saveFailure, 'Nao foi possivel salvar a nota transcrita.'))
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
    clearContinuousError()
    setSaveError(null)
    setSessionCount(0)
    startContinuous({
      onAutoSave: async (text) => {
        if (!text.trim()) return
        try {
          await onSave(text.trim())
          setSessionCount((c) => c + 1)
          showAutoSaveFlash()
        } catch (saveFailure) {
          setSaveError(getErrorMessage(saveFailure, 'Nao foi possivel salvar automaticamente a nota.'))
        }
      },
      onAutoCancel: () => {
        showAutoSaveFlash()
      },
    })
  }

  const handleStopContinuous = () => {
    stopContinuous({ savePending: true })
    setSessionCount(0)
  }

  const dismissActiveError = () => {
    if (isManualMode) {
      clearManualError()
      return
    }

    if (isSafeMode) {
      clearSafeCaptureError()
      return
    }

    clearContinuousError()
  }

  const handleRetryManual = () => {
    clearManualError()
    retryManualTranscription()
  }

  const handleSegmentSavedSession = async () => {
    if (!savedSession || isSegmentingSession) {
      return
    }

    setSegmentationError(null)
    setSegmentationResult(null)
    setIsSegmentingSession(true)

    try {
      const result = await segmentCaptureSession({
        sessionId: savedSession.sessionId,
        mediumSilenceMs: segmentationSettings.mediumSilenceMs,
        longSilenceMs: segmentationSettings.longSilenceMs,
        minChunkMs: segmentationSettings.minChunkMs,
        analysisWindowMs: segmentationSettings.analysisWindowMs,
        strongDelimiterPhrase: segmentationSettings.strongDelimiterPhrase,
      })

      setSegmentationResult(result)
    } catch (segmentFailure) {
      setSegmentationError(getErrorMessage(segmentFailure, 'Nao foi possivel segmentar a sessao salva.'))
    } finally {
      setIsSegmentingSession(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      {/* Mode toggle */}
      <div className="flex items-center justify-center gap-1 mb-5 bg-gray-100 rounded-lg p-1">
        <button
          type="button"
          onClick={() => {
            if (safeModeBusy) return
            if (isContinuousMode) stopContinuous()
            if (isContinuousListening && !isContinuousMode) stopSingleSpeech()
              clearManualError()
              setSaveError(null)
              setSegmentationError(null)
              setSegmentationResult(null)
              setMode('manual')
          }}
          disabled={!isManualSupported || safeModeBusy}
          className={`flex-1 text-xs font-medium py-2 px-3 rounded-md transition-colors ${
            mode === 'manual'
              ? 'bg-white text-gray-900 shadow-sm'
              : !isManualSupported || safeModeBusy
                ? 'text-gray-300 cursor-not-allowed'
                : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center justify-center gap-1">
            <VoiceIdeasRecorderIcon className="w-3.5 h-3.5" />
            Manual
          </span>
          <span className="mt-0.5 block text-[10px] opacity-70">uma ideia por vez</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (safeModeBusy) return
            if (isRecording) stopRecording()
            if (isContinuousListening && !isContinuousMode) stopSingleSpeech()
            clearContinuousError()
            setSaveError(null)
            setSegmentationError(null)
            setSegmentationResult(null)
            setMode('continuous')
          }}
          disabled={!isContinuousSupported || safeModeBusy}
          className={`flex-1 text-xs font-medium py-2 px-3 rounded-md transition-colors ${
            mode === 'continuous'
              ? 'bg-white text-gray-900 shadow-sm'
              : isContinuousSupported && !safeModeBusy
                ? 'text-gray-500 hover:text-gray-700'
                : 'text-gray-300 cursor-not-allowed'
          }`}
        >
          <span className="flex items-center justify-center gap-1">
            <Radio className="w-3.5 h-3.5" />
            Contínuo
          </span>
          <span className="mt-0.5 block text-[10px] opacity-70">avançado / legado</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (manualBusy || isContinuousMode || safeModeBusy) return
            clearSafeCaptureError()
            setSaveError(null)
            setSegmentationError(null)
            setSegmentationResult(null)
            setMode('safe-capture')
          }}
          disabled={!isSafeCaptureSupported || manualBusy || isContinuousMode || safeModeBusy}
          className={`flex-1 text-xs font-medium py-2 px-3 rounded-md transition-colors ${
            mode === 'safe-capture'
              ? 'bg-white text-gray-900 shadow-sm'
              : isSafeCaptureSupported && !manualBusy && !isContinuousMode && !safeModeBusy
                ? 'text-gray-500 hover:text-gray-700'
                : 'text-gray-300 cursor-not-allowed'
          }`}
        >
          <span className="flex items-center justify-center gap-1">
            <Shield className="w-3.5 h-3.5" />
            Captura segura
          </span>
          <span className="mt-0.5 block text-[10px] opacity-70">
            {recommendedMode === 'safe-capture' ? 'recomendado' : 'sessão confiável'}
          </span>
        </button>
      </div>

      {shouldShowSafeCaptureRecommendation && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          {prefersSafeCaptureOnThisPlatform
            ? 'Neste aparelho, o modo recomendado é Captura segura. Ele prioriza gravar e salvar a sessão antes de qualquer segmentação ou transcrição.'
            : 'Se a prioridade for confiabilidade, prefira Captura segura. Ela ancora a sessão primeiro e deixa a inteligência para depois.'}
        </div>
      )}

      {!isContinuousSupported && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          O modo contínuo depende do reconhecimento de voz do navegador. No web, ele funciona melhor em Chrome e Edge.
        </div>
      )}

      {!isSafeCaptureSupported && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
          {!isPendingUploadStoreSupported
            ? 'A Captura segura precisa de armazenamento local temporario, e ele nao esta disponivel neste ambiente.'
            : safeCaptureCapabilities.notes[0] || 'A Captura segura nao esta disponivel neste ambiente.'}
        </div>
      )}

      {mode === 'safe-capture' && pendingUploadsError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {pendingUploadsError}
        </div>
      )}

      {mode === 'safe-capture' && isSafeCaptureSupported && safeCaptureCapabilities.requiresForeground && (
        <div className="mb-4 rounded-lg border border-slate-300 bg-slate-100 p-3 text-xs text-slate-700">
          No iPhone, a captura segura e foreground-first: mantenha o VoiceIdeas aberto e a tela ativa durante a sessao.
        </div>
      )}

      {mode === 'safe-capture' && isSafeCaptureSupported && safeCaptureAvailabilityState === 'permission-required' && (
        <div className="mb-4 rounded-lg border border-slate-300 bg-slate-100 p-3 text-xs text-slate-700">
          A captura segura precisa de permissao de microfone antes de iniciar.
        </div>
      )}

      {mode === 'safe-capture' && isSafeCaptureSupported && safeCaptureAvailabilityState === 'permission-denied' && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          O microfone foi negado neste aparelho. Libere a permissao para usar a captura segura.
        </div>
      )}

      {mode === 'continuous' && usesAudioOnlyContinuousFallback && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
          Neste aparelho, o modo contínuo fica ouvindo em sequência e salva cada ideia quando você faz uma pausa natural. Toque para parar só quando quiser encerrar a sessão.
        </div>
      )}

      {mode === 'continuous' && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          O Contínuo continua disponível como modo avançado. Para máxima confiabilidade de captura, o caminho recomendado agora é Captura segura.
        </div>
      )}

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
            type="button"
            onClick={() => {
              if (isRecording) {
                stopRecording()
                return
              }

              clearManualError()
              setSaveError(null)
              void startRecording()
            }}
            disabled={!isManualSupported || isSelectingAudio || isTranscribing}
            className={`relative flex h-20 w-20 items-center justify-center rounded-full transition-all ${
              isRecording
                ? 'scale-[1.03] animate-pulse-recording'
                : isSelectingAudio || isTranscribing
                  ? 'opacity-90'
                  : 'hover:scale-[1.02]'
            }`}
          >
            <VoiceIdeasRecorderIcon
              active={isRecording}
              className={`h-20 w-20 drop-shadow-lg ${
                isRecording
                  ? 'drop-shadow-[0_12px_24px_rgba(239,68,68,0.35)]'
                  : 'drop-shadow-[0_12px_24px_rgba(15,23,42,0.18)]'
              } ${isSelectingAudio || isTranscribing ? 'opacity-35' : ''}`}
            />
            {(isSelectingAudio || isTranscribing) && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              </span>
            )}
          </button>
          <p className="text-sm text-gray-500">
            {manualStatusMessage}
          </p>
          <p className="text-xs text-gray-400 text-center max-w-xs">
            No app instalado, o modo manual grava aqui e depois transcreve o audio no servidor. No navegador mobile, ele pode abrir o gravador do aparelho.
          </p>
          {dailyLimit !== undefined && todayCount !== undefined && (
            <div className={`text-xs font-medium px-3 py-1 rounded-full ${
              canSave ? 'bg-slate-100 text-primary' : 'bg-red-50 text-red-600'
            }`}>
              {todayCount} de {dailyLimit} notas hoje
            </div>
          )}
        </div>
      ) : mode === 'continuous' ? (
        /* ========== CONTINUOUS MODE ========== */
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
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
            {continuousStatusMessage}
          </p>

          {isContinuousMode && (
            <div className="text-[11px] font-medium px-3 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
              Estado: {continuousRuntimeState} {continuousStrategy ? `· ${continuousStrategy}` : ''}
            </div>
          )}

          {isContinuousMode && sessionCount > 0 && (
            <div className="text-xs font-medium px-3 py-1 rounded-full bg-green-50 text-green-700">
              {sessionCount} {sessionCount === 1 ? 'nota salva' : 'notas salvas'} nesta sessão
            </div>
          )}

          {dailyLimit !== undefined && todayCount !== undefined && (
            <div className={`text-xs font-medium px-3 py-1 rounded-full ${
              canSave ? 'bg-slate-100 text-primary' : 'bg-red-50 text-red-600'
            }`}>
              {todayCount} de {dailyLimit} notas hoje
            </div>
          )}

          {/* Keyword hints */}
          {isContinuousMode && supportsVoiceCommands && continuousStrategy !== 'audio-fallback' && (
            <div className="w-full bg-gray-50 rounded-lg p-3 mt-1">
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-2">Comandos de voz:</p>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">"Salvar nota"</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">"Pronto"</span>
                <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">"Cancelar"</span>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">Toque para parar = salva</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ========== SAFE CAPTURE MODE ========== */
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => {
              if (isSafeCaptureRecording) {
                void stopCapture()
                return
              }

              if (isSafeCaptureSaving) return
              clearSafeCaptureError()
              setSaveError(null)
              void startCapture()
            }}
            disabled={!isSafeCaptureSupported || isSafeCaptureSaving}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
              isSafeCaptureRecording
                ? 'bg-red-500 hover:bg-red-600 animate-pulse-recording shadow-lg shadow-red-200'
                : isSafeCaptureSaving
                  ? 'bg-amber-500 shadow-lg shadow-amber-200'
                  : isSafeCaptureSupported
                    ? 'bg-slate-700 hover:bg-slate-800 shadow-lg shadow-slate-200'
                    : 'bg-gray-300'
            }`}
          >
            {isSafeCaptureSaving ? (
              <Loader2 className="w-8 h-8 text-white animate-spin" />
            ) : (
              <Shield className="w-8 h-8 text-white" />
            )}
          </button>
          <p className="text-sm text-gray-500">
            {safeCaptureStatusMessage}
          </p>
          <p className="text-xs text-gray-400 text-center max-w-xs">
            {safeCaptureCapabilities.engine === 'capacitor-native-recorder'
              ? 'Neste aparelho, a captura segura usa gravacao nativa e so depois sobe a sessao. A segmentacao, a fila e a transcricao acontecem depois.'
              : 'A captura segura prioriza gravar e salvar o audio bruto da sessao. A segmentacao, a fila e a transcricao acontecem depois.'}
          </p>

          <div className="text-[11px] font-medium px-3 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
            Estado: {safeCapturePhase}
          </div>

          <div className="text-[11px] font-medium px-3 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
            Permissao: {safeCapturePermissionLabel} · Disponibilidade: {safeCaptureAvailabilityLabel}
            {safeCaptureInterruptionLabel ? ` · Interrupcao: ${safeCaptureInterruptionLabel}` : ''}
          </div>

          {pendingUploads.length > 0 && (
            <div className="text-[11px] font-medium px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              {pendingUploads.length} {pendingUploads.length === 1 ? 'captura pendente de envio' : 'capturas pendentes de envio'}
            </div>
          )}

          {savedSession && (
            <div className="w-full rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-medium">Sessao salva com sucesso</p>
              <div className="mt-2 space-y-1 text-xs text-emerald-800">
                <p>Pasta provisoria: <span className="font-medium">{savedSession.provisionalFolderName}</span></p>
                <p>Status da sessao: <span className="font-medium">{savedSession.status}</span></p>
                <p>Status do processamento: <span className="font-medium">{savedSession.processingStatus}</span></p>
                <p>Audio bruto: <span className="break-all font-mono text-[11px]">{savedSession.rawStoragePath}</span></p>
                <p>Iniciada em: <span className="font-medium">{new Date(savedSession.startedAt).toLocaleString('pt-BR')}</span></p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSegmentationError(null)
                  setSegmentationResult(null)
                  resetSafeCapture()
                }}
                className="mt-3 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                Nova sessao
              </button>
            </div>
          )}

          {currentPendingUpload && (
            <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">Sessao gravada localmente</p>
              <div className="mt-2 space-y-1 text-xs text-amber-800">
                <p>Pasta provisoria: <span className="font-medium">{currentPendingUpload.provisionalFolderName}</span></p>
                <p>Envio: <span className="font-medium">{pendingUploadStatusLabel}</span></p>
                <p>Etapa atual: <span className="font-medium">{pendingUploadStageLabel}</span></p>
                <p>Duracao: <span className="font-medium">{Math.max(1, Math.round(currentPendingUpload.durationMs / 1000))}s</span></p>
                {currentPendingUpload.rawStoragePath && (
                  <p>Storage path: <span className="break-all font-mono text-[11px]">{currentPendingUpload.rawStoragePath}</span></p>
                )}
                {currentPendingUpload.lastError && (
                  <p>Ultimo erro: <span className="font-medium">{currentPendingUpload.lastError}</span></p>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void retryPendingUpload(currentPendingUpload.sessionId)
                  }}
                  disabled={isRetryingPendingUpload || currentPendingUpload.status === 'uploading'}
                  className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRetryingPendingUpload || currentPendingUpload.status === 'uploading'
                    ? 'Reenviando...'
                    : 'Tentar envio de novo'}
                </button>
              </div>
            </div>
          )}

          {savedSession && (
            <VoiceSegmentationSettings
              settings={segmentationSettings}
              disabled={isSegmentingSession}
              onChange={updateSegmentationSetting}
              onReset={resetSegmentationSettings}
            />
          )}

          {savedSession && (
            <div className="w-full rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">Segmentacao posterior</p>
                  <p className="mt-1 text-xs text-slate-600">
                    A sessao continua preservada inteira. Os chunks sao derivados e ficam associados a essa mesma captura.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void handleSegmentSavedSession()
                  }}
                  disabled={isSegmentingSession}
                  className="rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSegmentingSession ? 'Segmentando...' : 'Segmentar agora'}
                </button>
              </div>

              {segmentationResult && (
                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                  <p className="font-medium">
                    {segmentationResult.chunks.length} {segmentationResult.chunks.length === 1 ? 'chunk criado' : 'chunks criados'}
                  </p>
                  <div className="mt-2 space-y-1 text-blue-800">
                    <p>Estrategia: <span className="font-medium">{segmentationResult.strategy}</span></p>
                    <p>Fallback: <span className="font-medium">{segmentationResult.usedFallback ? 'sim' : 'nao'}</span></p>
                    <p>Expressao forte preparada: <span className="font-medium">{segmentationResult.strongDelimiterPrepared ? 'sim' : 'nao'}</span></p>
                  </div>
                  <div className="mt-3 space-y-2">
                    {segmentationResult.chunks.map((chunk, index) => (
                      <div key={chunk.id} className="rounded-lg border border-blue-100 bg-white p-2">
                        <p className="font-medium">Chunk {index + 1}</p>
                        <p className="mt-1 text-[11px] text-blue-800">
                          {Math.round(chunk.startMs / 1000)}s - {Math.round(chunk.endMs / 1000)}s · {Math.max(1, Math.round(chunk.durationMs / 1000))}s · {chunk.segmentationReason}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeError && (
        <div className="mt-4">
          <StatusBanner
            variant="error"
            title={
              isManualMode
                ? 'Falha na transcricao'
                : isSafeMode
                  ? 'Falha na captura segura'
                  : 'Falha na escuta continua'
            }
            onDismiss={dismissActiveError}
          >
            <p>{activeError}</p>
            {isManualMode && canRetryManualTranscription && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleRetryManual}
                  className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
                >
                  Tentar transcrever de novo
                </button>
                <button
                  type="button"
                  onClick={resetRecording}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
                >
                  Limpar audio
                </button>
              </div>
            )}
          </StatusBanner>
        </div>
      )}

      {saveError && (
        <div className="mt-4">
          <StatusBanner
            variant="error"
            title="Nao foi possivel salvar a nota"
            onDismiss={() => setSaveError(null)}
          >
            {saveError}
          </StatusBanner>
        </div>
      )}

      {segmentationError && (
        <div className="mt-4">
          <StatusBanner
            variant="error"
            title="Nao foi possivel segmentar a sessao"
            onDismiss={() => setSegmentationError(null)}
          >
            {segmentationError}
          </StatusBanner>
        </div>
      )}

      {/* Transcript preview */}
      {fullText && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              {isContinuousMode
                ? ({
                    listening: 'Ouvindo...',
                    'segment-finalizing': 'Finalizando nota...',
                    saving: 'Salvando...',
                    'restart-pending': 'Reiniciando escuta...',
                    starting: 'Iniciando...',
                    error: 'Sessao com erro',
                    idle: 'Sessao continua',
                  }[continuousRuntimeState] ?? 'Sessao continua')
                : 'Texto transcrito'}
            </label>
            {!isContinuousMode && (
              <button
                type="button"
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
              aria-label="Texto transcrito para edicao"
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
                type="button"
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
                type="button"
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
