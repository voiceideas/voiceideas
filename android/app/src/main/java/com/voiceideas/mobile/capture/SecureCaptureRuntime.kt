package com.voiceideas.mobile.capture

import android.os.SystemClock
import com.getcapacitor.JSObject
import java.util.concurrent.ConcurrentHashMap

enum class SecureCaptureState(val value: String) {
    IDLE("idle"),
    STARTING("starting"),
    RECORDING("recording"),
    STOPPING("stopping"),
    ERROR("error"),
}

data class SecureCaptureStatusSnapshot(
    val state: SecureCaptureState = SecureCaptureState.IDLE,
    val sessionId: String? = null,
    val mode: String? = null,
    val startedAt: String? = null,
    val startedElapsedRealtime: Long? = null,
    val elapsedMsSnapshot: Long? = null,
    val error: String? = null,
    val outputUri: String? = null,
    val mimeType: String? = null,
    val updatedAt: String? = null,
    val currentOutput: String? = null,
    val chunkCount: Int? = null,
    val provisionalFolderName: String? = null,
    val userId: String? = null,
    val platformSource: String? = null,
) {
    fun resolvedElapsedMs(): Long? {
        if (state == SecureCaptureState.STARTING || state == SecureCaptureState.RECORDING || state == SecureCaptureState.STOPPING) {
            val startedAtElapsed = startedElapsedRealtime ?: return elapsedMsSnapshot
            return (SystemClock.elapsedRealtime() - startedAtElapsed).coerceAtLeast(0L)
        }

        return elapsedMsSnapshot
    }

    fun toJsObject(): JSObject {
        val result = JSObject()
        result.put("state", state.value)
        sessionId?.let { result.put("sessionId", it) }
        mode?.let { result.put("mode", it) }
        startedAt?.let { result.put("startedAt", it) }
        resolvedElapsedMs()?.let { result.put("elapsedMs", it) }
        error?.let { result.put("error", it) }
        outputUri?.let { result.put("outputUri", it) }
        mimeType?.let { result.put("mimeType", it) }
        updatedAt?.let { result.put("updatedAt", it) }
        currentOutput?.let { result.put("currentOutput", it) }
        chunkCount?.let { result.put("chunkCount", it) }
        provisionalFolderName?.let { result.put("provisionalFolderName", it) }
        userId?.let { result.put("userId", it) }
        platformSource?.let { result.put("platformSource", it) }
        return result
    }
}

object SecureCaptureRuntime {
    private val listeners = ConcurrentHashMap<String, (SecureCaptureStatusSnapshot) -> Unit>()

    @Volatile
    private var currentStatus = SecureCaptureStatusSnapshot()

    fun getStatus(): SecureCaptureStatusSnapshot = currentStatus.copy(
        elapsedMsSnapshot = currentStatus.resolvedElapsedMs(),
    )

    fun addListener(key: String, listener: (SecureCaptureStatusSnapshot) -> Unit) {
        listeners[key] = listener
    }

    fun removeListener(key: String) {
        listeners.remove(key)
    }

    @Synchronized
    fun updateStatus(status: SecureCaptureStatusSnapshot): SecureCaptureStatusSnapshot {
        currentStatus = status
        val snapshot = getStatus()
        listeners.values.forEach { listener ->
            listener(snapshot)
        }
        return snapshot
    }

    @Synchronized
    fun reset() {
        updateStatus(SecureCaptureStatusSnapshot())
    }
}
