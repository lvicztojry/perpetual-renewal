import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/voice/native-speech.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020
} }).outputText;
const prefix = "plugin:renewal-speech|";
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(fakeInvoke, { android = true, tauri = true } = {}) {
  const calls = [], timers = new Map();
  let timerId = 0;
  const internals = {
    invoke(command, args) {
      assert.equal(this, internals, "bridge receiver preserved");
      calls.push({ command, args });
      return fakeInvoke(command.slice(prefix.length), args);
    }
  };
  const scope = {
    __TAURI_INTERNALS__: tauri ? internals : undefined,
    navigator: { userAgent: android ? "Android 14" : "Windows" }
  };
  const sandbox = {
    exports: {}, window: scope,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    require(name) { throw Error(`No imports allowed: ${name}`); }
  };
  vm.runInNewContext(compiled, sandbox);
  return { ...sandbox.exports, scope, calls, timers,
    timeout() { for (const fn of [...timers.values()]) fn(); }
  };
}
function commands(env) { return env.calls.map((call) => call.command.slice(prefix.length)); }

// The default window path uses the same bridge as production, with no imports.
assert.doesNotMatch(compiled, /\bimport\s*\(|require\(/);
{
  const env = setup(async () => ({ ok: true }));
  let starts = 0, ends = 0;
  const handle = env.speakNativeText("  你好  ", {
    lang: "zh-CN", rate: 9, onStart() { starts++; }, onEnd() { ends++; }
  });
  assert.equal((await handle.done).ok, true);
  assert.equal(env.calls[0].args.options.text, "你好");
  assert.equal(env.calls[0].args.options.rate, 2);
  assert.deepEqual(commands(env), ["speech_speak"]);
  assert.equal(starts, 1); assert.equal(ends, 1); assert.equal(env.timers.size, 0);
  handle.stop(); assert.equal(env.calls.length, 1);
}
for (const config of [{ android: false }, { tauri: false }]) {
  const env = setup(async () => { throw Error("must not invoke"); }, config);
  assert.equal(env.speakNativeText("hello"), null);
  assert.equal(env.startNativeSpeech(), null);
  assert.equal(await env.isNativeSpeechAvailable(), false);
}
{
  const env = setup(async () => ({ available: true }));
  assert.equal(await env.isNativeSpeechAvailable(), true);
  assert.equal(env.speakNativeText("  "), null);
  env.scope.__TAURI_INTERNALS__ = {};
  assert.equal((await env.speakNativeText("hello").done).errorType, "unavailable");
  assert.equal(env.timers.size, 0);
}
for (const errorType of ["unavailable", "language-unavailable", "denied", "not-allowed", "cancelled"]) {
  for (const reject of [false, true]) {
    const env = setup(async () => {
      const value = { ok: false, error: "设备错误", errorType };
      if (reject) throw value;
      return value;
    });
    for (const handle of [env.speakNativeText("hello"), env.startNativeSpeech()]) {
      const result = await handle.done;
      assert.equal(result.ok, false); assert.equal(result.errorType, errorType);
      assert.equal(result.error, errorType === "cancelled" ? "" : "设备错误");
    }
    assert.equal(env.timers.size, 0);
  }
}
{
  const env = setup(async () => ({ available: false, errorType: "language-unavailable", error: "缺少中文语音数据" }));
  const result = await env.getNativeTtsAvailability({ lang: "zh-CN" });
  assert.equal(result.available, false);
  assert.equal(result.errorType, "language-unavailable");
  assert.equal(result.error, "缺少中文语音数据");
  assert.equal(env.calls[0].args.options.lang, "zh-CN");
  assert.deepEqual(commands(env), ["speech_is_speech_available"]);
}
// Cancellation before loadInvoke resumes cannot start or cancel another session.
for (const tts of [false, true]) {
  const env = setup(async () => { throw Error("must not start"); });
  const handle = tts ? env.speakNativeText("hello") : env.startNativeSpeech();
  (tts ? handle.stop : handle.cancel)();
  assert.equal((await handle.done).errorType, "cancelled");
  await tick(); assert.deepEqual(commands(env), []); assert.equal(env.timers.size, 0);
}
// stop is idempotent, its ACK is not the transcript; done preserves recognized text.
{
  const pending = deferred();
  const env = setup((command) => command === "speech_recognize" ? pending.promise : Promise.resolve({}));
  const handle = env.startNativeSpeech(); await tick(); handle.stop(); handle.stop();
  let settled = false; void handle.done.then(() => { settled = true; }); await tick();
  assert.equal(settled, false);
  pending.resolve({ ok: true, text: "  用户草稿  " });
  assert.equal((await handle.done).text, "用户草稿");
  assert.deepEqual(commands(env), ["speech_recognize", "speech_stop"]);
  assert.equal(env.timers.size, 0);
}
// Stop before dispatch also prevents a late microphone start.
{
  const env = setup(async () => { throw Error("must not start"); });
  const handle = env.startNativeSpeech(); handle.stop();
  assert.equal((await handle.done).errorType, "no-speech");
  await tick(); assert.equal(env.calls.length, 0);
}
for (const tts of [false, true]) {
  const pending = deferred();
  const startCommand = tts ? "speech_speak" : "speech_recognize";
  const cancelCommand = tts ? "speech_cancel_speech" : "speech_cancel";
  const env = setup((command) => command === startCommand ? pending.promise : Promise.resolve({}));
  const handle = tts ? env.speakNativeText("hello") : env.startNativeSpeech();
  await tick(); (tts ? handle.stop : handle.cancel)();
  assert.equal((await handle.done).errorType, "cancelled");
  pending.resolve({ ok: true, text: "late result must be ignored" }); await tick();
  assert.deepEqual(commands(env), [startCommand, cancelCommand]);
  assert.equal(env.timers.size, 0);
}
// Timeout dispatches native cleanup exactly once and ignores late results.
for (const tts of [false, true]) {
  const pending = deferred();
  const startCommand = tts ? "speech_speak" : "speech_recognize";
  const env = setup((command) => command === startCommand ? pending.promise : Promise.resolve({}));
  const handle = tts ? env.speakNativeText("hello", { timeoutMs: 5 }) : env.startNativeSpeech({ timeoutMs: 5 });
  await tick(); env.timeout();
  assert.equal((await handle.done).errorType, "timeout");
  assert.deepEqual(commands(env), [startCommand, tts ? "speech_cancel_speech" : "speech_cancel"]);
  pending.reject({ errorType: "cancelled" }); await tick();
  assert.equal(env.timers.size, 0);
}
// Late failure from an old stop must not cancel a newer recognition.
{
  const stop = deferred();
  const env = setup((command) => command === "speech_stop" ? stop.promise : new Promise(() => {}));
  const old = env.startNativeSpeech(); await tick(); old.stop(); old.cancel();
  const current = env.startNativeSpeech(); await tick();
  const count = env.calls.length;
  stop.reject({ errorType: "denied" }); await tick();
  assert.equal(env.calls.length, count);
  current.cancel(); await current.done;
}
// Full IPC names in Rust, build ACL and default grants must agree.
{
  const rust = readFileSync(new URL("../native/src-tauri/src/speech.rs", import.meta.url), "utf8");
  const build = readFileSync(new URL("../native/src-tauri/build.rs", import.meta.url), "utf8");
  const permissions = readFileSync(new URL("../native/src-tauri/permissions/renewal-speech/default.toml", import.meta.url), "utf8");
  for (const name of ["speech_is_available", "speech_recognize", "speech_cancel", "speech_stop", "speech_speak", "speech_cancel_speech", "speech_is_speech_available"]) {
    assert.match(rust, new RegExp(`async fn ${name}\\b`));
    assert.ok(build.includes(`"${name}"`), `build declares ${name}`);
    assert.ok(permissions.includes(`"allow-${name.replaceAll("_", "-")}"`), `default grants ${name}`);
  }
  for (const name of ["stop", "speak", "cancelSpeech", "isSpeechAvailable"]) assert.ok(rust.includes(`"${name}"`));
}
// Execute the Vite production bundle through its actual default window bridge.
{
  const { build } = await import("../native/node_modules/vite/dist/node/index.js");
  const built = await build({ configFile: false, logLevel: "error", build: {
    write: false, minify: true,
    lib: { entry: fileURLToPath(new URL("../src/lib/voice/native-speech.ts", import.meta.url)), formats: ["es"] }
  } });
  const outputs = Array.isArray(built) ? built : [built];
  const code = outputs.flatMap((item) => item.output).find((item) => item.type === "chunk").code;
  assert.doesNotMatch(code, /\bimport\s*\(/);
  const api = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  const calls = [];
  globalThis.window = { navigator: { userAgent: "Android" }, __TAURI_INTERNALS__: {
    async invoke(command) {
      calls.push(command);
      return { ok: false, errorType: "unavailable", error: "没有系统引擎" };
    }
  } };
  try {
    const result = await api.speakNativeText("你好").done;
    assert.equal(result.errorType, "unavailable");
    assert.deepEqual(calls, [prefix + "speech_speak"]);
  } finally { delete globalThis.window; }
}
console.log("Native playback/stop passed: fakeInvoke Vite production bridge, errors, cancellation races, final transcript, timeout cleanup, IPC/ACL contract.");
