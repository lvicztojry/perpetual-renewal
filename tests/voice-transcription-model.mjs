import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { after, test } from "node:test";
import vm from "node:vm";
import * as ts from "typescript";

// Synthetic recorded-audio bytes, including non-ASCII bytes. No env files, real
// credentials, speech services or paid requests are used by this suite.
const audio = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32, 0, 255, 128, 1]);
const requests = [];
let mode = 200;
const secret = "fixture-key-must-not-leak";
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, "/v1/audio/transcriptions");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const form = await new Request("http://fixture.invalid", {
      method: "POST", headers: { "content-type": req.headers["content-type"] }, body: Buffer.concat(chunks)
    }).formData();
    const file = form.get("file");
    requests.push({ model: form.get("model"), language: form.get("language"),
      name: file.name, type: file.type, audio: Buffer.from(await file.arrayBuffer()),
      authorization: req.headers.authorization });
    res.writeHead(typeof mode === "number" ? mode : 200, { "content-type": "application/json" });
    res.end(mode === "invalid-json" ? "not json" : JSON.stringify(mode === "empty" ? { text: " " } : mode === 200
      ? { text: "录音识别的原文", duration: 1.25 }
      : { error: `${secret} raw-upstream-private-body` }));
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
after(() => new Promise(resolve => server.close(resolve)));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const saved = { provider: "compatible", apiKey: secret, baseUrl, model: "selected-chat-model" };
let credential = saved;
const env = { VOICE_PROVIDER: "shared-llm" };

async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true }
  });
  const context = vm.createContext({ exports: {}, Buffer, Blob, FormData, Request, Response, Headers,
    AbortSignal, DOMException, ReadableStream, Uint8Array, console, process: { env },
    fetch: (...args) => transport(...args),
    require: name => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name]; },
    ...globals });
  new vm.Script(compiled.outputText, { filename: path }).runInContext(context);
  return context.exports;
}

// Execute the installed Tauri plugin's actual FormData serialization. Stub only
// the native IPC boundary, forwarding its bytes/headers to our loopback gateway.
const pending = new Map();
let rid = 0;
const nativeHttp = await load("../native/node_modules/@tauri-apps/plugin-http/dist-js/index.js", {
  "@tauri-apps/api/core": { invoke: async (command, args, options) => {
    if (command === "plugin:http|fetch") {
      const config = JSON.parse(decodeURIComponent(options.headers["client-config"]));
      assert.equal(new URL(config.url).origin, new URL(baseUrl).origin, "only loopback traffic is allowed");
      const id = ++rid;
      pending.set(id, { config, bytes: args });
      return id;
    }
    if (command === "plugin:http|fetch_send") {
      const { config, bytes } = pending.get(args.rid);
      const response = await fetch(config.url, { method: config.method, headers: config.headers, body: bytes });
      pending.set(args.rid, { bytes: new Uint8Array(await response.arrayBuffer()), sent: false });
      return { status: response.status, statusText: response.statusText, url: config.url,
        headers: [...response.headers], rid: args.rid };
    }
    if (command === "plugin:http|fetch_read_body") {
      const body = pending.get(args.rid);
      if (body.sent) { pending.delete(args.rid); return [1]; }
      body.sent = true;
      return [...body.bytes, 0];
    }
    if (command === "plugin:http|fetch_cancel_body" || command === "plugin:http|fetch_cancel") {
      pending.delete(args.rid); return;
    }
    assert.fail(`Unexpected native IPC: ${command}`);
  } }
});
let transport = nativeHttp.fetch;
const modules = {};
for (const name of ["types", "compatible-provider", "mock-provider", "provider"]) {
  modules[`./${name}`] = await load(`../src/lib/voice/${name}.ts`, {
    ...modules, "./edge-tts-provider": { EdgeTtsVoiceProvider: class UnusedEdge {} }
  });
}
const userProvider = await load("../src/lib/voice/user-provider.ts", {
  "@/lib/credentials": { readDecryptedLlmCredential: async () => credential }, "./provider": modules["./provider"]
});
const json = await load("../src/lib/http/json.ts");
const sanitizer = await load("../src/lib/logging/sanitize.ts");
const safety = await load("../src/lib/http/response-safety.ts", { "@/lib/logging/sanitize": sanitizer });
const route = await load("../src/app/api/voice/transcribe/route.ts", {
  "@/lib/http/private-response": { privateJson: Response.json.bind(Response) },
  "@/lib/http/persistence-errors": { persistenceUnavailableResponse: () => null },
  "@/lib/http/response-safety": safety,
  "@/lib/auth/session": { getCurrentSession: async () => ({ userId: "fixture-user" }) },
  "@/lib/http/json": json, "@/lib/voice/user-provider": userProvider, "@/lib/voice/types": modules["./types"]
});
const input = { audioBase64: audio.toString("base64"), mimeType: "audio/mp4", fileName: "recording.m4a", language: "zh-CN" };
async function call(body = input) {
  const response = await route.POST(new Request("https://local.renewal.invalid/api/voice/transcribe", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }
  }));
  return { status: response.status, body: await response.json() };
}

