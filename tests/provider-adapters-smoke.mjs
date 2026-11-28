import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as ts from "typescript";

const TYPES_PATH = new URL("../src/lib/llm/types.ts", import.meta.url);
const ANTHROPIC_PROVIDER_PATH = new URL("../src/lib/llm/anthropic-provider.ts", import.meta.url);
const GEMINI_PROVIDER_PATH = new URL("../src/lib/llm/gemini-provider.ts", import.meta.url);
const OPENAI_RESPONSES_PROVIDER_PATH = new URL("../src/lib/llm/openai-responses-provider.ts", import.meta.url);
const COMPATIBLE_PROVIDER_PATH = new URL("../src/lib/llm/compatible-chat-provider.ts", import.meta.url);
const MOCK_PROVIDER_PATH = new URL("../src/lib/llm/mock-provider.ts", import.meta.url);
const PROVIDER_FACTORY_PATH = new URL("../src/lib/llm/provider.ts", import.meta.url);
const MODEL_LIST_PATH = new URL("../src/lib/llm/model-list.ts", import.meta.url);
const CONNECTION_TEST_PATH = new URL("../src/lib/llm/connection-test.ts", import.meta.url);
const RESPONSE_SAFETY_PATH = new URL("../src/lib/http/response-safety.ts", import.meta.url);
const SANITIZE_PATH = new URL("../src/lib/logging/sanitize.ts", import.meta.url);

const errors = [];
const modules = await loadLlmModules();

await testAnthropicAdapter();
await testGeminiAdapter();
await testOpenAiResponsesAdapter();
await testDefaultOfficialBaseUrlsDoNotUseCompatibleEnv();
await testConnectionFailureDiagnosticsAreRedacted();

if (errors.length > 0) {
  console.error("Provider adapters smoke failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Provider adapters smoke passed: Anthropic, Gemini, and OpenAI Responses cover hermetic auth, payloads, default base URLs, and redacted failures."
);

async function testAnthropicAdapter() {
  const apiKey = "anthropic-adapter-key-0123456789";
  const model = "claude-smoke-model";
  const server = await startProviderServer((record, response) => {
    assert(record.method === "POST", "Anthropic should POST messages");
    assert(record.path === "/v1/messages", "Anthropic should call /v1/messages");
    assert(record.headers["x-api-key"] === apiKey, "Anthropic should send x-api-key header");
    assert(record.headers["anthropic-version"] === "2024-01-01", "Anthropic should send configured version");
    assert(record.json?.model === model, "Anthropic payload should include model");
    assert(record.json?.max_tokens === 21, "Anthropic payload should map maxTokens to max_tokens");
    assert(record.json?.temperature === 0.2, "Anthropic payload should include temperature");
    assert(record.json?.messages?.[0]?.role === "user", "Anthropic should keep user role in messages");
    assert(record.json?.messages?.[1]?.role === "assistant", "Anthropic should keep assistant role in messages");
    assert(record.json?.system?.[0]?.text === "system seed", "Anthropic should map system messages to system text blocks");

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        model,
        content: [{ type: "text", text: "anthropic fake response" }],
        usage: { input_tokens: 7, output_tokens: 5 }
      })
    );
  });

  try {
    const provider = new modules.anthropic.AnthropicProvider({
      apiKey,
      baseUrl: server.url,
      model,
      version: "2024-01-01"
    });
    const completion = await provider.complete(readCompletionOptions(model));

    assert(completion.content === "anthropic fake response", "Anthropic should parse text response");
    assert(completion.provider === "anthropic", "Anthropic completion should identify provider");
    assert(completion.usage?.totalTokens === 12, "Anthropic should sum input and output usage");
  } finally {
    await server.stop();
  }
}

