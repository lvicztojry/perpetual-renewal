import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as ts from "typescript";

const VOICE_TYPES_PATH = new URL("../src/lib/voice/types.ts", import.meta.url);
const COMPATIBLE_PROVIDER_PATH = new URL("../src/lib/voice/compatible-provider.ts", import.meta.url);
const MOCK_PROVIDER_PATH = new URL("../src/lib/voice/mock-provider.ts", import.meta.url);
const VOICE_PROVIDER_PATH = new URL("../src/lib/voice/provider.ts", import.meta.url);
const USER_VOICE_PROVIDER_PATH = new URL("../src/lib/voice/user-provider.ts", import.meta.url);

const SILENT_WAV_BASE64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
const errors = [];

const voiceModules = await loadVoiceModules();

await testServerEnvSharedLlmFallbackToLlmModel();
await testUserVaultSharedLlmFallbackToVaultModel();
await testProviderFailureFallbackStaysSanitized();

if (errors.length > 0) {
  console.error("Voice shared-LLM smoke failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Voice shared-LLM smoke passed: fake-compatible STT/TTS cover Bearer headers, model fallback, user vault reuse, and sanitized fallbacks."
);

async function testServerEnvSharedLlmFallbackToLlmModel() {
  const fakeKey = "voice-server-env-key-0123456789012345";
  const fallbackModel = "llm-model-used-for-empty-audio-models";
  const server = await startFakeVoiceProvider();

  try {
    await withEnv(
      {
        VOICE_PROVIDER: "shared-llm",
        VOICE_CREDENTIAL_SOURCE: "server-env",
        VOICE_STT_MODEL: "",
        VOICE_TTS_MODEL: "",
        LLM_API_KEY: fakeKey,
        LLM_BASE_URL: server.url,
        LLM_MODEL: fallbackModel,
        VOICE_DEFAULT_VOICE: "soft"
      },
      async () => {
        const provider = voiceModules.provider.createVoiceProvider();
        const transcription = await provider.transcribe({
          audioBase64: SILENT_WAV_BASE64,
          mimeType: "audio/wav",
          fileName: "voice.wav",
          language: "zh-CN"
        });
        const synthesis = await provider.synthesize({
          text: "server env synthesis",
          format: "wav"
        });

        assert(transcription.provider === "shared-llm", "server-env STT should use shared-llm provider");
        assert(transcription.credentialSource === "server-env", "server-env STT should report server-env source");
        assert(transcription.fallback === false, "server-env STT should not fall back when fake provider succeeds");
        assert(transcription.model === fallbackModel, "empty VOICE_STT_MODEL should fall back to LLM_MODEL");
        assert(synthesis.provider === "shared-llm", "server-env TTS should use shared-llm provider");
        assert(synthesis.credentialSource === "server-env", "server-env TTS should report server-env source");
        assert(synthesis.fallback === false, "server-env TTS should not fall back when fake provider succeeds");
        assert(synthesis.model === fallbackModel, "empty VOICE_TTS_MODEL should fall back to LLM_MODEL");
        assert(synthesis.voice === "soft", "TTS should use VOICE_DEFAULT_VOICE when request voice is empty");

        const sttRequest = server.requests.find((request) => request.path === "/audio/transcriptions");
        const ttsRequest = server.requests.find((request) => request.path === "/audio/speech");
        assert(sttRequest?.authorization === `Bearer ${fakeKey}`, "STT should send server LLM key as Bearer header");
        assert(ttsRequest?.authorization === `Bearer ${fakeKey}`, "TTS should send server LLM key as Bearer header");
        assert(
          sttRequest?.body.includes(`name="model"\r\n\r\n${fallbackModel}`),
          "STT multipart body should use LLM_MODEL fallback"
        );
        assert(ttsRequest?.json?.model === fallbackModel, "TTS JSON body should use LLM_MODEL fallback");
      }
    );
  } finally {
    await server.stop();
  }
}

async function testUserVaultSharedLlmFallbackToVaultModel() {
  const vaultKey = "voice-user-vault-key-0123456789012345";
  const vaultModel = "vault-model-used-for-empty-audio-models";
  const server = await startFakeVoiceProvider();

  try {
    await withEnv(
      {
        VOICE_STT_MODEL: "",
        VOICE_TTS_MODEL: "",
        LLM_API_KEY: "server-key-that-should-not-be-used",
        LLM_BASE_URL: "https://server-url-that-should-not-be-used.example.com/v1",
        LLM_MODEL: "server-model-that-should-not-be-used"
      },
      async () => {
        const userProviderModule = await loadUserVoiceProviderModule({
          provider: "compatible",
          apiKey: vaultKey,
          baseUrl: server.url,
          model: vaultModel
        });
        const provider = await userProviderModule.createUserVoiceProvider("user-voice-smoke");

        const transcription = await provider.transcribe({
          audioBase64: SILENT_WAV_BASE64,
          mimeType: "audio/wav",
          fileName: "vault.wav"
        });
        const synthesis = await provider.synthesize({
          text: "vault synthesis",
          voice: "warm",
          format: "mp3"
        });

        assert(transcription.provider === "shared-llm", "user-vault STT should use shared-llm provider");
        assert(transcription.credentialSource === "user-vault", "user-vault STT should report user-vault source");
        assert(transcription.model === vaultModel, "empty VOICE_STT_MODEL should fall back to user vault model");
        assert(synthesis.provider === "shared-llm", "user-vault TTS should use shared-llm provider");
        assert(synthesis.credentialSource === "user-vault", "user-vault TTS should report user-vault source");
        assert(synthesis.model === vaultModel, "empty VOICE_TTS_MODEL should fall back to user vault model");

        const requestText = JSON.stringify(server.requests);
        assert(requestText.includes(`Bearer ${vaultKey}`), "user-vault voice calls should send vault key");
        assert(!requestText.includes("server-key-that-should-not-be-used"), "user-vault voice calls should not use server key");
        assert(!requestText.includes("server-model-that-should-not-be-used"), "user-vault voice calls should not use server model");
      }
    );
  } finally {
    await server.stop();
  }
}

async function testProviderFailureFallbackStaysSanitized() {
  const vaultKey = "voice-failure-vault-key-0123456789012345";
  const failurePrompt = "voice-failure-prompt-should-not-leak";
  const failureRawPayload = "voice-failure-raw-payload-should-not-leak";
  let server;

  server = await startFakeVoiceProvider({
    status: 500,
    responseBody: () =>
      JSON.stringify({
        error: {
          message:
            `Authorization: Bearer ${vaultKey}; endpoint=${server.url}/audio/speech; ` +
            `prompt=${failurePrompt}; rawPayload=${failureRawPayload}`
        }
      })
  });

  try {
    const provider = voiceModules.provider.createVoiceProvider({
      provider: "shared-llm",
      credentialSource: "user-vault",
      apiKey: vaultKey,
      baseUrl: server.url,
      sttModel: "vault-voice-model",
      ttsModel: "vault-voice-model"
    });
    const fallback = await provider.synthesize({
      text: "fallback synthesis",
      format: "mp3"
    });
    const fallbackText = JSON.stringify(fallback);

    assert(fallback.provider === "mock", "provider HTTP failure should fall back to mock voice provider");
    assert(fallback.requestedProvider === "shared-llm", "fallback should preserve sanitized requested provider");
    assert(fallback.credentialSource === "user-vault", "fallback should preserve sanitized credential source");
    assert(fallback.fallback === true, "provider HTTP failure should be marked as fallback");
    assert(fallback.fallbackKind === "provider_response", "500 response should be classified as provider_response");
    assert(fallback.status === 500, "fallback metadata should include safe HTTP status");
    assert(!fallbackText.includes(vaultKey), "fallback result should not expose Bearer key");
    assert(!fallbackText.includes(server.url), "fallback result should not expose provider endpoint");
    assert(!fallbackText.includes(failurePrompt), "fallback result should not expose provider prompt text");
    assert(!fallbackText.includes(failureRawPayload), "fallback result should not expose provider raw payload");
    assert(!fallbackText.includes("Authorization"), "fallback result should not expose provider headers");
  } finally {
    await server.stop();
  }
}

async function startFakeVoiceProvider(options = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyBuffer = Buffer.concat(chunks);
    const body = bodyBuffer.toString("utf8");
    const record = {
      path: request.url,
      method: request.method,
      authorization: request.headers.authorization,
      contentType: request.headers["content-type"],
      body
    };

    if (record.contentType?.includes("application/json")) {
      try {
        record.json = JSON.parse(body);
      } catch {
        record.json = null;
      }
    }

    requests.push(record);

    if (request.url !== "/audio/transcriptions" && request.url !== "/audio/speech") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }

    if (options.status) {
      response.writeHead(options.status, { "content-type": "application/json" });
      response.end(options.responseBody ? options.responseBody(record) : JSON.stringify({ error: "failed" }));
      return;
    }

    if (request.url === "/audio/transcriptions") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ text: "fake transcription", language: "zh-CN", duration: 1.25 }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ audioBase64: SILENT_WAV_BASE64, mimeType: "audio/wav" }));
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  assert(address && typeof address === "object", "fake voice provider should bind to a local port");

  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise((resolveClose) => {
        server.close(() => resolveClose());
      })
  };
}

