package com.voiceideas.mobile.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.voiceideas.mobile.R
import java.time.Instant
import java.util.UUID

class CaptureForegroundService : Service() {
    private lateinit var repository: CaptureSessionRepository
    private var engine: ChunkedAudioCaptureEngine? = null
    private var activeSessionId: String? = null

    override fun onCreate() {
        super.onCreate()
        repository = CaptureSessionRepository(this)
        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startCaptureForeground()

        when (intent?.action) {
            ACTION_STOP -> handleStop()
            ACTION_START -> handleStart(intent)
            null -> {
                handleUnexpectedRestart()
                return START_NOT_STICKY
            }
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        if (engine != null) {
            handleFatalError("A captura Android foi encerrada antes de finalizar.")
        }
        super.onDestroy()
    }

    private fun handleStart(intent: Intent) {
        val runtimeStatus = SecureCaptureRuntime.getStatus()
        if (runtimeStatus.state == SecureCaptureState.RECORDING || runtimeStatus.state == SecureCaptureState.STARTING) {
            updateNotification(runtimeStatus)
            return
        }

        val sessionId = intent.getStringExtra(EXTRA_SESSION_ID) ?: UUID.randomUUID().toString()
        val startedAt = intent.getStringExtra(EXTRA_STARTED_AT) ?: Instant.now().toString()
        val mode = intent.getStringExtra(EXTRA_MODE) ?: DEFAULT_MODE

        val manifest = try {
            repository.createSession(
                CaptureSessionStartRequest(
                    sessionId = sessionId,
                    mode = mode,
                    startedAt = startedAt,
                    userId = intent.getStringExtra(EXTRA_USER_ID),
                    provisionalFolderName = intent.getStringExtra(EXTRA_PROVISIONAL_FOLDER_NAME),
                    platformSource = intent.getStringExtra(EXTRA_PLATFORM_SOURCE),
                ),
            )
        } catch (error: Exception) {
            SecureCaptureRuntime.updateStatus(
                SecureCaptureStatusSnapshot(
                    state = SecureCaptureState.ERROR,
                    sessionId = sessionId,
                    mode = mode,
                    startedAt = startedAt,
                    error = error.message ?: "Nao foi possivel preparar a captura Android.",
                ),
            )
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }

        activeSessionId = manifest.sessionId
        SecureCaptureRuntime.updateStatus(repository.toStatusSnapshot(manifest))
        updateNotification(SecureCaptureRuntime.getStatus())

        try {
            engine = ChunkedAudioCaptureEngine(
                repository = repository,
                manifest = manifest,
                onStatusChanged = { status ->
                    SecureCaptureRuntime.updateStatus(status)
                    updateNotification(status)
                },
                onFatalError = { message ->
                    handleFatalError(message)
                },
            ).also { it.start() }
        } catch (error: Exception) {
            handleFatalError(error.message ?: "Nao foi possivel iniciar a captura Android.")
        }
    }

    private fun handleStop() {
        val activeEngine = engine
        if (activeEngine == null) {
            val fallbackStatus = repository.resolveStatus(SecureCaptureRuntime.getStatus())
            SecureCaptureRuntime.updateStatus(fallbackStatus)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }

        val sessionId = activeSessionId
        if (sessionId != null) {
            val stoppingManifest = repository.markStopping(sessionId, activeEngine.currentElapsedMs())
            val stoppingStatus = repository.toStatusSnapshot(stoppingManifest)
            SecureCaptureRuntime.updateStatus(stoppingStatus)
            updateNotification(stoppingStatus)
        }

        val finalStatus = activeEngine.stop()
        SecureCaptureRuntime.updateStatus(finalStatus)
        updateNotification(finalStatus)
        engine = null
        activeSessionId = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun handleFatalError(message: String) {
        val activeEngine = engine
        val finalStatus = if (activeEngine != null) {
            activeEngine.fail(message)
        } else {
            val sessionId = activeSessionId
            if (sessionId != null) {
                val updatedManifest = repository.markError(sessionId, 0L, message)
                repository.toStatusSnapshot(updatedManifest)
            } else {
                SecureCaptureStatusSnapshot(
                    state = SecureCaptureState.ERROR,
                    error = message,
                )
            }
        }

        SecureCaptureRuntime.updateStatus(finalStatus)
        updateNotification(finalStatus)
        engine = null
        activeSessionId = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun handleUnexpectedRestart() {
        val interruptedManifest = repository.markInterruptedIfActive(
            "A captura Android foi interrompida depois que o processo foi encerrado.",
        )
        val status = interruptedManifest?.let { repository.toStatusSnapshot(it) }
            ?: SecureCaptureStatusSnapshot(state = SecureCaptureState.IDLE)

        SecureCaptureRuntime.updateStatus(status)
        updateNotification(status)
        engine = null
        activeSessionId = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startCaptureForeground() {
        val notification = buildNotification(SecureCaptureRuntime.getStatus())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(status: SecureCaptureStatusSnapshot) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(status))
    }

    private fun buildNotification(status: SecureCaptureStatusSnapshot): Notification {
        val contentText = when (status.state) {
            SecureCaptureState.STARTING -> "Preparando a captura segura"
            SecureCaptureState.RECORDING -> "Captura segura em andamento"
            SecureCaptureState.STOPPING -> "Finalizando a captura segura"
            SecureCaptureState.ERROR -> status.error ?: "A captura encontrou um erro"
            SecureCaptureState.IDLE -> "Base nativa pronta para a captura segura"
        }

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("VoiceIdeas esta gravando")
            .setContentText(contentText)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(status.state != SecureCaptureState.IDLE && status.state != SecureCaptureState.ERROR)
            .setSilent(true)
            .build()
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "Captura segura",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Mantem a captura segura do VoiceIdeas visivel enquanto o Android grava."
            setShowBadge(false)
        }

        manager.createNotificationChannel(channel)
    }

    companion object {
        const val ACTION_START = "com.voiceideas.mobile.capture.ACTION_START"
        const val ACTION_STOP = "com.voiceideas.mobile.capture.ACTION_STOP"
        const val EXTRA_MODE = "mode"
        const val EXTRA_SESSION_ID = "sessionId"
        const val EXTRA_STARTED_AT = "startedAt"
        const val EXTRA_USER_ID = "userId"
        const val EXTRA_PROVISIONAL_FOLDER_NAME = "provisionalFolderName"
        const val EXTRA_PLATFORM_SOURCE = "platformSource"
        const val DEFAULT_MODE = "safe"
        private const val NOTIFICATION_CHANNEL_ID = "voiceideas.secure-capture"
        private const val NOTIFICATION_ID = 4101
    }
}