async function testGeminiAdapter() {
  const apiKey = "gemini-adapter-key-0123456789";
  const model = "gemini-smoke-model";
  const server = await startProviderServer((record, response) => {
    assert(record.method === "POST", "Gemini should POST generateContent");
    assert(record.path === `/models/${model}:generateContent`, "Gemini should call normalized model generateContent path");
    assert(record.url.searchParams.get("key") === apiKey, "Gemini should authenticate with key query param");
    assert(!record.headers.authorization, "Gemini should not send compatible Authorization header");
    assert(record.json?.contents?.[0]?.role === "user", "Gemini should map user role to user");
    assert(record.json?.contents?.[1]?.role === "model", "Gemini should map assistant role to model");
    assert(record.json?.systemInstruction?.parts?.[0]?.text === "system seed", "Gemini should map system instruction");
    assert(record.json?.generationConfig?.temperature === 0.2, "Gemini payload should include temperature");
    assert(record.json?.generationConfig?.maxOutputTokens === 21, "Gemini should map maxTokens to maxOutputTokens");

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        modelVersion: `models/${model}`,
        candidates: [{ content: { parts: [{ text: "gemini fake response" }] } }],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, totalTokenCount: 13 }
      })
    );
  });

  try {
    const provider = new modules.gemini.GeminiProvider({
      apiKey,
      baseUrl: server.url,
      model
    });
    const completion = await provider.complete(readCompletionOptions(model));

    assert(completion.content === "gemini fake response", "Gemini should parse first candidate text");
    assert(completion.provider === "gemini", "Gemini completion should identify provider");
    assert(completion.usage?.totalTokens === 13, "Gemini should expose total usage");
  } finally {
    await server.stop();
  }
}

async function testOpenAiResponsesAdapter() {
  const apiKey = "openai-responses-adapter-key-0123456789";
  const model = "gpt-responses-smoke-model";
  const server = await startProviderServer((record, response) => {
    assert(record.method === "POST", "OpenAI Responses should POST responses");
    assert(record.path === "/responses", "OpenAI Responses should call /responses on the configured base URL");
    assert(record.headers.authorization === `Bearer ${apiKey}`, "OpenAI Responses should send Bearer header");
    assert(record.json?.model === model, "OpenAI Responses payload should include model");
    assert(record.json?.input?.[0]?.role === "system", "OpenAI Responses should preserve system input role");
    assert(record.json?.input?.[1]?.role === "user", "OpenAI Responses should preserve user input role");
    assert(record.json?.input?.[2]?.role === "assistant", "OpenAI Responses should preserve assistant input role");
    assert(record.json?.max_output_tokens === 21, "OpenAI Responses should map maxTokens to max_output_tokens");
    assert(record.json?.temperature === 0.2, "OpenAI Responses payload should include temperature");

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "resp_smoke",
        model,
        output_text: "openai responses fake response",
        usage: { input_tokens: 8, output_tokens: 6, total_tokens: 14 }
      })
    );
  });

  try {
    const provider = new modules.openAiResponses.OpenAiResponsesProvider({
      apiKey,
      baseUrl: server.url,
      model
    });
    const completion = await provider.complete(readCompletionOptions(model));

    assert(completion.content === "openai responses fake response", "OpenAI Responses should parse output_text");
    assert(completion.provider === "openai-responses", "OpenAI Responses completion should identify provider");
    assert(completion.usage?.totalTokens === 14, "OpenAI Responses should expose total usage");
  } finally {
    await server.stop();
  }
}

