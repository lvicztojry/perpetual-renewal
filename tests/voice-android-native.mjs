import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const prepareURL = new URL("../native/scripts/prepare-mobile.mjs", import.meta.url);
const kotlin = readFileSync(new URL("../native/android/SpeechPlugin.kt", import.meta.url), "utf8");
const prepare = readFileSync(prepareURL, "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replaceAll("import.meta.url", JSON.stringify(prepareURL.href));
const manifestPath = fileURLToPath(new URL("../src-tauri/gen/android/app/src/main/AndroidManifest.xml", prepareURL));
const kotlinSource = fileURLToPath(new URL("../android/SpeechPlugin.kt", prepareURL));
const kotlinDestination = fileURLToPath(new URL("../src-tauri/gen/android/app/src/main/java/com/perpetualrenewal/localtest/SpeechPlugin.kt", prepareURL));
const gradlePath = fileURLToPath(new URL("../src-tauri/gen/android/app/build.gradle.kts", prepareURL));
const recognition = "android.speech.RecognitionService";
const tts = "android.intent.action.TTS_SERVICE";
const intent = (name) => `<intent><action android:name="${name}" /></intent>`;

// Execute the actual staging script against an in-memory filesystem. No generated
// project, Gradle process, Kotlin compiler, or concurrent worker file is touched.
for (const [label, queries] of [
  ["no queries", ""],
  ["unrelated package query", '<queries><package android:name="org.example" /></queries>'],
  ["recognition already declared", `<queries>${intent(recognition)}</queries>`],
  ["TTS already declared", `<queries>${intent(tts)}</queries>`],
  ["both already declared", `<queries>${intent(recognition)}${intent(tts)}</queries>`],
  ["self-closing queries", "<queries />"],
  ["single quoted existing action", `<queries><intent><action android:name = '${recognition}' /></intent></queries>`]
]) {
  const files = new Map([
    [manifestPath, `<manifest xmlns:android="http://schemas.android.com/apk/res/android">${queries}<application><service>${intent(recognition)}</service></application></manifest>`],
    [kotlinSource, kotlin],
    [gradlePath, "compileSdk = 35\ntargetSdk = 35\n"]
  ]);
  const sandbox = {
    URL, fileURLToPath, join,
    existsSync: (path) => files.has(path),
    readFileSync: (path) => { assert.ok(files.has(path), path); return files.get(path); },
    writeFileSync: (path, value) => files.set(path, value),
    mkdirSync() {},
    readdirSync: () => [],
    copyFileSync: (source, destination) => files.set(destination, files.get(source)),
    console: { log() {}, error() {} },
    process: { exit: (code) => assert.fail(`unexpected script exit ${code}`) }
  };
  vm.runInNewContext(prepare, { ...sandbox });
  const output = files.get(manifestPath);
  const blocks = output.match(/<queries\b[^>]*>[\s\S]*?<\/queries>/g) ?? [];
  assert.equal(blocks.length, 1, `${label}: one queries element`);
  for (const action of [recognition, tts]) {
    assert.equal(blocks.join("").split(action).length - 1, 1, `${label}: exactly one query for ${action}`);
  }
  for (const permission of ["RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"]) {
    assert.equal(output.split(`android.permission.${permission}`).length - 1, 1, `${label}: permission`);
  }
  assert.equal(files.get(kotlinDestination), kotlin, `${label}: stage same-package plugin including TTS`);
  assert.equal(files.get(gradlePath), "compileSdk = 36\ntargetSdk = 36\n");
  vm.runInNewContext(prepare, { ...sandbox });
  assert.equal(files.get(manifestPath), output, `${label}: staging is idempotent`);
}

// Source contract guards supplement staging execution and the Kotlin harness;
// real speech service behavior still requires device verification.
const method = (name, next) => kotlin.slice(kotlin.indexOf(name), kotlin.indexOf(next, kotlin.indexOf(name) + name.length));
for (const command of ["isAvailable", "recognize", "stop", "cancel", "isSpeechAvailable", "speak", "cancelSpeech"]) {
  assert.match(kotlin, new RegExp(`@Command\\s+fun ${command}\\(invoke: Invoke\\) = onMain`), `${command}: main-thread entry`);
}
const stopping = method("fun stop(", "@Command");
assert.match(stopping, /stopListening\(\)/);
assert.doesNotMatch(stopping, /\.cancel\(|\.destroy\(/, "stop must wait for recognition results");
assert.match(stopping, /armRecognitionTimeout\(session, 10_000L\)/);
assert.match(kotlin, /if \(recognition !== session\) return/, "stale recognition callbacks cannot settle a new request");
assert.match(kotlin, /if \(!speechJobs.remove\(job\)\) return/, "TTS settles exactly once per session");
assert.match(kotlin, /if \(utteranceId == job.id\) finishSpeech\(job\)/, "completion matches the utterance");
assert.match(kotlin, /main.post \{ onSpeechInitialized\(job, status\) \}/, "constructor callback is deferred until assignment");
assert.match(kotlin, /armSpeechTimeout\(job, 10_000L\)/);
assert.match(kotlin, /engine.setLanguage\(locale\)/);
assert.match(kotlin, /TextToSpeech.LANG_MISSING_DATA/);
assert.match(kotlin, /TextToSpeech.ERROR_NETWORK_TIMEOUT/);
assert.match(kotlin, /services.isEmpty\(\)/, "missing TTS engine is a supported outcome");
assert.match(kotlin, /permissionRequest !== invoke/, "stale permission callback is ignored");
assert.match(kotlin, /if \(!it.awaitingPermission && !it.awaitingForeground\)/, "permission activity must preserve both permission phases");
assert.match(kotlin, /session.awaitingForeground = true/, "permission result can precede resume");
const start = method("private fun startRecognition", "private fun armRecognitionTimeout");
assert.ok(start.indexOf("try {") < start.indexOf("SpeechRecognizer.createSpeechRecognizer"), "creation is inside exception boundary");
const destroy = method("override fun onDestroy(activity", "private fun errorName");
assert.match(destroy, /finishRecognition/);
assert.match(destroy, /finishSpeech/);
assert.doesNotMatch(kotlin, /音频不离开设备|一定离线/);
assert.match(kotlin, /does not guarantee offline recognition/);
console.log("Android speech guards passed: 7 staging fixtures/idempotence, native API, session/lifecycle/timeout/privacy contracts.");

// Compile and execute the production Kotlin TTS methods with a virtual main
// looper and controllable engine. This tests callback/poll races, not a JS port
// of the algorithm. No Android project or concurrent worker output is modified.
const root = fileURLToPath(new URL("../", import.meta.url));
const javaRoot = join(root, ".build-tools/java");
const java = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java")
  : existsSync(javaRoot) ? join(javaRoot, readdirSync(javaRoot)[0], "bin", "java.exe") : "java";
const distributions = join(root, ".build-tools/gradle/wrapper/dists");
function compilerLib(directory) {
  if (!existsSync(directory)) return null;
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.some((entry) => /^kotlin-compiler-embeddable-.*\.jar$/.test(entry.name))) return directory;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = compilerLib(join(directory, entry.name));
      if (found) return found;
    }
  }
  return null;
}
const lib = process.env.KOTLIN_TEST_LIB ?? compilerLib(distributions);
if (!lib) {
  assert.ok(!process.argv.includes("--require-kotlin"), "Kotlin behavior tests require KOTLIN_TEST_LIB or bundled Gradle compiler");
  console.log("SKIP Kotlin behavior tests: set KOTLIN_TEST_LIB to a directory containing Kotlin compiler/runtime jars.");
} else {
  const source = `
import java.util.Locale
object SystemClock { var now = 0L; fun uptimeMillis() = now }
class Handler {
  val queue = mutableListOf<Pair<Long, Runnable>>()
  fun postDelayed(r: Runnable, delay: Long) { queue.add(SystemClock.now + delay to r) }
  fun removeCallbacks(r: Runnable) { queue.removeAll { it.second === r } }
  fun advance(delay: Long) {
    val end = SystemClock.now + delay
    while (true) {
      val next = queue.minByOrNull { it.first } ?: break
      if (next.first > end) break
      queue.remove(next); SystemClock.now = next.first; next.second.run()
    }
    SystemClock.now = end
  }
}
class JSObject : HashMap<String, Any>()
class Invoke {
  var count = 0; var code: String? = null; var result: JSObject? = null
  fun resolve(value: JSObject) { count++; result = value }
  fun reject(message: String, error: String) { count++; code = error }
}
class SpeakArgs { var text = "测试"; var lang = "zh-CN"; var rate = 1.0f }
class Bundle
open class UtteranceProgressListener {
  open fun onStart(id: String?) {}; open fun onDone(id: String?) {}
  open fun onError(id: String?) {}; open fun onError(id: String?, code: Int) {}
  open fun onStop(id: String?, interrupted: Boolean) {}
}
class TextToSpeech {
  companion object {
    const val SUCCESS = 0; const val ERROR = -1; const val LANG_AVAILABLE = 0
    const val LANG_MISSING_DATA = -1; const val QUEUE_FLUSH = 0
    const val ERROR_NETWORK = -6; const val ERROR_NETWORK_TIMEOUT = -7
    const val ERROR_NOT_INSTALLED_YET = -9; const val ERROR_OUTPUT = -5
  }
  var listener: UtteranceProgressListener? = null
  var active = false; var pollThrows = false; var stopThrows = false
  var stops = 0; var shutdowns = 0; var speakStatus = SUCCESS
  var languageStatus = LANG_AVAILABLE; var rateStatus = SUCCESS; var listenerStatus = SUCCESS
  var duringSpeak: (() -> Unit)? = null
  val isSpeaking: Boolean get() { if (pollThrows) error("engine disconnected"); return active }
  fun setLanguage(locale: Locale) = languageStatus
  fun setSpeechRate(rate: Float) = rateStatus
  fun setOnUtteranceProgressListener(value: UtteranceProgressListener): Int { listener = value; return listenerStatus }
  fun speak(text: String, mode: Int, params: Bundle, id: String): Int { duringSpeak?.invoke(); return speakStatus }
  fun stop() { stops++; if (stopThrows) error("vendor stop failure") }
  fun shutdown() { shutdowns++ }
}
class AppCompatActivity
enum class PermissionState { GRANTED, DENIED }
open class Plugin {
  open fun onResume(activity: AppCompatActivity) {}
  open fun onStop(activity: AppCompatActivity) {}
  open fun onDestroy(activity: AppCompatActivity) {}
}
class Harness : Plugin() {
  val main = Handler()
  var destroyed = false; var background = false; var permissionRequest: Invoke? = null
  class Recognition(val invoke: Invoke) {
    var awaitingPermission = false; var awaitingForeground = false
    var timeout: Runnable? = null
  }
  var recognition: Recognition? = null
  var permission = PermissionState.GRANTED; var recognitionStarts = 0
  private fun recognitionAvailable() = true
  private fun getPermissionState(alias: String) = permission
  private fun requestPermissionForAlias(alias: String, invoke: Invoke, callback: String) {}
  private fun startRecognition(session: Recognition) { recognitionStarts++; session.timeout?.let { main.removeCallbacks(it) } }
  private fun finishRecognition(session: Recognition, code: String, message: String) {
    if (recognition !== session) return
    recognition = null; session.timeout?.let { main.removeCallbacks(it) }; session.invoke.reject(message, code)
  }
  private fun armRecognitionTimeout(session: Recognition, delay: Long) {
    session.timeout?.let { main.removeCallbacks(it) }
    session.timeout = Runnable { finishRecognition(session, "timeout", "timeout") }.also { main.postDelayed(it, delay) }
  }
  private fun onMain(action: () -> Unit) = action()
  private fun ok(invoke: Invoke) { val result = JSObject(); result.put("ok", true); invoke.resolve(result) }
  ${method("private class Speech(", "private val speechJobs")}
  private val speechJobs = mutableSetOf<Speech>()
  private var speaking: Speech? = null
  ${method("private fun onSpeechInitialized(", "override fun onResume(activity")}
  ${method("override fun onResume(activity", "private fun errorName")}
  ${method("fun cancelSpeech(", "private fun beginSpeech")}
  ${method("fun recognize(", "@PermissionCallback")}
  ${method("fun onPermissionResult(", "/** Stop capture")}
  ${method("fun cancel(invoke", "private fun startRecognition")}
  lateinit var engine: TextToSpeech
  lateinit var invoke: Invoke
  private lateinit var job: Speech
  fun prepare(probe: Boolean = false) {
    engine = TextToSpeech(); invoke = Invoke()
    job = Speech(invoke, SpeakArgs(), probe, "current")
    job.engine = engine; speechJobs.add(job); speaking = job
    armSpeechTimeout(job, 10_000L)
  }
  fun initialize(status: Int = TextToSpeech.SUCCESS) = onSpeechInitialized(job, status)
  fun pending() { check(invoke.count == 0) }
  fun settled(code: String? = null) {
    check(invoke.count == 1 && invoke.code == code) { "unexpected settlement: " + invoke.code + "/" + invoke.count }
    if (code == null) check(invoke.result?.get("ok") == true || invoke.result?.get("available") == true)
    check(main.queue.isEmpty()) { "handler jobs leaked" }
    check(engine.stops == 1 && engine.shutdowns == 1)
  }
}
fun fixture(): Harness { SystemClock.now = 0; return Harness().also { it.prepare(); it.initialize() } }
fun main() {
  // Enqueue success and pre-start idle cannot complete an utterance.
  fixture().apply { main.advance(5_000); pending(); main.advance(25_000); settled("timeout") }
  // Missing onDone: onStart -> sustained idle completes, with grace for late errors.
  fixture().apply {
    engine.listener!!.onStart("current"); main.advance(1_250); pending()
    main.advance(250); settled(); main.advance(30_000); settled()
  }
  // Both callbacks missing: observing isSpeaking suffices.
  fixture().apply {
    engine.active = true; main.advance(250); pending()
    engine.active = false; main.advance(1_250); pending(); main.advance(250); settled()
  }
  // Delayed startup and an intermediate idle gap must not truncate playback.
  fixture().apply {
    main.advance(4_000); pending(); engine.listener!!.onStart("current")
    main.advance(750); engine.active = true; main.advance(500); pending()
    engine.active = false; main.advance(1_250); pending(); main.advance(250); settled()
  }
  fixture().apply { engine.active = true; main.advance(30_000); settled("timeout") }
  fixture().apply { engine.listener!!.onDone("current"); settled() }
  fixture().apply {
    engine.listener!!.onStart("stale"); engine.listener!!.onDone("stale")
    engine.listener!!.onError("stale", TextToSpeech.ERROR_OUTPUT)
    main.advance(2_000); pending(); engine.listener!!.onDone("current"); settled()
  }
  for ((error, code) in listOf(TextToSpeech.ERROR_NETWORK to "network",
      TextToSpeech.ERROR_NETWORK_TIMEOUT to "network", TextToSpeech.ERROR_OUTPUT to "audio-output",
      TextToSpeech.ERROR_NOT_INSTALLED_YET to "language-unavailable", TextToSpeech.ERROR to "speak-failed")) {
    fixture().apply {
      engine.listener!!.onStart("current"); main.advance(1_000)
      engine.listener!!.onError("current", error); settled(code)
      engine.listener!!.onDone("current"); main.advance(30_000); settled(code)
    }
  }
  fixture().apply { engine.pollThrows = true; main.advance(250); settled("speak-failed") }
  fixture().apply { engine.listener!!.onStop("current", true); settled("cancelled") }
  fixture().apply { cancelSpeech(Invoke()); settled("cancelled") }
  fixture().apply { onStop(AppCompatActivity()); settled("cancelled") }
  fixture().apply {
    val stale = engine.listener!!; engine.stopThrows = true
    onDestroy(AppCompatActivity()); settled("cancelled")
    stale.onStart("current"); stale.onDone("current"); main.advance(30_000); settled("cancelled")
    prepare(); initialize(); stale.onDone("current"); pending()
    engine.listener!!.onDone("current"); settled()
  }
  Harness().apply { prepare(); engine.speakStatus = TextToSpeech.ERROR; initialize(); settled("speak-failed") }
  Harness().apply { prepare(); engine.duringSpeak = { engine.listener!!.onDone("current") }; initialize(); settled() }
  Harness().apply { prepare(true); initialize(); settled() }
  Harness().apply { prepare(); initialize(TextToSpeech.ERROR); settled("init-failed") }
  // Execute actual recognition entry/permission/lifecycle methods. A vendor can
  // deliver the permission result between two stops before the eventual resume.
  Harness().apply {
    permission = PermissionState.DENIED
    val request = Invoke(); recognize(request); check(recognition!!.awaitingPermission)
    onStop(AppCompatActivity()); check(request.count == 0)
    permission = PermissionState.GRANTED; onPermissionResult(request)
    check(recognition!!.awaitingForeground && recognitionStarts == 0)
    onStop(AppCompatActivity()); check(request.count == 0)
    onResume(AppCompatActivity()); check(recognitionStarts == 1 && !recognition!!.awaitingForeground)
    onResume(AppCompatActivity()); check(recognitionStarts == 1)
    onStop(AppCompatActivity()); check(request.code == "interrupted" && main.queue.isEmpty())
  }
  Harness().apply {
    background = true; val request = Invoke(); recognize(request)
    check(request.code == "interrupted")
  }
  Harness().apply {
    permission = PermissionState.DENIED; val request = Invoke(); recognize(request)
    onPermissionResult(request); check(request.code == "not-allowed")
  }
  Harness().apply {
    permission = PermissionState.DENIED; val request = Invoke(); recognize(request)
    onStop(AppCompatActivity()); permission = PermissionState.GRANTED; onPermissionResult(request)
    main.advance(30_000); check(request.code == "timeout" && recognitionStarts == 0)
  }
  Harness().apply {
    val request = Invoke(); recognize(request); cancel(Invoke()); check(request.code == "cancelled")
  }
  Harness().apply {
    val request = Invoke(); recognize(request); onDestroy(AppCompatActivity()); check(request.code == "interrupted")
  }
  Harness().apply {
    permission = PermissionState.DENIED; val request = Invoke(); recognize(request)
    onStop(AppCompatActivity()); onResume(AppCompatActivity())
    permission = PermissionState.GRANTED; onPermissionResult(request)
    check(recognitionStarts == 1 && request.count == 0)
    onPermissionResult(request); check(recognitionStarts == 1)
  }
  Harness().apply {
    permission = PermissionState.DENIED; val old = Invoke(); recognize(old); cancel(Invoke())
    permission = PermissionState.GRANTED; onPermissionResult(old)
    val current = Invoke(); recognize(current); onPermissionResult(old)
    check(old.code == "cancelled" && current.count == 0 && recognitionStarts == 1)
  }
  println("Kotlin TTS behavior passed: start evidence, idle grace/reset, callbacks, errors, deadlines, cancellation/lifecycle cleanup and stale sessions")
  println("Kotlin recognition lifecycle passed: permission/stop/result/stop/resume ordering, visible interruption/denial/timeout, explicit cancel")
}
`;
  const temporary = mkdtempSync(join(tmpdir(), "renewal-tts-test-"));
  try {
    const input = join(temporary, "SpeechCompletionTest.kt");
    const output = join(temporary, "classes");
    writeFileSync(input, source);
    const jars = readdirSync(lib).filter((name) => /^(kotlin-|kotlinx-coroutines|annotations-).*\.jar$/.test(name))
      .map((name) => join(lib, name));
    const classpath = jars.join(delimiter);
    const compile = spawnSync(java, ["-cp", classpath, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
      "-no-stdlib", "-no-reflect", "-nowarn", "-classpath", classpath, "-d", output, input], { encoding: "utf8", timeout: 60_000 });
    assert.equal(compile.status, 0, `Kotlin harness compilation failed: ${compile.error ?? ""}\n${compile.stdout}\n${compile.stderr}`);
    const run = spawnSync(java, ["-cp", [output, ...jars].join(delimiter), "SpeechCompletionTestKt"], { encoding: "utf8", timeout: 30_000 });
    assert.equal(run.status, 0, `Kotlin behavior failed: ${run.error ?? ""}\n${run.stdout}\n${run.stderr}`);
    console.log(run.stdout.trim());
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
