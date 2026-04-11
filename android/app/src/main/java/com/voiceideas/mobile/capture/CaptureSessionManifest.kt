package com.voiceideas.mobile.capture

import org.json.JSONArray
import org.json.JSONObject

data class CaptureChunkManifest(
    val index: Int,
    val path: String,
    val startedAt: String,
    val endedAt: String?,
    val durationMs: Long,
) {
    fun toJson(): JSONObject {
        return JSONObject().apply {
            put("index", index)
            put("path", path)
            put("startedAt", startedAt)
            put("endedAt", endedAt)
            put("durationMs", durationMs)
        }
    }

    companion object {
        fun fromJson(json: JSONObject): CaptureChunkManifest {
            return CaptureChunkManifest(
                index = json.optInt("index"),
                path = json.optString("path"),
                startedAt = json.optString("startedAt"),
                endedAt = json.optNullableString("endedAt"),
                durationMs = json.optLong("durationMs"),
            )
        }
    }
}

data class CaptureSessionStartRequest(
    val sessionId: String,
    val mode: String,
    val startedAt: String,
    val userId: String? = null,
    val provisionalFolderName: String? = null,
    val platformSource: String? = null,
)

data class CaptureSessionManifest(
    val sessionId: String,
    val mode: String,
    val state: String,
    val startedAt: String,
    val updatedAt: String,
    val elapsedMs: Long,
    val currentOutput: String? = null,
    val mergedOutput: String? = null,
    val currentChunkIndex: Int = 0,
    val currentChunkStartedAt: String? = null,
    val userId: String? = null,
    val provisionalFolderName: String? = null,
    val platformSource: String? = null,
    val error: String? = null,
    val chunks: List<CaptureChunkManifest> = emptyList(),
) {
    fun isActiveState(): Boolean {
        return state == SecureCaptureState.STARTING.value
            || state == SecureCaptureState.RECORDING.value
            || state == SecureCaptureState.STOPPING.value
    }

    fun toJson(): JSONObject {
        return JSONObject().apply {
            put("sessionId", sessionId)
            put("mode", mode)
            put("state", state)
            put("startedAt", startedAt)
            put("updatedAt", updatedAt)
            put("elapsedMs", elapsedMs)
            put("currentOutput", currentOutput)
            put("mergedOutput", mergedOutput)
            put("currentChunkIndex", currentChunkIndex)
            put("currentChunkStartedAt", currentChunkStartedAt)
            put("userId", userId)
            put("provisionalFolderName", provisionalFolderName)
            put("platformSource", platformSource)
            put("error", error)
            put(
                "chunks",
                JSONArray().apply {
                    chunks.forEach { put(it.toJson()) }
                },
            )
        }
    }

    companion object {
        fun fromJson(json: JSONObject): CaptureSessionManifest {
            val chunksJson = json.optJSONArray("chunks") ?: JSONArray()
            val chunks = buildList {
                for (index in 0 until chunksJson.length()) {
                    val chunkJson = chunksJson.optJSONObject(index) ?: continue
                    add(CaptureChunkManifest.fromJson(chunkJson))
                }
            }

            return CaptureSessionManifest(
                sessionId = json.optString("sessionId"),
                mode = json.optString("mode", CaptureForegroundService.DEFAULT_MODE),
                state = json.optString("state", SecureCaptureState.IDLE.value),
                startedAt = json.optString("startedAt"),
                updatedAt = json.optString("updatedAt"),
                elapsedMs = json.optLong("elapsedMs"),
                currentOutput = json.optNullableString("currentOutput"),
                mergedOutput = json.optNullableString("mergedOutput"),
                currentChunkIndex = json.optInt("currentChunkIndex"),
                currentChunkStartedAt = json.optNullableString("currentChunkStartedAt"),
                userId = json.optNullableString("userId"),
                provisionalFolderName = json.optNullableString("provisionalFolderName"),
                platformSource = json.optNullableString("platformSource"),
                error = json.optNullableString("error"),
                chunks = chunks,
            )
        }
    }
}

private fun JSONObject.optNullableString(key: String): String? {
    if (!has(key) || isNull(key)) {
        return null
    }

    return optString(key).takeIf { it.isNotBlank() }
}
