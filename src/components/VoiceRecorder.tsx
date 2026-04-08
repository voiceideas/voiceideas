import { useEffect, useState } from 'react'
import { Save, RotateCcw, Loader2, Radio, Shield, Sparkles, FileText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../hooks/useI18n'
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
import type { CaptureMagicMode, CaptureMagicState } from '../types/magicCapture'
import type { SegmentCaptureSessionResult, VoiceSegmentationSettings as RecorderSegmentationSettings } from '../types/segmentation'

interface VoiceRecorderProps {
  onSave: (text: string) => Promise<void>
  canSave?: boolean
  remainingNotes?: number
  todayCount?: number
  dailyLimit?: number
  captureMagicState?: CaptureMagicState
  onRunCaptureFlow?: (input: {
    sessionId: string
    mode: CaptureMagicMode
    segmentationSettings: RecorderSegmentationSettings
  }) => Promise<void>
}

export function VoiceRecorder({
  onSave,
  canSave = true,
  todayCount,
  dailyLimit,
  captureMagicState,
  onRunCaptureFlow,
}: VoiceRecorderProps) {
  const navigate = useNavigate()
  const { t, formatDate } = useI18n()
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
  const [showManualPostCaptureTools, setShowManualPostCaptureTools] = useState(false)
  const [mode, setMode] = useState<'manual' | 'continuous' | 'safe-capture'>(
    prefersSafeCaptureOnThisPlatform ? 'safe-capture' : 'manual',
  )
  const [autoSaveFlash, setAutoSaveFlash] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)
  const {
    settings: segmentationSettings,
    advancedModeEnabled: showAdvancedSegmentationControls,
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
    ? t('recorder.manual.status.recording')
    : isSelectingAudio
      ? t('recorder.manual.status.opening')
      : isTranscribing
        ? t('recorder.manual.status.transcribing')
        : isManualSupported
          ? t('recorder.manual.status.ready')
          : t('recorder.manual.status.unavailable')
  const continuousStatusMessage = isContinuousMode
    ? ({
        starting: t('recorder.continuous.status.starting'),
        listening: usesAudioOnlyContinuousFallback
          ? t('recorder.continuous.status.listeningFallback')
          : t('recorder.continuous.status.listening'),
        'segment-finalizing': t('recorder.continuous.status.finalizing'),
        saving: t('recorder.continuous.status.saving'),
        'restart-pending': t('recorder.continuous.status.restart'),
        error: t('recorder.continuous.status.error'),
        idle: canSave
          ? t('recorder.continuous.status.idle')
          : t('recorder.limitReached'),
      }[continuousRuntimeState] ?? t('recorder.continuous.status.listening'))
    : canSave
      ? (usesAudioOnlyContinuousFallback
        ? t('recorder.continuous.status.idleFallback')
        : t('recorder.continuous.status.idle'))
      : t('recorder.limitReached')
  const safeCaptureStatusMessage = ({
    ready:
      !isSafeCaptureSupported
        ? t('recorder.safe.status.ready.unavailable')
        : currentPendingUpload
          ? t('recorder.safe.status.ready.pendingUpload')
        : safeCaptureAvailabilityState === 'permission-required'
          ? t('recorder.safe.status.ready.permissionRequired')
        : safeCaptureAvailabilityState === 'permission-denied'
            ? t('recorder.safe.status.ready.permissionDenied')
            : safeCaptureAvailabilityState === 'foreground-required'
              ? t('recorder.safe.status.ready.foregroundRequired')
            : safeCaptureAvailabilityState === 'interrupted'
              ? t('recorder.safe.status.ready.interrupted')
              : t('recorder.safe.status.ready.default'),
    recording: t('recorder.safe.status.recording'),
    'saving-session': t('recorder.safe.status.saving'),
    saved: t('recorder.safe.status.saved'),
    error: t('recorder.safe.status.error'),
  }[safeCapturePhase] ?? t('recorder.safe.status.ready.default'))
  const safeCapturePermissionLabel = ({
    granted: t('recorder.safe.permission.granted'),
    denied: t('recorder.safe.permission.denied'),
    prompt: t('recorder.safe.permission.prompt'),
    unavailable: t('recorder.safe.permission.unavailable'),
  }[safeCapturePermissionState] ?? safeCapturePermissionState)
  const safeCaptureAvailabilityLabel = ({
    available: t('recorder.safe.availability.available'),
    'permission-required': t('recorder.safe.availability.permissionRequired'),
    'permission-denied': t('recorder.safe.availability.permissionDenied'),
    'foreground-required': t('recorder.safe.availability.foregroundRequired'),
    interrupted: t('recorder.safe.availability.interrupted'),
    unavailable: t('recorder.safe.availability.unavailable'),
  }[safeCaptureAvailabilityState] ?? safeCaptureAvailabilityState)
  const safeCaptureInterruptionLabel = safeCaptureInterruptionReason
    ? ({
        'app-backgrounded': t('recorder.safe.interruption.backgrounded'),
        'recorder-error': t('recorder.safe.interruption.recorderError'),
        'media-stream-ended': t('recorder.safe.interruption.mediaEnded'),
        'platform-restriction': t('recorder.safe.interruption.platformRestriction'),
      }[safeCaptureInterruptionReason] ?? safeCaptureInterruptionReason)
    : null
  const pendingUploadStatusLabel = currentPendingUpload
    ? ({
        'captured-locally': t('recorder.safe.pending.captured'),
        'pending-upload': t('recorder.safe.pending.pending'),
        uploading: t('recorder.safe.pending.uploading'),
        uploaded: t('recorder.safe.pending.uploaded'),
        failed: t('recorder.safe.pending.failed'),
      }[currentPendingUpload.status] ?? currentPendingUpload.status)
    : null
  const pendingUploadStageLabel = currentPendingUpload
    ? ({
        'local-capture': t('recorder.safe.pendingStage.local'),
        'storage-upload': t('recorder.safe.pendingStage.storage'),
        'metadata-persist': t('recorder.safe.pendingStage.metadata'),
        'session-complete': t('recorder.safe.pendingStage.complete'),
      }[currentPendingUpload.stage] ?? currentPendingUpload.stage)
    : null
  const recommendedMode = isSafeCaptureSupported ? 'safe-capture' : isManualSupported ? 'manual' : 'continuous'
  const shouldShowSafeCaptureRecommendation = isSafeCaptureSupported && mode !== 'safe-capture'
  const activeCaptureMagicState = savedSession && captureMagicState && captureMagicState.sessionId === savedSession.sessionId
    ? captureMagicState
    : null
  const isCaptureMagicRunning = activeCaptureMagicState?.status === 'running'
  const captureMagicResult = activeCaptureMagicState?.status === 'success'
    ? activeCaptureMagicState.result
    : null
  const captureMagicFailure = activeCaptureMagicState?.status === 'error'
    ? activeCaptureMagicState.error
    : null

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
        <p className="text-amber-800 font-medium">{t('recorder.browserUnsupportedTitle')}</p>
        <p className="text-amber-600 text-sm mt-1">
          {t('recorder.browserUnsupportedDescription')}
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
      setSaveError(getErrorMessage(saveFailure, t('recorder.saveNoteError')))
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
          setSaveError(getErrorMessage(saveFailure, t('recorder.saveNoteError')))
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
      setSegmentationError(getErrorMessage(segmentFailure, t('recorder.segmentSessionError')))
    } finally {
      setIsSegmentingSession(false)
    }
  }

  const handleRunCaptureFlow = (runMode: CaptureMagicMode) => {
    if (!savedSession || !onRunCaptureFlow || isCaptureMagicRunning) {
      return
    }

    setSaveError(null)
    setSegmentationError(null)
    setSegmentationResult(null)
    void onRunCaptureFlow({
      sessionId: savedSession.sessionId,
      mode: runMode,
      segmentationSettings,
    })
  }

  return (
    <div className="rounded-[28px] border border-black/6 bg-white/90 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.08)] backdrop-blur-xl">
      {/* Mode toggle */}
      <div className="mb-5 flex items-center justify-center gap-1 rounded-2xl border border-black/5 bg-stone-100/85 p-1.5">
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
              ? 'bg-white text-gray-900 shadow-[0_10px_20px_rgba(0,0,0,0.07)]'
              : !isManualSupported || safeModeBusy
                ? 'text-gray-300 cursor-not-allowed'
                : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center justify-center gap-1">
            <VoiceIdeasRecorderIcon className="w-3.5 h-3.5" />
            {t('recorder.mode.manual')}
          </span>
          <span className="mt-0.5 block text-[10px] opacity-70">{t('recorder.mode.manualHint')}</span>
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
              ? 'bg-white text-gray-900 shadow-[0_10px_20px_rgba(0,0,0,0.07)]'
              : isContinuousSupported && !safeModeBusy
                ? 'text-gray-500 hover:text-gray-700'
                : 'text-gray-300 cursor-not-allowed'
          }`}
        >
          <span className="flex items-center justify-center gap-1">
            <Radio className="w-3.5 h-3.5" />
            {t('recorder.mode.continuous')}
          </span>
          <span className="mt-0.5 block text-[10px] opacity-70">{t('recorder.mode.continuousHint')}</span>
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
              ? 'bg-white text-gray-900 shadow-[0_10px_20px_rgba(0,0,0,0.07)]'
              : isSafeCaptureSupported && !manualBusy && !isContinuousMode && !safeModeBusy
                ? 'text-gray-500 hover:text-gray-700'
                : 'text-gray-300 cursor-not-allowed'
          }`}
        >
          <span className="flex items-center justify-center gap-1">
            <Shield className="w-3.5 h-3.5" />
            {t('recorder.mode.safeCapture')}
          </span>
          <span className="mt-0.5 block text-[10px] opacity-70">
            {recommendedMode === 'safe-capture' ? t('recorder.mode.safeCaptureRecommended') : t('recorder.mode.safeCaptureReliable')}
          </span>
        </button>
      </div>

      {shouldShowSafeCaptureRecommendation && (
        <div className="mb-4 rounded-lg border border-slate-300 bg-slate-100 p-3 text-xs text-slate-700">
          {prefersSafeCaptureOnThisPlatform
            ? t('recorder.safeRecommendation.device')
            : t('recorder.safeRecommendation.default')}
        </div>
      )}

      {!isContinuousSupported && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          {t('recorder.continuousSupportNotice')}
        </div>
      )}

      {!isSafeCaptureSupported && (
        <div className="mb-4 rounded-lg border border-slate-300 bg-slate-100 p-3 text-xs text-slate-700">
          {!isPendingUploadStoreSupported
            ? t('recorder.safeCaptureNoStorage')
            : t('recorder.safeCaptureUnavailable')}
        </div>
      )}

      {mode === 'safe-capture' && pendingUploadsError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {pendingUploadsError}
        </div>
      )}

      {mode === 'safe-capture' && isSafeCaptureSupported && safeCaptureCapabilities.requiresForeground && (
        <div className="mb-4 rounded-lg border border-slate-300 bg-slate-100 p-3 text-xs text-slate-700">
          {t('recorder.safeCaptureForeground')}
        </div>
      )}

      {mode === 'safe-capture' && isSafeCaptureSupported && safeCaptureAvailabilityState === 'permission-required' && (
        <div className="mb-4 rounded-lg border border-slate-300 bg-slate-100 p-3 text-xs text-slate-700">
          {t('recorder.safeCaptureNeedsPermission')}
        </div>
      )}

      {mode === 'safe-capture' && isSafeCaptureSupported && safeCaptureAvailabilityState === 'permission-denied' && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {t('recorder.safeCaptureDenied')}
        </div>
      )}

      {mode === 'continuous' && usesAudioOnlyContinuousFallback && (
        <div className="mb-4 rounded-lg border border-stone-300 bg-stone-100 p-3 text-xs text-stone-700">
          {t('recorder.continuousFallbackNotice')}
        </div>
      )}

      {mode === 'continuous' && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {t('recorder.continuousLegacyNotice')}
        </div>
      )}

      {/* Auto-save flash */}
      {autoSaveFlash && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 text-center animate-pulse">
          ✓ {t('recorder.autoSaved')}
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
            {t('recorder.manual.deviceHint')}
          </p>
          {dailyLimit !== undefined && todayCount !== undefined && (
            <div className={`text-xs font-medium px-3 py-1 rounded-full ${
              canSave ? 'bg-slate-100 text-primary' : 'bg-red-50 text-red-600'
            }`}>
              {t('recorder.dailyCount', { current: todayCount, total: dailyLimit })}
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
              {t('recorder.continuous.state', { state: continuousRuntimeState, strategy: continuousStrategy || '' })}
            </div>
          )}

          {isContinuousMode && sessionCount > 0 && (
            <div className="text-xs font-medium px-3 py-1 rounded-full bg-green-50 text-green-700">
              {t('recorder.continuous.savedCount', { count: sessionCount })}
            </div>
          )}

          {dailyLimit !== undefined && todayCount !== undefined && (
            <div className={`text-xs font-medium px-3 py-1 rounded-full ${
              canSave ? 'bg-slate-100 text-primary' : 'bg-red-50 text-red-600'
            }`}>
              {t('recorder.dailyCount', { current: todayCount, total: dailyLimit })}
            </div>
          )}

          {/* Keyword hints */}
          {isContinuousMode && supportsVoiceCommands && continuousStrategy !== 'audio-fallback' && (
            <div className="w-full bg-gray-50 rounded-lg p-3 mt-1">
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-2">{t('recorder.continuous.commands')}</p>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">{t('recorder.continuous.command.save')}</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">{t('recorder.continuous.command.done')}</span>
                <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">{t('recorder.continuous.command.cancel')}</span>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">{t('recorder.continuous.command.tapToStop')}</span>
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
              ? t('recorder.safe.engine.native')
              : t('recorder.safe.engine.default')}
          </p>

          <div className="text-[11px] font-medium px-3 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
            {t('recorder.safe.state', { state: safeCapturePhase })}
          </div>

          <div className="text-[11px] font-medium px-3 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
            {t('recorder.safe.permissionAvailability', {
              permission: safeCapturePermissionLabel,
              availability: safeCaptureAvailabilityLabel,
              interruption: safeCaptureInterruptionLabel || '',
            })}
          </div>

          {pendingUploads.length > 0 && (
            <div className="text-[11px] font-medium px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              {t('recorder.safe.pendingUploads', { count: pendingUploads.length })}
            </div>
          )}

          {savedSession && (
            <div className="w-full rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-medium">{t('recorder.safe.savedTitle')}</p>
              <div className="mt-2 space-y-1 text-xs text-emerald-800">
                <p>{t('recorder.safe.savedFolder', { value: savedSession.provisionalFolderName })}</p>
                <p>{t('recorder.safe.savedStatus', { value: savedSession.status })}</p>
                <p>{t('recorder.safe.savedProcessing', { value: savedSession.processingStatus })}</p>
                <p>{t('recorder.safe.savedRaw', { value: savedSession.rawStoragePath || '' })}</p>
                <p>{t('recorder.safe.savedStartedAt', { value: formatDate(new Date(savedSession.startedAt), { dateStyle: 'short', timeStyle: 'short' }) })}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSegmentationError(null)
                  setSegmentationResult(null)
                  resetSafeCapture()
                }}
                disabled={isCaptureMagicRunning}
                className="mt-3 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                {t('recorder.safe.newSession')}
              </button>
            </div>
          )}

          {currentPendingUpload && (
            <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">{t('recorder.safe.localTitle')}</p>
              <div className="mt-2 space-y-1 text-xs text-amber-800">
                <p>{t('recorder.safe.localFolder', { value: currentPendingUpload.provisionalFolderName })}</p>
                <p>{t('recorder.safe.localUpload', { value: pendingUploadStatusLabel || '' })}</p>
                <p>{t('recorder.safe.localStage', { value: pendingUploadStageLabel || '' })}</p>
                <p>{t('recorder.safe.localDuration', { value: Math.max(1, Math.round(currentPendingUpload.durationMs / 1000)) })}</p>
                {currentPendingUpload.rawStoragePath && (
                  <p>{t('recorder.safe.localStoragePath', { value: currentPendingUpload.rawStoragePath })}</p>
                )}
                {currentPendingUpload.lastError && (
                  <p>{t('recorder.safe.localLastError', { value: currentPendingUpload.lastError })}</p>
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
                    ? t('recorder.safe.retryingUpload')
                    : t('recorder.safe.retryUpload')}
                </button>
              </div>
            </div>
          )}

          {savedSession && (
            <div className="w-full rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <p className="font-medium">{t('recorder.postCapture.title')}</p>
                  <p className="text-xs text-slate-600">
                    {t('recorder.postCapture.description')}
                  </p>
                </div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                  {activeCaptureMagicState?.mode === 'raw'
                    ? t('recorder.postCapture.mode.raw')
                    : activeCaptureMagicState?.mode === 'magic'
                      ? t('recorder.postCapture.mode.magic')
                      : t('recorder.postCapture.mode.default')}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleRunCaptureFlow('magic')}
                  disabled={!canSave || isCaptureMagicRunning || !onRunCaptureFlow}
                  className="flex items-center justify-center gap-2 rounded-lg border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCaptureMagicRunning && activeCaptureMagicState?.mode === 'magic' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('recorder.postCapture.magicRunning')}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      {t('recorder.postCapture.magic')}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleRunCaptureFlow('raw')}
                  disabled={!canSave || isCaptureMagicRunning || !onRunCaptureFlow}
                  className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCaptureMagicRunning && activeCaptureMagicState?.mode === 'raw' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('recorder.postCapture.rawRunning')}
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4" />
                      {t('recorder.postCapture.raw')}
                    </>
                  )}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowManualPostCaptureTools((value) => !value)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
                >
                  {showManualPostCaptureTools ? t('recorder.postCapture.hideManual') : t('recorder.postCapture.showManual')}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/notes')}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
                >
                  {t('recorder.postCapture.openArchive')}
                </button>
              </div>

              {activeCaptureMagicState?.progress && (
                <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                  <div className="flex items-center gap-2 font-medium">
                    <Loader2 className={`h-4 w-4 ${isCaptureMagicRunning ? 'animate-spin' : ''}`} />
                    {activeCaptureMagicState.progress.label}
                  </div>
                  {typeof activeCaptureMagicState.progress.current === 'number'
                    && typeof activeCaptureMagicState.progress.total === 'number' && (
                    <p className="mt-1 text-sky-800">
                      {t('recorder.postCapture.progressCount', {
                        current: activeCaptureMagicState.progress.current,
                        total: activeCaptureMagicState.progress.total,
                      })}
                    </p>
                  )}
                </div>
              )}

              {captureMagicFailure && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {captureMagicFailure}
                </div>
              )}

              {captureMagicResult && (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
                  <p className="font-medium">
                    {captureMagicResult.mode === 'magic' ? t('recorder.postCapture.success.magic') : t('recorder.postCapture.success.raw')}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-emerald-700">{t('recorder.postCapture.metric.notes')}</p>
                      <p className="mt-1 text-lg font-semibold">{captureMagicResult.createdNotesCount}</p>
                      <p className="text-[11px] text-emerald-700">{t('recorder.postCapture.metric.notesHelp')}</p>
                    </div>
                    <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-emerald-700">{t('recorder.postCapture.metric.groups')}</p>
                      <p className="mt-1 text-lg font-semibold">{captureMagicResult.groupedIdeas.length}</p>
                      <p className="text-[11px] text-emerald-700">{t('recorder.postCapture.metric.groupsHelp')}</p>
                    </div>
                    <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-emerald-700">{t('recorder.postCapture.metric.chunks')}</p>
                      <p className="mt-1 text-lg font-semibold">{captureMagicResult.chunks.length}</p>
                      <p className="text-[11px] text-emerald-700">
                        {captureMagicResult.singlePass ? t('recorder.postCapture.metric.chunksSingle') : t('recorder.postCapture.metric.chunksMulti')}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-emerald-800">
                    {captureMagicResult.existingNotesCount > 0 && (
                      <p>{t('recorder.postCapture.reusedNotes', { count: captureMagicResult.existingNotesCount })}</p>
                    )}
                    {captureMagicResult.fallbackChunkCount > 0 && (
                      <p>{t('recorder.postCapture.fallbackChunks', { count: captureMagicResult.fallbackChunkCount })}</p>
                    )}
                    {captureMagicResult.skippedChunks.length > 0 && (
                      <p>{t('recorder.postCapture.skippedChunks', { count: captureMagicResult.skippedChunks.length })}</p>
                    )}
                    {captureMagicResult.failedChunks.length > 0 && (
                      <p>{t('recorder.postCapture.failedChunks', { count: captureMagicResult.failedChunks.length })}</p>
                    )}
                    {captureMagicResult.groupingError && (
                      <p>{t('recorder.postCapture.groupingError', { error: captureMagicResult.groupingError })}</p>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => navigate('/notes')}
                      className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100"
                    >
                      {t('recorder.postCapture.openNotes')}
                    </button>
                    {captureMagicResult.groupedIdeas.length > 0 && (
                      <button
                        type="button"
                        onClick={() => navigate(`/organized?idea=${encodeURIComponent(captureMagicResult.groupedIdeas[0].id)}`)}
                        className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100"
                      >
                        {t('recorder.postCapture.openGrouping')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {savedSession && showAdvancedSegmentationControls && showManualPostCaptureTools && (
            <VoiceSegmentationSettings
              settings={segmentationSettings}
              disabled={isSegmentingSession}
              onChange={updateSegmentationSetting}
              onReset={resetSegmentationSettings}
            />
          )}

          {savedSession && showManualPostCaptureTools && (
            <div className="w-full rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{t('recorder.manualPath.title')}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {t('recorder.manualPath.description')}
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
                  {isSegmentingSession ? t('recorder.manualPath.segmenting') : t('recorder.manualPath.segmentNow')}
                </button>
              </div>

              {segmentationResult && (
                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                  <p className="font-medium">
                    {t('recorder.manualPath.chunkCount', { count: segmentationResult.chunks.length })}
                  </p>
                  <p className="mt-2 text-blue-800">
                    {t('recorder.manualPath.chunkHelp')}
                  </p>
                  <div className="mt-3 space-y-2">
                    {segmentationResult.chunks.map((chunk, index) => (
                      <div key={chunk.id} className="rounded-lg border border-blue-100 bg-white p-2">
                        <p className="font-medium">{t('recorder.manualPath.chunkLabel', { index: index + 1 })}</p>
                        <p className="mt-1 text-[11px] text-blue-800">
                          {Math.round(chunk.startMs / 1000)}s - {Math.round(chunk.endMs / 1000)}s · {Math.max(1, Math.round(chunk.durationMs / 1000))}s · {humanizeSegmentationReason(chunk.segmentationReason, t)}
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
                ? t('recorder.error.transcription')
                : isSafeMode
                  ? t('recorder.error.safeCapture')
                  : t('recorder.error.continuous')
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
                  {t('recorder.retryTranscription')}
                </button>
                <button
                  type="button"
                  onClick={resetRecording}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
                >
                  {t('recorder.clearAudio')}
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
            title={t('recorder.saveNoteError')}
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
            title={t('recorder.segmentSessionError')}
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
                    listening: t('recorder.transcriptLabel.listening'),
                    'segment-finalizing': t('recorder.transcriptLabel.finalizing'),
                    saving: t('recorder.transcriptLabel.saving'),
                    'restart-pending': t('recorder.transcriptLabel.restarting'),
                    starting: t('recorder.transcriptLabel.starting'),
                    error: t('recorder.transcriptLabel.error'),
                    idle: t('recorder.transcriptLabel.idle'),
                  }[continuousRuntimeState] ?? t('recorder.transcriptLabel.idle'))
                : t('recorder.transcriptLabel.default')}
            </label>
            {!isContinuousMode && (
              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className="text-xs text-primary hover:text-primary-dark"
              >
                {isEditing ? t('recorder.transcriptEditDone') : t('recorder.transcriptEdit')}
              </button>
            )}
          </div>
          {isEditing && !isContinuousMode ? (
            <textarea
              value={manualTranscript}
              onChange={(e) => setManualTranscript(e.target.value)}
              aria-label={t('recorder.transcriptEditAria')}
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
                {canSave ? t('recorder.saveNote') : t('recorder.limitReached')}
              </button>
              <button
                type="button"
                onClick={resetRecording}
                className="flex items-center justify-center gap-2 text-gray-500 hover:text-gray-700 py-2.5 px-4 rounded-lg text-sm border border-gray-200 hover:border-gray-300 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                {t('recorder.clear')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function humanizeSegmentationReason(
  reason: SegmentCaptureSessionResult['chunks'][number]['segmentationReason'],
  t: (key: import('../lib/i18n').TranslationKey) => string,
) {
  return ({
    'strong-delimiter': t('recorder.segmentReason.strong'),
    'probable-silence': t('recorder.segmentReason.probable'),
    'structural-silence': t('recorder.segmentReason.structural'),
    'session-end': t('recorder.segmentReason.sessionEnd'),
    'manual-stop': t('recorder.segmentReason.manualStop'),
    'single-pass': t('recorder.segmentReason.singlePass'),
    fallback: t('recorder.segmentReason.fallback'),
    unknown: t('recorder.segmentReason.unknown'),
  }[reason] ?? t('recorder.segmentReason.unknown'))
}
