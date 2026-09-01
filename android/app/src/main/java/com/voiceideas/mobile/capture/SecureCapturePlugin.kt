package com.voiceideas.mobile.capture

import android.Manifest
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.UUID

@CapacitorPlugin(
    name = "SecureCapture",
    permissions = [
        Permission(
            alias = "microphone",
            strings = [Manifest.permission.RECORD_AUDIO],
        ),
    ],
)
class SecureCapturePlugin : Plugin() {
    private val runtimeListenerKey = "secure-capture-plugin-${UUID.randomUUID()}"

    // Lazy para NÃO instanciar o repositório dentro de load(): se a criação do
    // repositório (I/O em filesDir) ou o reconcile lançar, load() não pode
    // propagar — o Capacitor engole a exceção em catch amplo e marca o plugin
    // inteiro como UNIMPLEMENTED (bug real observado no device). Criado sob demanda.
    private val repository: CaptureSessionRepository by lazy {
        CaptureSessionRepository(context)
    }

    override fun load() {
        super.load()
        // load() NUNCA pode lançar: qualquer exceção aqui faz o Capacitor
        // (PluginHandle.load → loadInstance → instance.load(), catch amplo)
        // descartar o plugin como "not implemented". O pré-warm abaixo é
        // best-effort; falha é logada, não fatal.
        try {
            val initialStatus = repository.resolveStatus(SecureCaptureRuntime.getStatus())
            SecureCaptureRuntime.updateStatus(initialStatus)
        } catch (error: Throwable) {
            Log.e(TAG, "load() pre-warm (resolveStatus) falhou — nao fatal", error)
        }

        try {
            SecureCaptureRuntime.addListener(runtimeListenerKey) { status ->
                bridge?.executeOnMainThread {
                    notifyListeners(EVENT_NAME, createEventPayload(status))
                }
            }
        } catch (error: Throwable) {
            Log.e(TAG, "load() registro de listener falhou — nao fatal", error)
        }
    }

    override fun handleOnDestroy() {
        SecureCaptureRuntime.removeListener(runtimeListenerKey)
        super.handleOnDestroy()
    }

    @PluginMethod
    fun startCapture(call: PluginCall) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback")
            return
        }

        startCaptureInternal(call)
    }

    @PluginMethod
    fun stopCapture(call: PluginCall) {
        val stopIntent = Intent(context, CaptureForegroundService::class.java).apply {
            action = CaptureForegroundService.ACTION_STOP
        }

        context.startService(stopIntent)

        Thread {
            val status = waitForTerminalState(timeoutMs = 3_000L)
            bridge?.executeOnMainThread {
                call.resolve(status.toJsObject())
            }
        }.start()
    }

    @PluginMethod
    fun getCaptureStatus(call: PluginCall) {
        val resolvedStatus = repository.resolveStatus(SecureCaptureRuntime.getStatus())
        SecureCaptureRuntime.updateStatus(resolvedStatus)
        call.resolve(resolvedStatus.toJsObject())
    }

    @PluginMethod
    fun getCaptureDiagnostics(call: PluginCall) {
        val resolvedStatus = repository.resolveStatus(SecureCaptureRuntime.getStatus())
        SecureCaptureRuntime.updateStatus(resolvedStatus)

        val result = JSObject()
        result.put("status", resolvedStatus.toJsObject())
        result.put("diagnostics", repository.buildDiagnostics(call.getString("sessionId")))
        call.resolve(result)
    }

    @PermissionCallback
    private fun microphonePermissionCallback(call: PluginCall) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Permita o uso do microfone para iniciar a captura segura.")
            return
        }

        startCaptureInternal(call)
    }

    private fun startCaptureInternal(call: PluginCall) {
        val mode = call.getString("mode", CaptureForegroundService.DEFAULT_MODE) ?: CaptureForegroundService.DEFAULT_MODE
        val startIntent = Intent(context, CaptureForegroundService::class.java).apply {
            action = CaptureForegroundService.ACTION_START
            putExtra(CaptureForegroundService.EXTRA_MODE, mode)
            call.getString("sessionId")?.let { putExtra(CaptureForegroundService.EXTRA_SESSION_ID, it) }
            call.getString("startedAt")?.let { putExtra(CaptureForegroundService.EXTRA_STARTED_AT, it) }
            call.getString("userId")?.let { putExtra(CaptureForegroundService.EXTRA_USER_ID, it) }
            call.getString("provisionalFolderName")
                ?.let { putExtra(CaptureForegroundService.EXTRA_PROVISIONAL_FOLDER_NAME, it) }
            call.getString("platformSource")?.let { putExtra(CaptureForegroundService.EXTRA_PLATFORM_SOURCE, it) }
        }

        ContextCompat.startForegroundService(context, startIntent)

        Thread {
            val status = waitForStartState(timeoutMs = 2_000L)
            bridge?.executeOnMainThread {
                call.resolve(status.toJsObject())
            }
        }.start()
    }

    private fun waitForStartState(timeoutMs: Long): SecureCaptureStatusSnapshot {
        val deadline = System.currentTimeMillis() + timeoutMs

        while (System.currentTimeMillis() < deadline) {
            val status = repository.resolveStatus(SecureCaptureRuntime.getStatus())
            if (status.state == SecureCaptureState.RECORDING || status.state == SecureCaptureState.ERROR) {
                return status
            }

            Thread.sleep(POLL_INTERVAL_MS)
        }

        return repository.resolveStatus(SecureCaptureRuntime.getStatus())
    }

    private fun waitForTerminalState(timeoutMs: Long): SecureCaptureStatusSnapshot {
        val deadline = System.currentTimeMillis() + timeoutMs

        while (System.currentTimeMillis() < deadline) {
            val status = repository.resolveStatus(SecureCaptureRuntime.getStatus())
            if (status.state == SecureCaptureState.IDLE || status.state == SecureCaptureState.ERROR) {
                return status
            }

            Thread.sleep(POLL_INTERVAL_MS)
        }

        return repository.resolveStatus(SecureCaptureRuntime.getStatus())
    }

    private fun createEventPayload(status: SecureCaptureStatusSnapshot): JSObject {
        val result = JSObject()
        result.put("type", "statusChanged")
        result.put("status", status.toJsObject())
        return result
    }

    companion object {
        private const val TAG = "SecureCapture"
        private const val EVENT_NAME = "secureCaptureEvent"
        private const val POLL_INTERVAL_MS = 50L
    }
}
