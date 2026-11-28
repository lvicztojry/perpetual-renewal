package com.perpetualrenewal.localtest

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
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
import java.util.Locale

@InvokeArg
class RecognizeArgs { var lang: String = "zh-CN" }

@InvokeArg
class SpeakArgs {
  var text: String = ""
  var lang: String = "zh-CN"
  var rate: Float = 1.0f
}

/**
 * Optional Android system recognition and TextToSpeech engines.
 * Only recognition text is returned to JS. The selected system service may send audio
 * to its provider over the network; this API does not guarantee offline recognition.
 * TTS may also use network synthesis. Engine calls and state stay on the main looper;
 * vendor callbacks may arrive late or on binder threads.
 */
@TauriPlugin(permissions = [Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])])
class SpeechPlugin(private val hostActivity: Activity) : Plugin(hostActivity) {
  private val main = Handler(Looper.getMainLooper())
  private var destroyed = false
  private var background = false
  private var nextUtterance = 0L

  private class Recognition(val invoke: Invoke) {
    var engine: SpeechRecognizer? = null
    var awaitingPermission = false
    var awaitingForeground = false
    var stopping = false
    var timeout: Runnable? = null
  }
  private var recognition: Recognition? = null
  private var permissionRequest: Invoke? = null

  private class Speech(val invoke: Invoke, val args: SpeakArgs, val probe: Boolean, val id: String) {
    var engine: TextToSpeech? = null
    var timeout: Runnable? = null
    var poll: Runnable? = null
    var started = false
    var idleSince: Long? = null
  }
  private val speechJobs = mutableSetOf<Speech>()
  private var speaking: Speech? = null