async function testDefaultOfficialBaseUrlsDoNotUseCompatibleEnv() {
  const compatibleBaseUrl = "https://compatible-env-that-must-not-be-used.example.com/v1";
  const cases = [
    {
      provider: "anthropic",
      apiKey: "default-anthropic-key-0123456789",
      model: "claude-default-smoke",
      expectedUrl: "https://api.anthropic.com/v1/messages",
      responseBody: {
        model: "claude-default-smoke",
        content: [{ type: "text", text: "default anthropic ok" }]
      }
    },
    {
      provider: "gemini",
      apiKey: "default-gemini-key-0123456789",
      model: "gemini-default-smoke",
      expectedUrlPrefix:
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-default-smoke:generateContent?key=",
      responseBody: {
        candidates: [{ content: { parts: [{ text: "default gemini ok" }] } }]
      }
    },
    {
      provider: "openai-responses",
      apiKey: "default-openai-key-0123456789",
      model: "gpt-default-smoke",
      expectedUrl: "https://api.openai.com/v1/responses",
      responseBody: {
        model: "gpt-default-smoke",
        output_text: "default openai responses ok"
      }
    }
  ];

  for (const item of cases) {
    const requests = [];
    const factory = await loadLlmModules({
      fetch: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method,
          headers: normalizeHeaders(init?.headers)
        });
        return new Response(JSON.stringify(item.responseBody), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    await withEnv(
      {
        LLM_BASE_URL: compatibleBaseUrl
      },
      async () => {
        const provider = factory.providerFactory.createLlmProvider({
          provider: item.provider,
          apiKey: item.apiKey,
          model: item.model
        });
        await provider.complete(readCompletionOptions(item.model));
      }
    );

    const request = requests[0];
    assert(request, `${item.provider} should issue a request with stub fetch`);
    assert(!request?.url.includes(compatibleBaseUrl), `${item.provider} should not use compatible LLM_BASE_URL`);
    if (item.expectedUrl) {
      assert(request?.url === item.expectedUrl, `${item.provider} should use official default base URL`);
    } else {
      assert(
        request?.url.startsWith(item.expectedUrlPrefix),
        `${item.provider} should use official default Gemini base URL`
      );
    }
  }
}

async function testConnectionFailureDiagnosticsAreRedacted() {
  const secretKey = "provider-diagnostic-key-0123456789";
  const secretEndpoint = "https://api.anthropic.com/v1/messages";
  const secretPrompt = "provider diagnostic prompt must not leak";
  const secretRawPayload = "provider diagnostic raw payload must not leak";
  const secretStack = "provider diagnostic stack must not leak";
  const server = await startProviderServer((_record, response) => {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: {
          message:
            `Authorization: Bearer ${secretKey}; endpoint=${secretEndpoint}; ` +
            `prompt=${secretPrompt}; rawPayload=${secretRawPayload}; stack=${secretStack}`
        }
      })
    );
  });

  try {
    const result = await withEnv(
      {
        LLM_API_KEY: secretKey
      },
      () =>
        modules.connectionTest.testLlmConnection("provider-adapters-smoke-user", {
          provider: "anthropic",
          baseUrl: server.url,
          model: "claude-failure-smoke"
        })
    );
    const resultText = JSON.stringify(result);

    assert(result.ok === false, "connection failure smoke should fail when fake provider returns 500");
    assert(result.errorType === "provider_response", "500 should be classified as provider_response");
    assert(result.httpStatus === 500, "connection failure should include safe HTTP status");
    assert(!resultText.includes(secretKey), "connection diagnostics should not expose API key");
    assert(!resultText.includes(secretEndpoint), "connection diagnostics should not expose endpoint");
    assert(!resultText.includes(secretPrompt), "connection diagnostics should not expose prompt");
    assert(!resultText.includes(secretRawPayload), "connection diagnostics should not expose raw payload");
    assert(!resultText.includes(secretStack), "connection diagnostics should not expose stack");
    assert(!resultText.includes("Authorization"), "connection diagnostics should not expose Authorization header name");
  } finally {
    await server.stop();
  }
}

function readCompletionOptions(model) {
  return {
    model,
    temperature: 0.2,
    maxTokens: 21,
    messages: [
      { role: "system", content: "system seed" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "prior reply" }
    ]
  };
}

async function startProviderServer(handler) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const record = {
      method: request.method,
      path: url.pathname,
      url,
      headers: request.headers,
      body,
      json: safeJsonParse(body)
    };
    requests.push(record);
    handler(record, response);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert(address && typeof address === "object", "fake provider should bind to a local port");

  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      })
  };
}

