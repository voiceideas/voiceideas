package com.voiceideas.mobile.capture

import android.content.Context
import android.net.Uri
import java.io.File
import java.time.Duration
import java.time.Instant
import java.util.Locale
import org.json.JSONObject

class CaptureSessionRepository(private val context: Context) {
    private val rootDirectory = File(context.filesDir, ROOT_DIRECTORY_NAME).apply { mkdirs() }
    private val activeSessionPointer = File(rootDirectory, ACTIVE_SESSION_POINTER_NAME)

    @Synchronized
    fun createSession(request: CaptureSessionStartRequest): CaptureSessionManifest {
        markInterruptedIfActive(
            "A captura Android anterior foi interrompida antes de iniciar uma nova sessao.",
        )

        clearSessionDirectory(request.sessionId)
        ensureSessionDirectory(request.sessionId)

        val manifest = CaptureSessionManifest(
            sessionId = request.sessionId,
            mode = request.mode,
            state = SecureCaptureState.STARTING.value,
            startedAt = request.startedAt,
            updatedAt = request.startedAt,
            elapsedMs = 0L,
            userId = request.userId,
            provisionalFolderName = request.provisionalFolderName,
            platformSource = request.platformSource,
        )

        writeManifest(manifest)
        activeSessionPointer.writeText(request.sessionId)
        return manifest
    }

    @Synchronized
    fun loadManifest(sessionId: String): CaptureSessionManifest? {
        val manifestFile = manifestFile(sessionId)
        if (!manifestFile.exists()) {
            return null
        }

        return CaptureSessionManifest.fromJson(JSONObject(manifestFile.readText()))
    }

    @Synchronized
    fun loadActiveManifest(): CaptureSessionManifest? {
        val activeSessionId = readActiveSessionId() ?: return null
        return loadManifest(activeSessionId)
    }

    @Synchronized
    fun markRecording(
        sessionId: String,
        currentOutputFile: File,
        chunkIndex: Int,
        chunkStartedAt: String,
        elapsedMs: Long,
    ): CaptureSessionManifest {
        return updateManifest(sessionId) { current ->
            current.copy(
                state = SecureCaptureState.RECORDING.value,
                updatedAt = timestampNow(),
                elapsedMs = elapsedMs,
                currentOutput = currentOutputFile.absolutePath,
                currentChunkIndex = chunkIndex,
                currentChunkStartedAt = chunkStartedAt,
                error = null,
            )
        }
    }

    @Synchronized
    fun updateRecordingProgress(
        sessionId: String,
        currentOutputFile: File,
        chunkIndex: Int,
        elapsedMs: Long,
    ): CaptureSessionManifest {
        return updateManifest(sessionId) { current ->
            current.copy(
                updatedAt = timestampNow(),
                elapsedMs = elapsedMs,
                currentOutput = currentOutputFile.absolutePath,
                currentChunkIndex = chunkIndex,
            )
        }
    }

    @Synchronized
    fun appendClosedChunk(
        sessionId: String,
        chunk: CaptureChunkManifest,
        elapsedMs: Long,
    ): CaptureSessionManifest {
        return updateManifest(sessionId) { current ->
            current.copy(
                updatedAt = timestampNow(),
                elapsedMs = elapsedMs,
                currentOutput = null,
                currentChunkStartedAt = null,
                chunks = current.chunks + chunk,
            )
        }
    }

    @Synchronized
    fun markStopping(sessionId: String, elapsedMs: Long): CaptureSessionManifest {
        return updateManifest(sessionId) { current ->
            current.copy(
                state = SecureCaptureState.STOPPING.value,
                updatedAt = timestampNow(),
                elapsedMs = elapsedMs,
            )
        }
    }