  private fun onMain(action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) action() else main.post { action() }
  }

  private fun ok(invoke: Invoke) {
    val result = JSObject()
    result.put("ok", true)
    invoke.resolve(result)
  }

  private fun recognitionAvailable(): Boolean = try {
    SpeechRecognizer.isRecognitionAvailable(hostActivity)
  } catch (_: Exception) { false }

  @Command
  fun isAvailable(invoke: Invoke) = onMain {
    val result = JSObject()
    result.put("available", !destroyed && recognitionAvailable())
    invoke.resolve(result)
  }

  @Command
  fun recognize(invoke: Invoke) = onMain {
    if (destroyed || background) {
      invoke.reject("应用当前不可录音，请返回前台后重试。", "interrupted")
      return@onMain
    }
    if (!recognitionAvailable()) {
      invoke.reject("这台设备没有可用的语音识别服务，请安装并启用系统识别服务，或改用文字输入。", "unavailable")
      return@onMain
    }
    // Tauri owns the permission launcher; never launch overlapping permission dialogs.
    if (permissionRequest != null) {
      invoke.reject("请先完成麦克风权限授权。", "busy")
      return@onMain
    }
    recognition?.let { finishRecognition(it, "superseded", "superseded") }
    val session = Recognition(invoke)
    recognition = session
    try {
      if (getPermissionState("microphone") != PermissionState.GRANTED) {
        session.awaitingPermission = true
        permissionRequest = invoke
        requestPermissionForAlias("microphone", invoke, "onPermissionResult")
      } else startRecognition(session)
    } catch (_: Exception) {
      if (permissionRequest === invoke) permissionRequest = null
      finishRecognition(session, "start-failed", "无法初始化语音识别，请检查系统识别服务。")
    }
  }

  @PermissionCallback
  fun onPermissionResult(invoke: Invoke) = onMain {
    if (permissionRequest !== invoke) return@onMain
    permissionRequest = null
    val session = recognition ?: return@onMain
    if (session.invoke !== invoke || !session.awaitingPermission) return@onMain
    session.awaitingPermission = false
    if (destroyed) finishRecognition(session, "interrupted", "应用已关闭，语音识别中断，请重新录音。")
    else if (getPermissionState("microphone") != PermissionState.GRANTED) {
      finishRecognition(session, "not-allowed", "没有拿到麦克风权限，可以开启权限后再试，或先用文字输入。")
    } else if (background) {
      // Permission result can precede Activity.onResume on vendor Android builds.
      session.awaitingForeground = true
      armRecognitionTimeout(session, 30_000L)
    } else startRecognition(session)
  }

  /** Stop capture but leave final results on the original recognize invoke. */
  @Command
  fun stop(invoke: Invoke) = onMain {
    val session = recognition
    if (session != null && !session.stopping) {
      if (session.awaitingPermission || session.awaitingForeground) finishRecognition(session, "cancelled", "cancelled")
      else {
        session.stopping = true
        armRecognitionTimeout(session, 10_000L)
        try { session.engine?.stopListening() } catch (_: Exception) {
          finishRecognition(session, "stop-failed", "语音识别未能结束，请重试。")
        }
      }
    }
    ok(invoke)
  }

  @Command
  fun cancel(invoke: Invoke) = onMain {
    recognition?.let { finishRecognition(it, "cancelled", "cancelled") }
    ok(invoke)
  }

  private fun startRecognition(session: Recognition) {
    if (recognition !== session) return
    try {
      val created = SpeechRecognizer.createSpeechRecognizer(hostActivity)
      session.engine = created
      created.setRecognitionListener(object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() = onMain {
          if (recognition === session) armRecognitionTimeout(session, 10_000L)
        }
        override fun onError(error: Int) = onMain {
          finishRecognition(session, errorName(error), describeError(error))
        }
        override fun onResults(results: Bundle?) = onMain {
          val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()?.trim().orEmpty()
          if (text.isEmpty()) finishRecognition(session, "no-speech", "没有听到声音，可以再说一次，或改用文字输入。")
          else finishRecognition(session, text = text)
        }
        override fun onPartialResults(partialResults: Bundle?) {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
      })
      val lang = session.invoke.parseArgs(RecognizeArgs::class.java).lang.ifBlank { "zh-CN" }
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      }
      armRecognitionTimeout(session, 60_000L)
      created.startListening(intent)
    } catch (_: SecurityException) {
      finishRecognition(session, "not-allowed", "没有拿到麦克风权限，请在系统设置中允许录音。")
    } catch (_: Exception) {
      finishRecognition(session, "start-failed", "语音识别没有启动成功，请检查系统识别服务后重试。")
    }
  }

  private fun armRecognitionTimeout(session: Recognition, delay: Long) {
    session.timeout?.let { main.removeCallbacks(it) }
    session.timeout = Runnable { finishRecognition(session, "timeout", "系统识别服务未返回结果，请重试或改用文字。") }
      .also { main.postDelayed(it, delay) }
  }

  private fun finishRecognition(session: Recognition, code: String? = null, message: String = "", text: String = "") {
    if (recognition !== session) return
    recognition = null // invalidate before cancel/destroy can produce callbacks
    session.timeout?.let { main.removeCallbacks(it) }
    val engine = session.engine
    session.engine = null
    // Independent cleanup: a vendor cancel failure must not skip destroy.
    try { engine?.cancel() } catch (_: Exception) {}
    try { engine?.destroy() } catch (_: Exception) {}
    if (code != null) session.invoke.reject(message, code)
    else {
      val result = JSObject()
      result.put("text", text)
      session.invoke.resolve(result)
    }
  }

  /** {lang?} -> {available, errorType?, error?}; probes actual init and language. */
  @Command
  fun isSpeechAvailable(invoke: Invoke) = onMain { beginSpeech(invoke, true) }

  /** {text, lang?, rate?} -> {ok:true} on utterance completion; failures reject(message, code). */
  @Command
  fun speak(invoke: Invoke) = onMain { beginSpeech(invoke, false) }

  @Command
  fun cancelSpeech(invoke: Invoke) = onMain {
    speaking?.let { finishSpeech(it, "cancelled", "cancelled") }
    ok(invoke)
  }

  private fun beginSpeech(invoke: Invoke, probe: Boolean) {
    val args = try { invoke.parseArgs(SpeakArgs::class.java) } catch (_: Exception) {
      invoke.reject("朗读参数无效。", "invalid-args")
      return
    }
    if (!probe && (args.text.isBlank() || !args.rate.isFinite() || args.rate < 0.1f || args.rate > 3.0f)) {
      invoke.reject("朗读内容不能为空，语速须在 0.1 到 3 之间。", "invalid-args")
      return
    }
    if (!probe && args.text.length > TextToSpeech.getMaxSpeechInputLength()) {
      invoke.reject("朗读内容过长，请分段朗读。", "text-too-long")
      return
    }
    val job = Speech(invoke, args, probe, "speech-${++nextUtterance}")
    speechJobs.add(job)
    if (!probe) {
      speaking?.let { finishSpeech(it, "superseded", "superseded") }
      speaking = job
    }
    if (destroyed || background) {
      finishSpeech(job, "cancelled", "应用当前不可朗读，请返回前台后重试。")
      return
    }
    try {
      val services = hostActivity.packageManager.queryIntentServices(Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), 0)
      if (services.isEmpty()) {
        finishSpeech(job, "unavailable", "这台设备没有可用的系统朗读引擎，请安装并启用文字转语音服务。")
        return
      }
      armSpeechTimeout(job, 10_000L)
      // Always post: initialization may report synchronously inside the constructor.
      job.engine = TextToSpeech(hostActivity.applicationContext) { status ->
        main.post { onSpeechInitialized(job, status) }
      }
    } catch (_: Exception) {
      finishSpeech(job, "init-failed", "系统朗读引擎初始化失败，请检查文字转语音设置。")
    }
  }

  private fun onSpeechInitialized(job: Speech, status: Int) {
    if (!speechJobs.contains(job)) return
    if (status != TextToSpeech.SUCCESS) {
      finishSpeech(job, "init-failed", "系统朗读引擎初始化失败，请检查文字转语音设置。")
      return
    }
    try {
      val engine = job.engine ?: throw IllegalStateException("No TTS engine")
      val locale = Locale.forLanguageTag(job.args.lang.ifBlank { "zh-CN" }.replace('_', '-'))
      if (locale.language.isEmpty()) {
        finishSpeech(job, "invalid-args", "朗读语言参数无效。")
        return
      }
      val language = engine.setLanguage(locale)
      if (language < TextToSpeech.LANG_AVAILABLE) {
        val missing = language == TextToSpeech.LANG_MISSING_DATA
        finishSpeech(job, if (missing) "language-unavailable" else "language-not-supported",
          if (missing) "系统朗读缺少该语言的语音数据，请在文字转语音设置中下载。" else "系统朗读引擎不支持该语言，请更换引擎或语言。")
        return
      }
      if (job.probe) { finishSpeech(job); return }
      if (engine.setSpeechRate(job.args.rate) != TextToSpeech.SUCCESS) {
        finishSpeech(job, "speak-failed", "系统朗读引擎无法设置语速。")
        return
      }
      val listenerStatus = engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) = onMain {
          if (utteranceId == job.id && speechJobs.contains(job) && !job.started) {
            job.started = true
            job.idleSince = null
          }
        }
        override fun onDone(utteranceId: String?) = onMain {
          if (utteranceId == job.id) finishSpeech(job)
        }
        @Deprecated("Required for older engines")
        override fun onError(utteranceId: String?) = onError(utteranceId, TextToSpeech.ERROR)
        override fun onError(utteranceId: String?, errorCode: Int) = onMain {
          if (utteranceId == job.id) {
            val code = when (errorCode) {
              TextToSpeech.ERROR_NETWORK, TextToSpeech.ERROR_NETWORK_TIMEOUT -> "network"
              TextToSpeech.ERROR_NOT_INSTALLED_YET -> "language-unavailable"
              TextToSpeech.ERROR_OUTPUT -> "audio-output"
              else -> "speak-failed"
            }
            val message = when (code) {
              "network" -> "系统朗读服务网络连接失败，请稍后重试。"
              "language-unavailable" -> "系统朗读语音数据尚未下载完成。"
              "audio-output" -> "系统朗读无法输出音频，请检查音频设备。"
              else -> "系统朗读失败，请检查文字转语音设置后重试。"
            }
            finishSpeech(job, code, message)
          }
        }
        override fun onStop(utteranceId: String?, interrupted: Boolean) = onMain {
          if (utteranceId == job.id) finishSpeech(job, "cancelled", "cancelled")
        }
      })
      if (listenerStatus != TextToSpeech.SUCCESS) {
        finishSpeech(job, "speak-failed", "系统朗读引擎无法提供播放回调。")
        return
      }
      val timeout = (job.args.text.length * 600L / job.args.rate).toLong().coerceIn(30_000L, 1_800_000L)
      armSpeechTimeout(job, timeout)
      if (engine.speak(job.args.text, TextToSpeech.QUEUE_FLUSH, Bundle(), job.id) != TextToSpeech.SUCCESS) {
        finishSpeech(job, "speak-failed", "系统朗读未能启动，请检查文字转语音设置。")
        return
      }
      // Enqueue success is not playback. Some vendor engines omit onDone, so
      // observe actual start before allowing sustained idle to settle the invoke.
      if (speechJobs.contains(job)) pollSpeech(job)
    } catch (_: Exception) {
      finishSpeech(job, "speak-failed", "系统朗读失败，请检查文字转语音设置后重试。")
    }
  }

  private fun pollSpeech(job: Speech) {
    val poll = object : Runnable {
      override fun run() {
        if (!speechJobs.contains(job)) return
        val engine = job.engine ?: return
        try {
          if (engine.isSpeaking) {
            job.started = true
            job.idleSince = null
          } else if (job.started) {
            val now = SystemClock.uptimeMillis()
            val idleSince = job.idleSince
            if (idleSince == null) job.idleSince = now
            else if (now - idleSince >= 1_250L) {
              finishSpeech(job)
              return
            }
          }
        } catch (_: Exception) {
          finishSpeech(job, "speak-failed", "无法读取系统朗读状态，请重试。")
          return
        }
        main.postDelayed(this, 250L)
      }
    }
    job.poll = poll
    main.postDelayed(poll, 250L)
    // The existing utterance deadline bounds polling even if start is never
    // observed or an engine stays busy forever. onDone remains the fast path.
  }

  private fun armSpeechTimeout(job: Speech, delay: Long) {
    job.timeout?.let { main.removeCallbacks(it) }
    job.timeout = Runnable { finishSpeech(job, "timeout", "系统朗读服务响应超时，请重试。") }
      .also { main.postDelayed(it, delay) }
  }

  private fun finishSpeech(job: Speech, code: String? = null, message: String = "") {
    if (!speechJobs.remove(job)) return
    if (speaking === job) speaking = null
    job.timeout?.let { main.removeCallbacks(it) }
    job.timeout = null
    job.poll?.let { main.removeCallbacks(it) }
    job.poll = null
    val engine = job.engine
    job.engine = null
    try { engine?.stop() } catch (_: Exception) {}
    try { engine?.shutdown() } catch (_: Exception) {}
    if (job.probe) {
      val result = JSObject()
      result.put("available", code == null)
      if (code != null) {
        result.put("errorType", code)
        result.put("error", message)
      }
      job.invoke.resolve(result)
    } else if (code != null) job.invoke.reject(message, code)
    else ok(job.invoke)
  }

  override fun onResume(activity: AppCompatActivity) {
    onMain {
      background = false
      recognition?.let {
        if (it.awaitingForeground && !destroyed) {
          it.awaitingForeground = false
          startRecognition(it)
        }
      }
    }
    super.onResume(activity)
  }

  override fun onStop(activity: AppCompatActivity) {
    onMain {
      background = true
      // Vendor permission UI may stop the Activity again after the permission
      // result arrived. Preserve both phases until onResume starts recognition.
      recognition?.let {
        if (!it.awaitingPermission && !it.awaitingForeground) {
          finishRecognition(it, "interrupted", "应用进入后台，语音识别中断，请返回前台后重新录音。")
        }
      }
      speechJobs.toList().forEach { finishSpeech(it, "cancelled", "cancelled") }
    }
    super.onStop(activity)
  }

  override fun onDestroy(activity: AppCompatActivity) {
    onMain {
      destroyed = true
      permissionRequest = null
      recognition?.let { finishRecognition(it, "interrupted", "应用已关闭，语音识别中断，请重新录音。") }
      speechJobs.toList().forEach { finishSpeech(it, "cancelled", "cancelled") }
    }
    super.onDestroy(activity)
  }

  private fun errorName(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> "network"
    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "busy"
    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "language-not-supported"
    SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "language-unavailable"
    SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "unavailable"
    else -> "unknown"
  }

  private fun describeError(error: Int): String = when (errorName(error)) {
    "not-allowed" -> "没有拿到麦克风权限，可以开启权限后再试，或先用文字输入。"
    "no-speech" -> "没有听到声音，可以再说一次，或改用文字输入。"
    "network" -> "系统语音识别服务连接失败，请检查网络后重试，或改用文字输入。"
    "busy" -> "语音识别正忙，请稍后再试。"
    "language-not-supported" -> "系统语音识别服务不支持该语言，请更换语言或改用文字输入。"
    "language-unavailable" -> "系统语音识别缺少该语言数据，请在系统设置中下载或改用文字输入。"
    "unavailable" -> "系统语音识别服务已断开，请检查或启用系统识别服务。"
    else -> "这段语音没有识别出来，可以再录一次，或改用文字。"
  }
}
