package com.perpetualrenewal.localtest

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class RecognizeArgs {
  var lang: String = "zh-CN"
}

/**
 * 设备自带语音识别（Android SpeechRecognizer）。
 *
 * WebView 不实现 Web Speech API 的 SpeechRecognition，Android 上只能走这条
 * 原生路径。SpeechRecognizer 的所有调用必须在主线程上创建与销毁；Tauri 的
 * @Command 方法本来就在主线程被调用，因此这里不要切换到后台线程。
 *
 * 识别结果只回传文字，音频不离开设备（由系统识别服务处理）。
 */
@TauriPlugin(permissions = [Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])])
class SpeechPlugin(private val hostActivity: Activity) : Plugin(hostActivity) {

  private var recognizer: SpeechRecognizer? = null
  private var pending: Invoke? = null
  private var settled = false

  override fun load(webView: WebView) {
    super.load(webView)
  }

  @Command
  fun isAvailable(invoke: Invoke) {
    val result = JSObject()
    result.put("available", SpeechRecognizer.isRecognitionAvailable(hostActivity))
    invoke.resolve(result)
  }

  @Command
  fun recognize(invoke: Invoke) {
    if (!SpeechRecognizer.isRecognitionAvailable(hostActivity)) {
      invoke.reject("这台设备没有可用的语音识别服务，可以改用文字输入。", "unavailable")
      return
    }

    if (getPermissionState("microphone") != PermissionState.GRANTED) {
      requestPermissionForAlias("microphone", invoke, "onPermissionResult")
      return
    }

    startRecognition(invoke)
  }

  @PermissionCallback
  fun onPermissionResult(invoke: Invoke) {
    if (getPermissionState("microphone") != PermissionState.GRANTED) {
      invoke.reject("没有拿到麦克风权限，可以开启权限后再试，或先用文字输入。", "not-allowed")
      return
    }
    startRecognition(invoke)
  }

  @Command
  fun cancel(invoke: Invoke) {
    discardPending("cancelled")
    invoke.resolve()
  }

  private fun startRecognition(invoke: Invoke) {
    // 上一次还没结束就丢弃，避免两个 invoke 抢同一个回调。
    discardPending("superseded")

    pending = invoke
    settled = false

    val created = SpeechRecognizer.createSpeechRecognizer(hostActivity)
    recognizer = created

    created.setRecognitionListener(object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) {}

      override fun onBeginningOfSpeech() {}

      override fun onRmsChanged(rmsdB: Float) {}

      override fun onBufferReceived(buffer: ByteArray?) {}

      override fun onEndOfSpeech() {}

      override fun onError(error: Int) {
        settleWithError(errorName(error), describeError(error))
      }

      override fun onResults(results: Bundle?) {
        val text = results
          ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
          ?.firstOrNull()
          ?.trim()
          .orEmpty()

        if (text.isEmpty()) {
          settleWithError("no-speech", "没有听到声音，可以再说一次，或改用文字输入。")
        } else {
          settleWithText(text)
        }
      }

      override fun onPartialResults(partialResults: Bundle?) {}

      override fun onEvent(eventType: Int, params: Bundle?) {}
    })

    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, readLanguage(invoke))
      // 一次性说完就返回，不做边说边出，避免和前端草稿逻辑重复。
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    }

    try {
      created.startListening(intent)
    } catch (error: Exception) {
      settleWithError("start-failed", "语音识别没有启动成功，请稍后再试。")
    }
  }

  private fun readLanguage(invoke: Invoke): String {
    return try {
      invoke.parseArgs(RecognizeArgs::class.java).lang.ifBlank { "zh-CN" }
    } catch (_: Exception) {
      "zh-CN"
    }
  }

  private fun settleWithText(text: String) {
    if (settled) return
    settled = true

    val current = pending
    pending = null
    releaseRecognizer()

    val result = JSObject()
    result.put("text", text)
    current?.resolve(result)
  }

  private fun settleWithError(code: String, message: String) {
    if (settled) return
    settled = true

    val current = pending
    pending = null
    releaseRecognizer()
    current?.reject(message, code)
  }

  /** 主动作废当前识别：既不发结果，也不当成用户可见的错误。 */
  private fun discardPending(code: String) {
    if (pending == null) {
      releaseRecognizer()
      return
    }
    settled = true
    val current = pending
    pending = null
    releaseRecognizer()
    current?.reject(code, code)
  }

  private fun releaseRecognizer() {
    val current = recognizer ?: return
    recognizer = null
    try {
      current.setRecognitionListener(null)
      current.cancel()
      current.destroy()
    } catch (_: Exception) {
      // 已经销毁或引擎已退出，忽略。
    }
  }

  override fun onStop(activity: AppCompatActivity) {
    // 应用退到后台时系统会收回麦克风，提前收尾避免回调丢失。
    discardPending("cancelled")
    super.onStop(activity)
  }

  override fun onDestroy(activity: AppCompatActivity) {
    releaseRecognizer()
    super.onDestroy(activity)
  }

  private fun errorName(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> "network"
    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
    else -> "unknown"
  }

  private fun describeError(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
      "没有拿到麦克风权限，可以开启权限后再试，或先用文字输入。"
    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
      "没有听到声音，可以再说一次，或改用文字输入。"
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
      "语音识别需要联网，现在没有连上。可以稍后再试，或改用文字输入。"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
      "语音识别正忙，请稍后再试。"
    else ->
      "这段语音没有识别出来，可以再录一次，或改用文字。"
  }
}