test("route forwards recorded audio, chosen STT model, and vault key through actual Tauri multipart serializer", async () => {
  const result = await call({ ...input, sttModel: "  whisper-1  " });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.text, "录音识别的原文");
  assert.equal(result.body.model, "whisper-1");
  assert.equal(result.body.durationMs, 1250);
  assert.equal(result.body.credentialSource, "user-vault");
  assert.equal(result.body.fallback, false);
  assert.deepEqual(requests.at(-1), { model: "whisper-1", language: "zh", name: "recording.m4a",
    type: "audio/mp4", audio, authorization: `Bearer ${secret}` });
  assert.equal(saved.model, "selected-chat-model", "request override must not mutate saved chat model");
  const provider = await userProvider.createUserVoiceProvider("fixture-user", { sttModel: "whisper-1" });
  let ttsBody;
  transport = async (_url, init) => { ttsBody = JSON.parse(init.body); return new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }); };
  try { await provider.synthesize({ text: "test" }); } finally { transport = nativeHttp.fetch; }
  assert.equal(ttsBody.model, saved.model, "STT override must not override TTS model");
});

test("existing callers retain configured model precedence without a request override", async () => {
  assert.equal((await call()).body.model, saved.model);
  env.VOICE_STT_MODEL = "env-stt-model";
  try {
    assert.equal((await call()).body.model, "env-stt-model");
    assert.equal((await call({ ...input, sttModel: "request-stt-model" })).body.model, "request-stt-model");
  } finally { delete env.VOICE_STT_MODEL; }
});

test("override works with compatible alias, Edge synthesis, and configured server gateway", async () => {
  credential = { ...saved, provider: "openai-compatible" };
  env.VOICE_PROVIDER = "edge";
  try {
    assert.equal((await call({ ...input, sttModel: "alias-stt-model" })).body.model, "alias-stt-model");
    credential = null;
    Object.assign(env, { LLM_API_KEY: secret, LLM_BASE_URL: baseUrl, LLM_MODEL: "server-chat-model" });
    assert.equal((await call({ ...input, sttModel: "server-stt-model" })).body.model, "server-stt-model");
  } finally {
    credential = saved;
    env.VOICE_PROVIDER = "shared-llm";
    for (const key of ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"]) delete env[key];
  }
});

test("invalid STT overrides fail validation before contacting the gateway", async () => {
  const before = requests.length;
  for (const sttModel of ["", "   ", "a".repeat(121), "bad\nmodel", "bad\u0000model", "bad\u007fmodel", "bad\u0085model", 17, null, {}, []]) {
    assert.equal((await call({ ...input, sttModel })).status, 400, JSON.stringify(sttModel));
  }
  assert.equal(requests.length, before);
  assert.equal((await call({ ...input, sttModel: "a".repeat(120) })).status, 200);
});

test("unsupported/auth/rate-limit/empty responses fail safely and never echo mock text", async () => {
  for (const status of [400, 404, 405, 422, 501, 401, 403, 429, 503, "empty", "invalid-json"]) {
    mode = status;
    const result = await call({ ...input, sttModel: "whisper-1", mockTranscript: "fake-success-must-not-appear" });
    assert.equal(result.status, 502, JSON.stringify(result));
    assert.equal(result.body.errorType, "voice_transcription_unavailable");
    assert.equal(result.body.text, undefined);
    const serialized = JSON.stringify(result.body);
    for (const forbidden of [secret, baseUrl, "raw-upstream-private-body", "fake-success-must-not-appear"]) assert.ok(!serialized.includes(forbidden));
    if ([400, 404, 405, 422, 501].includes(status)) {
      assert.match(result.body.error, /模型.*audio\/transcriptions/);
      assert.equal(result.body.retryable, false);
      assert.equal(result.body.status, status);
    }
    if (status === 401 || status === 403) assert.equal(result.body.fallbackKind, "authentication");
    if (status === 429) { assert.equal(result.body.fallbackKind, "rate_limit"); assert.equal(result.body.retryable, true); }
  }
  mode = 200;
});

test("missing/unsupported credentials cannot become successful mock transcripts", async () => {
  const before = requests.length;
  for (const value of [null, { ...saved, provider: "anthropic" }, { ...saved, model: undefined }]) {
    credential = value;
    try {
      const result = await call({ ...input, mockTranscript: "fake-success-must-not-appear" });
      assert.equal(result.status, 502);
      assert.match(result.body.error, /配置/);
      assert.equal(result.body.retryable, false);
      assert.equal(result.body.text, undefined);
    } finally { credential = saved; }
  }
  assert.equal(requests.length, before);
});

test("transport failures return classified safe errors", async () => {
  transport = async () => { throw new Error(`${secret} ${baseUrl}`); };
  try {
    const result = await call({ ...input, sttModel: "whisper-1" });
    assert.equal(result.status, 502);
    assert.equal(result.body.fallbackKind, "network");
    assert.equal(result.body.retryable, true);
    assert.match(result.body.error, /网络/);
    assert.ok(!JSON.stringify(result).includes(secret));
  } finally { transport = nativeHttp.fetch; }
});
