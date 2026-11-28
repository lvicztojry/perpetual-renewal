import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as ts from "typescript";

const ROOT = new URL("../", import.meta.url);
const PATH = new URL("src/lib/voice/system-speech.ts", ROOT);

const errors = [];
await testNativeShellDetection();
await testBrowserStaysOnEdge();
await testVoiceSelection();
await testSpeakLifecycle();
await testStopSettles();
testAndroidManifestPermissions();
testAndroidBuildRunsPrepare();

if (errors.length > 0) {
  console.error("System speech smoke failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "System speech smoke passed: native-only gating, voice selection, utterance lifecycle, stop handling, and Android permission wiring."
);

async function testNativeShellDetection() {
  try {
    const { shouldUseSystemSpeech, isNativeAndroidShell } = await loadModule();

    const androidTauri = fakeScope({ tauri: true, android: true });
    assert.equal(isNativeAndroidShell(androidTauri), true, "Tauri + Android UA should be the native shell");
    assert.equal(shouldUseSystemSpeech(androidTauri), true, "native Android shell should take over reading");

    const windowsTauri = fakeScope({ tauri: true, android: false });
    assert.equal(
      shouldUseSystemSpeech(windowsTauri),
      false,
      "desktop Tauri keeps the server/Edge path so Edge TTS still works there"
    );

    const plainBrowser = fakeScope({ tauri: false, android: true });
    assert.equal(
      shouldUseSystemSpeech(plainBrowser),
      false,
      "an Android browser is not the native shell and must keep Edge TTS"
    );

    const noSynthesis = fakeScope({ tauri: true, android: true, withSynthesis: false });
    assert.equal(
      shouldUseSystemSpeech(noSynthesis),
      false,
      "without speechSynthesis the call must fall back instead of pretending to speak"
    );
  } catch (error) {
    errors.push(`native detection: ${error.message}`);
  }
}

async function testBrowserStaysOnEdge() {
  try {
    const { speakWithSystemVoice } = await loadModule();
    assert.equal(
      speakWithSystemVoice("你好", {}, fakeScope({ tauri: false, android: true })),
      null,
      "browser must not grab the reading path"
    );
    assert.equal(
      speakWithSystemVoice("   ", {}, fakeScope({ tauri: true, android: true })),
      null,
      "blank text must not start an utterance"
    );
  } catch (error) {
    errors.push(`browser path: ${error.message}`);
  }
}

async function testVoiceSelection() {
  try {
    const { pickChineseVoice } = await loadModule();
    const voices = [
      { lang: "en-US", name: "English", default: true },
      { lang: "zh-CN", name: "Chinese" },
      { lang: "zh-TW", name: "Traditional" }
    ];

    assert.equal(pickChineseVoice(voices, "zh-CN")?.name, "Chinese", "exact locale should win");
    assert.equal(
      pickChineseVoice([{ lang: "en-US", name: "English" }], "zh-CN"),
      null,
      "no Chinese voice means fall back to the engine default"
    );
    assert.equal(
      pickChineseVoice(
        [{ lang: "en-US", name: "English", default: true }, { lang: "zh-CN", name: "Chinese", default: true }],
        "zh-CN"
      )?.name,
      "Chinese",
      "a default Chinese voice is preferred over other locales"
    );
  } catch (error) {
    errors.push(`voice selection: ${error.message}`);
  }
}

async function testSpeakLifecycle() {
  try {
    const { speakWithSystemVoice } = await loadModule();
    const scope = fakeScope({ tauri: true, android: true });
    const started = [];
    const ended = [];

    const handle = speakWithSystemVoice("今天也很想你。", {
      onStart: () => started.push(true),
      onEnd: () => ended.push(true)
    }, scope);

    assert.ok(handle, "speaking should return a handle");
    const spoken = scope.speechSynthesis.spoken.at(-1);
    assert.equal(spoken.lang, "zh-CN", "utterance should ask for Chinese");
    assert.equal(spoken.rate, 1, "default rate should be normal speed");
    assert.equal(spoken.voice?.name, "Chinese", "a Chinese voice should be attached");

    spoken.onstart();
    assert.equal(started.length, 1, "onStart should fire");

    spoken.onend();
    assert.equal(ended.length, 1, "onEnd should fire");
    await handle.done;
    assert.equal(scope.speechSynthesis.cancelCount >= 1, true, "a previous utterance is cancelled first");
  } catch (error) {
    errors.push(`lifecycle: ${error.message}`);
  }
}

async function testStopSettles() {
  try {
    const { speakWithSystemVoice } = await loadModule();
    const scope = fakeScope({ tauri: true, android: true });
    const handle = speakWithSystemVoice("测试", {}, scope);
    assert.ok(handle);

    handle.stop();
    await handle.done;
    assert.equal(scope.speechSynthesis.cancelCount >= 2, true, "stop should cancel the engine");

    // 迟到的 end 事件不能再抛异常或重复结算。
    scope.speechSynthesis.spoken.at(-1).onend();
    await handle.done;
  } catch (error) {
    errors.push(`stop: ${error.message}`);
  }
}

function testAndroidManifestPermissions() {
  const preparePath = fileURLToPath(new URL("native/scripts/prepare-mobile.mjs", ROOT));
  const source = readFileSync(preparePath, "utf8");

  for (const permission of ["RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"]) {
    assert.ok(
      source.includes(`android.permission.${permission}`),
      `prepare-mobile must declare ${permission}; wry requires both before granting getUserMedia`
    );
  }

  const manifestPath = fileURLToPath(
    new URL("native/src-tauri/gen/android/app/src/main/AndroidManifest.xml", ROOT)
  );
  if (existsSync(manifestPath)) {
    const manifest = readFileSync(manifestPath, "utf8");
    for (const permission of ["RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"]) {
      assert.ok(
        manifest.includes(`android.permission.${permission}`),
        `generated manifest should declare ${permission} after prepare-mobile runs`
      );
    }
  }
}

function testAndroidBuildRunsPrepare() {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("native/package.json", ROOT)), "utf8"));
  assert.ok(
    pkg.scripts["android:build"].includes("prepare-mobile.mjs"),
    "android:build must re-apply permissions after tauri regenerates the project"
  );
}

function fakeScope({ tauri, android, withSynthesis = true }) {
  const spoken = [];
  const synthesis = {
    speaking: false,
    pending: false,
    cancelCount: 0,
    spoken,
    cancel() {
      this.cancelCount += 1;
    },
    speak(utterance) {
      spoken.push(utterance);
    },
    getVoices: () => [
      { lang: "en-US", name: "English", default: true },
      { lang: "zh-CN", name: "Chinese" }
    ]
  };

  const scope = {
    speechSynthesis: withSynthesis ? synthesis : undefined,
    SpeechSynthesisUtterance: withSynthesis
      ? class {
          constructor(text) {
            this.text = text;
            this.lang = "";
            this.rate = 1;
            this.pitch = 1;
            this.volume = 1;
            this.voice = null;
            this.onstart = null;
            this.onend = null;
            this.onerror = null;
          }
        }
      : undefined,
    __TAURI_INTERNALS__: tauri ? {} : undefined
  };

  scope.navigator = {
    userAgent: android
      ? "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/158.0 Mobile Safari/537.36"
      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/158.0"
  };

  return scope;
}

async function loadModule() {
  const source = await readFile(PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: PATH.pathname
  });

  const sandbox = { exports: {}, clearTimeout, setTimeout };
  vm.createContext(sandbox);
  new vm.Script(compiled.outputText, { filename: PATH.pathname }).runInContext(sandbox);
  return sandbox.exports;
}