    @Synchronized
    fun markIdle(
        sessionId: String,
        elapsedMs: Long,
        mergedOutputFile: File?,
    ): CaptureSessionManifest {
        val updated = updateManifest(sessionId) { current ->
            current.copy(
                state = SecureCaptureState.IDLE.value,
                updatedAt = timestampNow(),
                elapsedMs = elapsedMs,
                currentOutput = null,
                mergedOutput = mergedOutputFile?.absolutePath,
                currentChunkStartedAt = null,
                error = null,
            )
        }

        clearActiveSessionPointer(sessionId)
        return updated
    }

    @Synchronized
    fun markError(
        sessionId: String,
        elapsedMs: Long,
        message: String,
    ): CaptureSessionManifest {
        val updated = updateManifest(sessionId) { current ->
            current.copy(
                state = SecureCaptureState.ERROR.value,
                updatedAt = timestampNow(),
                elapsedMs = elapsedMs,
                currentOutput = null,
                currentChunkStartedAt = null,
                error = message,
            )
        }

        clearActiveSessionPointer(sessionId)
        return updated
    }

    @Synchronized
    fun markInterruptedIfActive(message: String): CaptureSessionManifest? {
        val activeManifest = loadActiveManifest() ?: return null

        if (!activeManifest.isActiveState()) {
            clearActiveSessionPointer(activeManifest.sessionId)
            return activeManifest
        }

        val updated = activeManifest.copy(
            state = SecureCaptureState.ERROR.value,
            updatedAt = timestampNow(),
            elapsedMs = computePersistedElapsedMs(activeManifest),
            currentOutput = null,
            currentChunkStartedAt = null,
            error = message,
        )

        writeManifest(updated)
        clearActiveSessionPointer(updated.sessionId)
        return updated
    }

    @Synchronized
    fun resolveStatus(runtimeStatus: SecureCaptureStatusSnapshot): SecureCaptureStatusSnapshot {
        if (runtimeStatus.state == SecureCaptureState.STARTING
            || runtimeStatus.state == SecureCaptureState.RECORDING
            || runtimeStatus.state == SecureCaptureState.STOPPING
        ) {
            return runtimeStatus
        }

        val activeManifest = loadActiveManifest() ?: return runtimeStatus
        val reconciledManifest = if (activeManifest.isActiveState()) {
            markInterruptedIfActive(
                "A captura Android foi interrompida antes de o app retomar a sessao.",
            ) ?: activeManifest
        } else {
            activeManifest
        }

        return toStatusSnapshot(reconciledManifest)
    }

    @Synchronized
    fun toStatusSnapshot(
        manifest: CaptureSessionManifest,
        startedElapsedRealtime: Long? = null,
    ): SecureCaptureStatusSnapshot {
        val outputPath = manifest.mergedOutput ?: manifest.currentOutput

        return SecureCaptureStatusSnapshot(
            state = manifest.toSecureCaptureState(),
            sessionId = manifest.sessionId,
            mode = manifest.mode,
            startedAt = manifest.startedAt,
            startedElapsedRealtime = startedElapsedRealtime,
            elapsedMsSnapshot = computePersistedElapsedMs(manifest),
            error = manifest.error,
            outputUri = outputPath?.let(::filePathToUriString),
            mimeType = inferMimeType(outputPath),
            updatedAt = manifest.updatedAt,
            currentOutput = manifest.currentOutput?.let(::filePathToUriString),
            chunkCount = manifest.chunks.size,
            provisionalFolderName = manifest.provisionalFolderName,
            userId = manifest.userId,
            platformSource = manifest.platformSource,
        )
    }

    fun getChunkFile(sessionId: String, index: Int): File {
        ensureSessionDirectory(sessionId)
        return File(sessionDirectory(sessionId), "chunk-${index.toString().padStart(6, '0')}.wav")
    }

    fun getMergedOutputFile(sessionId: String): File {
        ensureSessionDirectory(sessionId)
        return File(sessionDirectory(sessionId), MERGED_OUTPUT_NAME)
    }

