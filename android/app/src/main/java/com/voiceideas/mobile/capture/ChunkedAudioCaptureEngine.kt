package com.voiceideas.mobile.capture

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import java.io.File
import java.time.Instant

class ChunkedAudioCaptureEngine(
    private val repository: CaptureSessionRepository,
    private val manifest: CaptureSessionManifest,
    private val onStatusChanged: (SecureCaptureStatusSnapshot) -> Unit,
    private val onFatalError: (String) -> Unit,
) {
    private var audioRecord: AudioRecord? = null
    private var captureThread: Thread? = null
    private var currentWriter: WavChunkWriter? = null
    private var currentChunkFile: File? = null
    private var currentChunkIndex = manifest.currentChunkIndex
    private var currentChunkStartedAt: String? = manifest.currentChunkStartedAt
    private var currentChunkBytesWritten = 0L
    private var sessionStartedElapsedRealtime = 0L
    private var lastPersistElapsedRealtime = 0L

    @Volatile
    private var isCapturing = false

    fun start() {
        if (isCapturing) {
            return
        }

        val minBufferSize = AudioRecord.getMinBufferSize(
            DEFAULT_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )

        if (minBufferSize <= 0) {
            throw IllegalStateException("Nao foi possivel inicializar o buffer de audio do Android.")
        }

        val recorder = AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.MIC)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(DEFAULT_SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                    .build(),
            )
            .setBufferSizeInBytes(maxOf(minBufferSize * 2, MIN_BUFFER_SIZE_BYTES))
            .build()

        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            throw IllegalStateException("Nao foi possivel inicializar a captura nativa do Android.")
        }

        sessionStartedElapsedRealtime = SystemClock.elapsedRealtime() - manifest.elapsedMs.coerceAtLeast(0L)
        audioRecord = recorder
        isCapturing = true
        openNextChunkWriter()
        recorder.startRecording()

        val bufferSize = maxOf(minBufferSize, MIN_BUFFER_SIZE_BYTES)
        captureThread = Thread {
            runCaptureLoop(recorder, bufferSize)
        }.apply {
            name = "voiceideas-secure-capture"
            start()
        }
    }

    fun stop(): SecureCaptureStatusSnapshot {
        isCapturing = false

        try {
            audioRecord?.stop()
        } catch (_: IllegalStateException) {
            // Ignore invalid stop during shutdown.
        }

        captureThread?.join(2_000L)
        captureThread = null

        releaseAudioRecord()
        finalizeCurrentChunk()

        val chunkFiles = repository.listChunkFiles(manifest.sessionId)
        val mergedOutputFile = if (chunkFiles.isNotEmpty()) {
            repository.getMergedOutputFile(manifest.sessionId).also { outputFile ->
                WavChunkWriter.merge(
                    outputFile = outputFile,
                    chunkFiles = chunkFiles,
                    sampleRate = DEFAULT_SAMPLE_RATE,
                    channelCount = CHANNEL_COUNT,
                    bitsPerSample = BITS_PER_SAMPLE,
                )
            }
        } else {
            null
        }

        val updatedManifest = repository.markIdle(
            sessionId = manifest.sessionId,
            elapsedMs = currentElapsedMs(),
            mergedOutputFile = mergedOutputFile,
        )
        val status = repository.toStatusSnapshot(updatedManifest)
        onStatusChanged(status)
        return status
    }

    fun fail(message: String): SecureCaptureStatusSnapshot {
        isCapturing = false

        try {
            audioRecord?.stop()
        } catch (_: IllegalStateException) {
            // Ignore invalid stop during failure cleanup.
        }

        captureThread?.join(1_000L)
        captureThread = null
        releaseAudioRecord()
        finalizeCurrentChunk()

        val updatedManifest = repository.markError(
            sessionId = manifest.sessionId,
            elapsedMs = currentElapsedMs(),
            message = message,
        )
        val status = repository.toStatusSnapshot(updatedManifest)
        onStatusChanged(status)
        return status
    }

    fun currentElapsedMs(): Long {
        return (SystemClock.elapsedRealtime() - sessionStartedElapsedRealtime).coerceAtLeast(0L)
    }

    private fun runCaptureLoop(recorder: AudioRecord, bufferSize: Int) {
        val buffer = ByteArray(bufferSize)

        try {
            while (isCapturing) {
                val bytesRead = try {
                    recorder.read(buffer, 0, buffer.size)
                } catch (readError: Exception) {
                    if (!isCapturing) {
                        break
                    }
                    throw readError
                }

                when {
                    bytesRead > 0 -> {
                        currentWriter?.write(buffer, bytesRead)
                        currentChunkBytesWritten += bytesRead.toLong()
                        maybePersistProgress()

                        if (currentChunkBytesWritten >= BYTES_PER_CHUNK) {
                            rotateChunk()
                        }
                    }
                    bytesRead == 0 -> continue
                    !isCapturing -> break
                    else -> throw IllegalStateException("AudioRecord retornou erro $bytesRead.")
                }
            }
        } catch (captureError: Exception) {
            if (isCapturing) {
                onFatalError(captureError.message ?: "A captura nativa Android encontrou um erro.")
            }
        }
    }

    private fun rotateChunk() {
        finalizeCurrentChunk()
        openNextChunkWriter()
    }

    private fun openNextChunkWriter() {
        currentChunkIndex += 1
        currentChunkStartedAt = Instant.now().toString()
        currentChunkBytesWritten = 0L
        lastPersistElapsedRealtime = 0L

        val chunkFile = repository.getChunkFile(manifest.sessionId, currentChunkIndex)
        currentChunkFile = chunkFile
        currentWriter = WavChunkWriter(
            file = chunkFile,
            sampleRate = DEFAULT_SAMPLE_RATE,
            channelCount = CHANNEL_COUNT,
            bitsPerSample = BITS_PER_SAMPLE,
        )

        val updatedManifest = repository.markRecording(
            sessionId = manifest.sessionId,
            currentOutputFile = chunkFile,
            chunkIndex = currentChunkIndex,
            chunkStartedAt = currentChunkStartedAt ?: Instant.now().toString(),
            elapsedMs = currentElapsedMs(),
        )
        onStatusChanged(repository.toStatusSnapshot(updatedManifest, sessionStartedElapsedRealtime))
    }

    private fun finalizeCurrentChunk() {
        val writer = currentWriter ?: return
        val chunkFile = currentChunkFile ?: return
        val startedAt = currentChunkStartedAt ?: Instant.now().toString()
        val endedAt = Instant.now().toString()
        val bytesWritten = writer.close()
        val durationMs = pcmBytesToDurationMs(bytesWritten)

        currentWriter = null
        currentChunkFile = null
        currentChunkStartedAt = null
        currentChunkBytesWritten = 0L

        if (bytesWritten <= 0L) {
            chunkFile.delete()
            return
        }

        val updatedManifest = repository.appendClosedChunk(
            sessionId = manifest.sessionId,
            chunk = CaptureChunkManifest(
                index = currentChunkIndex,
                path = chunkFile.absolutePath,
                startedAt = startedAt,
                endedAt = endedAt,
                durationMs = durationMs,
            ),
            elapsedMs = currentElapsedMs(),
        )
        onStatusChanged(repository.toStatusSnapshot(updatedManifest, sessionStartedElapsedRealtime))
    }

    private fun maybePersistProgress() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastPersistElapsedRealtime < PROGRESS_PERSIST_INTERVAL_MS) {
            return
        }

        val chunkFile = currentChunkFile ?: return
        lastPersistElapsedRealtime = now

        val updatedManifest = repository.updateRecordingProgress(
            sessionId = manifest.sessionId,
            currentOutputFile = chunkFile,
            chunkIndex = currentChunkIndex,
            elapsedMs = currentElapsedMs(),
        )
        onStatusChanged(repository.toStatusSnapshot(updatedManifest, sessionStartedElapsedRealtime))
    }

    private fun pcmBytesToDurationMs(bytes: Long): Long {
        if (bytes <= 0L) {
            return 0L
        }

        val bytesPerSecond = DEFAULT_SAMPLE_RATE * CHANNEL_COUNT * (BITS_PER_SAMPLE / 8)
        return (bytes * 1_000L) / bytesPerSecond
    }

    private fun releaseAudioRecord() {
        audioRecord?.release()
        audioRecord = null
    }

    companion object {
        private const val DEFAULT_SAMPLE_RATE = 16_000
        private const val CHANNEL_COUNT = 1
        private const val BITS_PER_SAMPLE = 16
        private const val DEFAULT_CHUNK_DURATION_MS = 30_000L
        private const val PROGRESS_PERSIST_INTERVAL_MS = 5_000L
        private const val MIN_BUFFER_SIZE_BYTES = 8_192
        private const val BYTES_PER_CHUNK =
            (DEFAULT_SAMPLE_RATE * CHANNEL_COUNT * (BITS_PER_SAMPLE / 8)) * (DEFAULT_CHUNK_DURATION_MS / 1_000L)
    }
}