async function loadVoiceModules() {
  const types = await loadTsModule(VOICE_TYPES_PATH, {
    require(specifier) {
      throw new Error(`Unexpected require while loading voice types: ${specifier}`);
    }
  });
  const compatibleProvider = await loadTsModule(COMPATIBLE_PROVIDER_PATH, {
    require(specifier) {
      if (specifier === "./types") return types;
      throw new Error(`Unexpected require while loading compatible voice provider: ${specifier}`);
    }
  });
  const mockProvider = await loadTsModule(MOCK_PROVIDER_PATH, {
    require(specifier) {
      if (specifier === "./types") return types;
      throw new Error(`Unexpected require while loading mock voice provider: ${specifier}`);
    }
  });
  const provider = await loadTsModule(VOICE_PROVIDER_PATH, {
    require(specifier) {
      if (specifier === "./compatible-provider") return compatibleProvider;
      if (specifier === "./mock-provider") return mockProvider;
      if (specifier === "./types") return types;
      throw new Error(`Unexpected require while loading voice provider: ${specifier}`);
    }
  });

  return { types, compatibleProvider, mockProvider, provider };
}

async function loadUserVoiceProviderModule(credential) {
  return loadTsModule(USER_VOICE_PROVIDER_PATH, {
    require(specifier) {
      if (specifier === "@/lib/credentials") {
        return {
          readDecryptedLlmCredential: async () => credential
        };
      }

      if (specifier === "./provider") return voiceModules.provider;

      throw new Error(`Unexpected require while loading user voice provider: ${specifier}`);
    }
  });
}

async function loadTsModule(path, options) {
  const source = await readFile(path, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: path.pathname
  });

  const sandbox = {
    AbortSignal,
    Blob,
    Buffer,
    DOMException,
    FormData,
    Response,
    console,
    exports: {},
    fetch,
    process,
    require: options.require,
    setTimeout,
    clearTimeout
  };

  vm.createContext(sandbox);
  new vm.Script(transpiled.outputText, { filename: path.pathname }).runInContext(sandbox);
  return sandbox.exports;
}

async function withEnv(overrides, callback) {
  const previous = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];

  try {
    for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}