    fun listChunkFiles(sessionId: String): List<File> {
        val manifest = loadManifest(sessionId) ?: return emptyList()
        return manifest.chunks.map { File(it.path) }.filter(File::exists)
    }

    private fun sessionDirectory(sessionId: String): File = File(rootDirectory, sessionId)

    private fun manifestFile(sessionId: String): File = File(sessionDirectory(sessionId), MANIFEST_FILE_NAME)

    private fun ensureSessionDirectory(sessionId: String) {
        val directory = sessionDirectory(sessionId)
        if (!directory.exists()) {
            directory.mkdirs()
        }
    }

    private fun clearSessionDirectory(sessionId: String) {
        val directory = sessionDirectory(sessionId)
        if (directory.exists()) {
            directory.deleteRecursively()
        }
    }

    private fun readActiveSessionId(): String? {
        if (!activeSessionPointer.exists()) {
            return null
        }

        return activeSessionPointer.readText().trim().takeIf { it.isNotBlank() }
    }

    private fun clearActiveSessionPointer(sessionId: String? = null) {
        if (!activeSessionPointer.exists()) {
            return
        }

        val currentSessionId = activeSessionPointer.readText().trim()
        if (sessionId == null || currentSessionId == sessionId) {
            activeSessionPointer.delete()
        }
    }

    private fun updateManifest(
        sessionId: String,
        transform: (CaptureSessionManifest) -> CaptureSessionManifest,
    ): CaptureSessionManifest {
        val current = loadManifest(sessionId)
            ?: throw IllegalStateException("Sessao Android de captura nao encontrada.")
        val updated = transform(current)
        writeManifest(updated)
        return updated
    }

    private fun writeManifest(manifest: CaptureSessionManifest) {
        ensureSessionDirectory(manifest.sessionId)
        manifestFile(manifest.sessionId).writeText(manifest.toJson().toString(2))
    }

    private fun computePersistedElapsedMs(manifest: CaptureSessionManifest): Long {
        val persistedElapsed = manifest.elapsedMs.coerceAtLeast(0L)
        val startedAt = parseInstant(manifest.startedAt) ?: return persistedElapsed
        val updatedAt = parseInstant(manifest.updatedAt) ?: return persistedElapsed
        val timeBetween = Duration.between(startedAt, updatedAt).toMillis().coerceAtLeast(0L)
        return maxOf(persistedElapsed, timeBetween)
    }

    private fun parseInstant(value: String?): Instant? {
        if (value.isNullOrBlank()) {
            return null
        }

        return try {
            Instant.parse(value)
        } catch (_: Exception) {
            null
        }
    }

    private fun timestampNow(): String = Instant.now().toString()

    private fun inferMimeType(path: String?): String? {
        if (path.isNullOrBlank()) {
            return null
        }

        val lowerPath = path.lowercase(Locale.US)
        return when {
            lowerPath.endsWith(".wav") -> "audio/wav"
            lowerPath.endsWith(".m4a") || lowerPath.endsWith(".mp4") -> "audio/mp4"
            else -> null
        }
    }

    private fun filePathToUriString(path: String): String {
        return Uri.fromFile(File(path)).toString()
    }

    companion object {
        private const val ROOT_DIRECTORY_NAME = "secure-capture"
        private const val ACTIVE_SESSION_POINTER_NAME = "active-session.txt"
        private const val MANIFEST_FILE_NAME = "manifest.json"
        private const val MERGED_OUTPUT_NAME = "capture-full.wav"
    }
}

private fun CaptureSessionManifest.toSecureCaptureState(): SecureCaptureState {
    return when (state) {
        SecureCaptureState.STARTING.value -> SecureCaptureState.STARTING
        SecureCaptureState.RECORDING.value -> SecureCaptureState.RECORDING
        SecureCaptureState.STOPPING.value -> SecureCaptureState.STOPPING
        SecureCaptureState.ERROR.value -> SecureCaptureState.ERROR
        else -> SecureCaptureState.IDLE
    }
}
