package com.voiceideas.mobile.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.voiceideas.mobile.R
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

class CaptureForegroundService : Service() {
    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var activeSessionId: String? = null

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startCaptureForeground()

        when (intent?.action) {
            ACTION_STOP -> handleStop()
            ACTION_START -> handleStart(intent)
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        if (recorder != null) {
            SecureCaptureRuntime.markError("A captura Android foi encerrada antes de finalizar.")
        }
        releaseRecorder()
        super.onDestroy()
    }

    private fun handleStart(intent: Intent) {
        val status = SecureCaptureRuntime.getStatus()
        if (status.state == SecureCaptureState.RECORDING || status.state == SecureCaptureState.STARTING) {
            updateNotification(SecureCaptureRuntime.getStatus())
            return
        }

        val mode = intent.getStringExtra(EXTRA_MODE) ?: DEFAULT_MODE
        val sessionId = UUID.randomUUID().toString()
        val startedAt = isoTimestampNow()
        activeSessionId = sessionId
        SecureCaptureRuntime.markStarting(sessionId, mode, startedAt)
        updateNotification(SecureCaptureRuntime.getStatus())

        try {
            val targetFile = createOutputFile(sessionId)
            startRecorder(targetFile)
            outputFile = targetFile
            SecureCaptureRuntime.markRecording(targetFile.toUriString(), MIME_TYPE_M4A)
            updateNotification(SecureCaptureRuntime.getStatus())
        } catch (error: Exception) {
            releaseRecorder()
            outputFile = null
            activeSessionId = null
            SecureCaptureRuntime.markError(error.message ?: "Nao foi possivel iniciar a captura Android.")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun handleStop() {
        val activeRecorder = recorder
        if (activeRecorder == null) {
            SecureCaptureRuntime.markIdle(
                outputUri = outputFile?.toUriString(),
                mimeType = MIME_TYPE_M4A,
            )
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }

        SecureCaptureRuntime.markStopping()
        updateNotification(SecureCaptureRuntime.getStatus())

        try {
            activeRecorder.stop()
            val finalFile = outputFile
            SecureCaptureRuntime.markIdle(
                outputUri = finalFile?.toUriString(),
                mimeType = MIME_TYPE_M4A,
            )
        } catch (_: RuntimeException) {
            outputFile?.delete()
            outputFile = null
            SecureCaptureRuntime.markError("A captura Android falhou ao finalizar o arquivo.")
        } finally {
            releaseRecorder()
            activeSessionId = null
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    @Suppress("DEPRECATION")
    private fun startRecorder(file: File) {
        val mediaRecorder = MediaRecorder()
        mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC)
        mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        mediaRecorder.setAudioSamplingRate(16_000)
        mediaRecorder.setAudioEncodingBitRate(64_000)
        mediaRecorder.setOutputFile(file.absolutePath)
        mediaRecorder.prepare()
        mediaRecorder.start()
        recorder = mediaRecorder
    }

    private fun releaseRecorder() {
        recorder?.apply {
            reset()
            release()
        }
        recorder = null
    }

    private fun createOutputFile(sessionId: String): File {
        val sessionDirectory = File(filesDir, "secure-capture/$sessionId")
        if (!sessionDirectory.exists() && !sessionDirectory.mkdirs()) {
            throw IllegalStateException("Nao foi possivel preparar o armazenamento local da captura.")
        }

        return File(sessionDirectory, "capture.m4a")
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

    private fun isoTimestampNow(): String {
        val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        formatter.timeZone = TimeZone.getTimeZone("UTC")
        return formatter.format(Date())
    }

    private fun File.toUriString(): String = android.net.Uri.fromFile(this).toString()

    companion object {
        const val ACTION_START = "com.voiceideas.mobile.capture.ACTION_START"
        const val ACTION_STOP = "com.voiceideas.mobile.capture.ACTION_STOP"
        const val EXTRA_MODE = "mode"
        const val DEFAULT_MODE = "safe"
        const val MIME_TYPE_M4A = "audio/mp4"
        private const val NOTIFICATION_CHANNEL_ID = "voiceideas.secure-capture"
        private const val NOTIFICATION_ID = 4101
    }
}
