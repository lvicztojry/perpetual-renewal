import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as ts from "typescript";

const ROOT = new URL("../", import.meta.url);
const PATH = new URL("src/lib/voice/native-speech.ts", ROOT);

const errors = [];

await testDetection();
await testUnavailableOutsideNative();
await testResultNormalization();
await testErrorMapping();
testAndroidKotlinSource();
testRustPluginRegistration();
testPrepareCopiesKotlin();

if (errors.length > 0) {
  console.error("Native speech smoke failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Native speech smoke passed: Android-only gating, result normalization, error copy, Kotlin/Rust wiring and Android source staging."
);

async function testDetection() {
  try {
    const { canUseNativeSpeech } = await loadModule();
    assert.equal(canUseNativeSpeech(scope({ tauri: true, android: true })), true, "native Android shell may use it");
    assert.equal(canUseNativeSpeech(scope({ tauri: true, android: false })), false, "desktop Tauri must not");
    assert.equal(canUseNativeSpeech(scope({ tauri: false, android: true })), false, "an Android browser must not");
    assert.equal(canUseNativeSpeech(null), false, "no window means unusable");
  } catch (error) {
    errors.push(`detection: ${error.message}`);
  }
}

async function testUnavailableOutsideNative() {
  try {
    const { startNativeSpeech, isNativeSpeechAvailable } = await loadModule();
    assert.equal(startNativeSpeech({}), null, "starting outside the native shell returns null");
    assert.equal(
      await isNativeSpeechAvailable(scope({ tauri: false, android: true })),
      false,
      "availability probe short-circuits outside the native shell"
    );
  } catch (error) {
    errors.push(`unavailable: ${error.message}`);
  }
}

async function testResultNormalization() {
  try {
    const invoke = async (command) => {
        if (command.endsWith("speech_recognize")) {
          return { ok: true, text: "  明天下午三点在老地方见。 " };
        }
        return { available: true };
      };
    const { startNativeSpeech } = await loadModule();

    const handle = startNativeSpeech({ lang: "zh-CN" }, scope({ tauri: true, android: true, invoke }));
    assert.ok(handle, "native shell should return a handle");
    const result = await handle.done;
    // 沙箱里创建的对象原型不同，deepStrictEqual 会误判，这里逐字段比对。
    assert.equal(result.ok, true, "a successful recognition reports ok");
    assert.equal(result.text, "明天下午三点在老地方见。", "text should be trimmed");

    const failingInvoke = async () => {
        throw new Error("[no-speech] - 没有听到声音，可以再说一次，或改用文字输入。");
      };
    const failedHandle = startNativeSpeech({}, scope({ tauri: true, android: true, invoke: failingInvoke }));
    const failed = await failedHandle.done;
    assert.equal(failed.ok, false, "invoke rejection should surface as a failure");
    assert.equal(failed.errorType, "unknown", "an unstructured rejection is unknown");
  } catch (error) {
    errors.push(`normalization: ${error.message}`);
  }
}

async function testErrorMapping() {
  try {
    const { describeNativeSpeechError } = await loadModule();
    const cases = [
      [{ ok: false, error: "", errorType: "cancelled" }, ""],
      [{ ok: false, error: "x", errorType: "not-allowed" }, "没有拿到麦克风权限，可以开启权限后再试，或先用文字输入。"],
      [{ ok: false, error: "x", errorType: "no-speech" }, "没有听到声音，可以再说一次，或改用文字输入。"],
      [{ ok: false, error: "x", errorType: "network" }, "语音识别需要联网，现在没有连上。可以稍后再试，或改用文字输入。"],
      [{ ok: false, error: "x", errorType: "unavailable" }, "这台设备没有可用的语音识别服务，可以改用文字输入。"]
    ];

    for (const [result, expected] of cases) {
      assert.equal(describeNativeSpeechError(result), expected, `mapping for ${result.errorType}`);
    }
    assert.equal(describeNativeSpeechError({ ok: true, text: "hi" }), "", "success has no message");
  } catch (error) {
    errors.push(`error mapping: ${error.message}`);
  }
}

function testAndroidKotlinSource() {
  const kotlin = readFileSync(fileURLToPath(new URL("native/android/SpeechPlugin.kt", ROOT)), "utf8");

  for (const snippet of [
    "@TauriPlugin",
    "class SpeechPlugin",
    "SpeechRecognizer.createSpeechRecognizer",
    "RecognizerIntent.ACTION_RECOGNIZE_SPEECH",
    "requestPermissionForAlias(\"microphone\"",
    "fun cancel(",
    "override fun onStop(",
    "override fun onDestroy("
  ]) {
    assert.ok(kotlin.includes(snippet), `SpeechPlugin.kt should contain ${snippet}`);
  }

  assert.ok(
    kotlin.includes("com.perpetualrenewal.localtest"),
    "the plugin package must match the Android application id"
  );
}

function testRustPluginRegistration() {
  const speech = readFileSync(fileURLToPath(new URL("native/src-tauri/src/speech.rs", ROOT)), "utf8");
  const lib = readFileSync(fileURLToPath(new URL("native/src-tauri/src/lib.rs", ROOT)), "utf8");

  for (const snippet of [
    "register_android_plugin",
    "SpeechPlugin",
    "speech_recognize",
    "speech_cancel",
    "speech_is_available",
    "#[command]",
    "async fn"
  ]) {
    assert.ok(speech.includes(snippet), `speech.rs should contain ${snippet}`);
  }

  assert.ok(
    /async fn speech_recognize/.test(speech),
    "blocking Android IPC must run on a background thread, so commands stay async"
  );
  assert.ok(lib.includes("mod speech"), "lib.rs should declare the speech module");
  assert.ok(lib.includes("plugin(speech::init())"), "lib.rs should register the speech plugin");
}

function testPrepareCopiesKotlin() {
  const prepare = readFileSync(fileURLToPath(new URL("native/scripts/prepare-mobile.mjs", ROOT)), "utf8");
  assert.ok(
    prepare.includes("SpeechPlugin.kt"),
    "prepare-mobile must copy the Kotlin plugin into the generated Android project"
  );
  assert.ok(
    prepare.includes("localtest"),
    "prepare-mobile must target the generated application package"
  );
}

function scope({ tauri, android, invoke }) {
  return {
    __TAURI_INTERNALS__: tauri ? { invoke } : undefined,
    navigator: {
      userAgent: android
        ? "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/158.0 Mobile Safari/537.36"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/158.0"
    }
  };
}

/**
 * 加载模块；测试通过 scope.__TAURI_INTERNALS__.invoke 注入替身。
 */
async function loadModule() {
  const source = await readFile(PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: PATH.pathname
  });

  const sandbox = {
    exports: {},
    require(specifier) {
      throw new Error(`Unexpected require: ${specifier}`);
    },
    console,
    setTimeout,
    clearTimeout
  };

  vm.createContext(sandbox);
  new vm.Script(compiled.outputText, { filename: PATH.pathname }).runInContext(sandbox);
  return sandbox.exports;
}
