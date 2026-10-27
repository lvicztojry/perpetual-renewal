import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { after, test } from "node:test";
import vm from "node:vm";
import * as ts from "typescript";

const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff, 0x80]);
const requests = [];
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.url, "/v1/audio/transcriptions");
    assert.equal(request.method, "POST");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const form = await new Request("http://fixture.invalid", {
      method: "POST",
      headers: { "Content-Type": request.headers["content-type"] },
      body: Buffer.concat(chunks)
    }).formData();
    const file = form.get("file");
    requests.push({
      authorization: request.headers.authorization,
      language: form.get("language"),
      model: form.get("model"),
      fileName: file.name,
      mimeType: file.type,
      audio: Buffer.from(await file.arrayBuffer())
    });

    // Model a gateway that requires a language code rather than a browser locale.
    const language = form.get("language");
    if (language !== null && !/^[a-z]{2,3}$/.test(language)) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Unsupported language code" }));
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ text: "Actual recorded words", duration: 0.75 }));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: String(error) }));
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
after(() => new Promise((resolve) => server.close(resolve)));

const modules = {};
for (const name of ["types", "compatible-provider", "mock-provider", "provider"]) {
  modules[`./${name}`] = await loadModule(name);
}
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const fixtures = [
  { language: "zh-CN", expected: "zh" },
  { language: "en-US", expected: "en" },
  { language: "sr-Latn-RS", expected: "sr" },
  { language: " EN-gb ", expected: "en" },
  { language: "zh", expected: "zh" },
  { language: "yue", expected: "yue" },
  { language: undefined, expected: null },
  { language: "   ", expected: null }
];

for (const providerName of ["shared-llm", "compatible"]) {
  for (const { language, expected } of fixtures) {
    test(`${providerName}: browser language ${JSON.stringify(language)} reaches the gateway as ${expected}`, async () => {
      const provider = modules["./provider"].createVoiceProvider({
        provider: providerName,
        credentialSource: "user-vault",
        apiKey: "fixture-voice-key",
        baseUrl,
        sttModel: "fixture-transcription-model",
        ttsModel: "fixture-speech-model"
      });
      const before = requests.length;
      const result = await provider.transcribe({
        audioBase64: audio.toString("base64"),
        mimeType: "audio/webm;codecs=opus",
        fileName: "voice-input.webm",
        language
      });

      assert.equal(requests.length, before + 1);
      const sent = requests.at(-1);
      assert.equal(sent.language, expected);
      assert.equal(sent.authorization, "Bearer " + "fixture-voice-key");
      assert.equal(sent.model, "fixture-transcription-model");
      assert.equal(sent.fileName, "voice-input.webm");
      assert.equal(sent.mimeType, "audio/webm;codecs=opus");
      assert.deepEqual(sent.audio, audio);
      assert.equal(result.text, "Actual recorded words", "recorded words must not become canned mock text");
      assert.equal(result.provider, providerName);
      assert.equal(result.requestedProvider, providerName);
      assert.equal(result.credentialSource, "user-vault");
      assert.equal(result.fallback, false);
      assert.equal(result.durationMs, 750);
      assert.equal(result.language, language, "outgoing normalization must preserve caller metadata");
    });
  }
}

async function loadModule(name) {
  const path = new URL(`../src/lib/voice/${name}.ts`, import.meta.url);
  const source = await readFile(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.pathname
  });
  const sandbox = {
    AbortSignal,
    Blob,
    Buffer,
    DOMException,
    FormData,
    fetch,
    // Exercise adapters without reading local credentials or environment values.
    process: { env: {} },
    exports: {},
    require(specifier) {
      assert.ok(Object.hasOwn(modules, specifier), `Unexpected import: ${specifier}`);
      return modules[specifier];
    }
  };
  vm.createContext(sandbox);
  new vm.Script(compiled.outputText, { filename: path.pathname }).runInContext(sandbox);
  return sandbox.exports;
}