async function loadLlmModules(overrides = {}) {
  const sandboxFetch = overrides.fetch ?? fetch;
  const types = await loadTsModule(TYPES_PATH, {
    fetch: sandboxFetch,
    require(specifier) {
      throw new Error(`Unexpected require while loading llm types: ${specifier}`);
    }
  });
  const anthropic = await loadTsModule(ANTHROPIC_PROVIDER_PATH, {
    fetch: sandboxFetch,
    require(specifier) {
      if (specifier === "./types") return types;
      throw new Error(`Unexpected require while loading anthropic provider: ${specifier}`);
    }
  });
  const gemini = await loadTsModule(GEMINI_PROVIDER_PATH, {
    fetch: sandboxFetch,
    require(specifier) {
      if (specifier === "./types") return types;
      throw new Error(`Unexpected require while loading gemini provider: ${specifier}`);
    }
  });
  const openAiResponses = await loadTsModule(OPENAI_RESPONSES_PROVIDER_PATH, {
    fetch: sandboxFetch,
    require(specifier) {
      if (specifier === "./types") return types;
      throw new Error(`Unexpected require while loading OpenAI Responses provider: ${specifier}`);
    }
  });
  const compatible = await loadTsModule(COMPATIBLE_PROVIDER_PATH, {
    fetch: sandboxFetch,
    require(specifier) {
      if (specifier === "./types") return types;
      throw new Error(`Unexpected require while loading compatible provider: ${specifier}`);
    }
  });
  const mock = await loadTsModule(MOCK_PROVIDER_PATH, {
    fetch: sandboxFetch,
    require(specifier) {
      if (specifier === "./types") return types;
      if (specifier === "@/lib/usage/tokens") return { estimateTokenCount: (text) => Math.max(1, Math.ceil(String(text).length / 4)) };
      throw new Error(`Unexpected require while loading mock provider: ${specifier}`);
    }
  });
  const providerFactory = await loadTsModule(PROVIDER_FACTORY_PATH, {
    fetch: sandboxFetch,
    require(specifier) {
      if (specifier === "./anthropic-provider") return anthropic;
      if (specifier === "./compatible-chat-provider") return compatible;
      if (specifier === "./gemini-provider") return gemini;
      if (specifier === "./mock-provider") return mock;
      if (specifier === "./openai-responses-provider") return openAiResponses;
      if (specifier === "./types") return types;
      throw new Error(`Unexpected require while loading provider factory: ${specifier}`);
    }
  });
  const sanitize = await loadTsModule(SANITIZE_PATH, {
    fetch: sandboxFetch,
    require(specifier) {
      throw new Error(`Unexpected require while loading sanitize: ${specifier}`);
    }
  });
  const responseSafety = await loadTsModule(RESPONSE_SAFETY_PATH, {
    fetch: sandboxFetch,
    require(specifier) {
      if (specifier === "@/lib/logging/sanitize") return sanitize;
      throw new Error(`Unexpected require while loading response safety: ${specifier}`);
    }
  });
  const modelList = await loadTsModule(MODEL_LIST_PATH, {
    fetch: sandboxFetch,
    require(specifier) {
      if (specifier === "@/lib/credentials") {
        return { readDecryptedLlmCredential: async () => null };
      }
      throw new Error(`Unexpected require while loading model list: ${specifier}`);
    }
  });
  const connectionTest = await loadTsModule(CONNECTION_TEST_PATH, {
    fetch: sandboxFetch,
    require(specifier) {
      if (specifier === "@/lib/credentials") {
        return { readDecryptedLlmCredential: async () => null };
      }
      if (specifier === "./provider") return providerFactory;
      if (specifier === "./types") return types;
      if (specifier === "./model-list") return modelList;
      if (specifier === "@/lib/http/response-safety") return responseSafety;
      throw new Error(`Unexpected require while loading connection test: ${specifier}`);
    }
  });

  return {
    anthropic,
    gemini,
    openAiResponses,
    providerFactory,
    connectionTest
  };
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
    Buffer,
    DOMException,
    Response,
    URL,
    clearTimeout,
    console,
    exports: {},
    fetch: options.fetch,
    process,
    require: options.require,
    setTimeout
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

function normalizeHeaders(headers) {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}
