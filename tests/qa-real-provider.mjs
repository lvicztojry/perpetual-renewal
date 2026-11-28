import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createNetServer } from "node:net";
import { loadLocalEnv } from "../scripts/load-local-env.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 3220;
const START_TIMEOUT_MS = 90_000;
const OVERALL_TIMEOUT_MS = readPositiveInteger(process.env.REAL_PROVIDER_TIMEOUT_MS, 180_000);
const TEST_MESSAGE = "真实供应商联调：请用一句温柔、自然、不带 Markdown 星号的中文回复我。";
const ACCOUNT_DELETE_CONFIRMATION = "删除我的账号";

loadLocalEnv();

const config = {
  enabled: process.env.REAL_PROVIDER_QA === "1",
  provider: (process.env.REAL_LLM_PROVIDER || "compatible").trim(),
  apiKey: (process.env.REAL_LLM_API_KEY || "").trim(),
  baseUrl: (process.env.REAL_LLM_BASE_URL || process.env.LLM_BASE_URL || "").trim(),
  model: (process.env.REAL_LLM_MODEL || process.env.LLM_MODEL || "").trim(),
  existingBaseUrl: (process.env.REAL_QA_BASE_URL || process.env.REAL_PROVIDER_BASE_URL || "").trim(),
  port: readPositiveInteger(process.env.REAL_QA_PORT || process.env.REAL_PROVIDER_PORT, DEFAULT_PORT),
  requireModels: process.env.REAL_PROVIDER_REQUIRE_MODELS === "1",
  keepQaAccount: process.env.REAL_PROVIDER_KEEP_QA_ACCOUNT === "1",
  forceNewServer: process.env.REAL_PROVIDER_FORCE_NEW_SERVER === "1"
};

const redactionValues = [
  config.apiKey,
  config.baseUrl,
  config.baseUrl.replace(/\/+$/, ""),
  encodeURIComponent(config.baseUrl),
  process.env.LLM_API_KEY,
  process.env.OPENAI_API_KEY,
  process.env.ANTHROPIC_API_KEY,
  process.env.GEMINI_API_KEY,
  process.env.GOOGLE_API_KEY
].filter(Boolean);

let serverProcess;
let serverExited = false;
let rootUrl = config.existingBaseUrl;
let exitCode = 1;
const serverOutput = [];
const client = createRequestClient();

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

const timeout = setTimeout(() => {
  console.error(`Real provider QA timed out after ${OVERALL_TIMEOUT_MS}ms.`);
  printServerOutput();
  cleanup().finally(() => process.exit(1));
}, OVERALL_TIMEOUT_MS);

try {
  validateConfig();

  if (!rootUrl && !config.forceNewServer) {
    rootUrl = await findExistingLocalApp();
    if (rootUrl) {
      console.log(`Real provider QA reusing existing local app at ${rootUrl}.`);
    }
  }

  if (!rootUrl) {
    const port = await findAvailablePort(config.port);
    rootUrl = `http://127.0.0.1:${port}`;
    serverProcess = startDevServer(port);
    await waitForServer(rootUrl);
  } else {
    await waitForServer(rootUrl);
  }

  await runRealProviderFlow();
  exitCode = 0;
  console.log("Real provider QA passed: BYOK vault, model diagnostics, chat completion, and usage logging are working.");
} catch (error) {
  console.error("Real provider QA failed:");
  console.error(redact(error instanceof Error ? error.message : String(error)));
  printServerOutput();
} finally {
  clearTimeout(timeout);
  await cleanup();
}

process.exit(exitCode);

function validateConfig() {
  if (!config.enabled) {
    throw new Error("Set REAL_PROVIDER_QA=1 to run this opt-in real provider QA script.");
  }

  if (config.provider !== "compatible" && config.provider !== "openai-compatible") {
    throw new Error("REAL_LLM_PROVIDER must be compatible or openai-compatible for this QA script.");
  }

  if (!config.apiKey) {
    throw new Error("REAL_LLM_API_KEY is required. Do not put the key in source control.");
  }

  if (!config.baseUrl || !/^https?:\/\//i.test(config.baseUrl)) {
    throw new Error("REAL_LLM_BASE_URL must be an http(s) OpenAI-compatible gateway URL.");
  }

  if (!config.model) {
    throw new Error("REAL_LLM_MODEL is required so the chat completion path does not fall back to mock.");
  }
}

async function runRealProviderFlow() {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `real-provider-qa-${runId}@perpetual-renewal.local`;

  const login = await request("/api/auth/login", {
    method: "POST",
    body: {
      email,
      nickname: "Real Provider QA"
    }
  });
  assertStatus(login, 200, "login");

  try {
    const savedCredential = await request("/api/me/llm-credential", {
      method: "PUT",
      body: {
        provider: "compatible",
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model
      }
    });
    assertStatus(savedCredential, 200, "save llm credential");
    assertCredentialStatus(savedCredential.body?.credential, "saved credential");
    assertNoSensitiveText(savedCredential.body, "saved credential response");

    const credentialStatus = await request("/api/me/llm-credential");
    assertStatus(credentialStatus, 200, "get llm credential");
    assertCredentialStatus(credentialStatus.body?.credential, "credential status");
    assertNoSensitiveText(credentialStatus.body, "credential status response");

    const modelList = await request("/api/me/llm-models", {}, { allowError: true });
    assertNoSensitiveText(modelList.body, "model list response");
    if (modelList.response.status === 200) {
      assert(modelList.body?.provider === "compatible", "model list should use compatible provider.");
      assert(
        modelList.body?.credentialSource === "user-vault",
        "model list should read credentials from user vault."
      );
      assert(Array.isArray(modelList.body?.models), "model list should return an array.");
      if (config.requireModels) {
        assert(modelList.body.models.length > 0, "model list should not be empty when REAL_PROVIDER_REQUIRE_MODELS=1.");
      }
    } else {
      assert(
        !config.requireModels,
        "model list failed while REAL_PROVIDER_REQUIRE_MODELS=1; provider did not expose a usable /models response."
      );
      console.warn(
        `Model list diagnostic: status=${modelList.response.status} errorType=${safeToken(modelList.body?.errorType)} retryable=${Boolean(modelList.body?.retryable)}`
      );
    }

    const connectionTest = await request("/api/me/llm-test", {
      method: "POST",
      body: {
        provider: "compatible",
        baseUrl: config.baseUrl,
        model: config.model
      }
    });
    assertStatus(connectionTest, 200, "llm connection test");
    assertNoSensitiveText(connectionTest.body, "connection test response");
    assert(connectionTest.body?.ok === true, "connection test should pass.");
    assert(connectionTest.body?.provider === "compatible", "connection test should use compatible provider.");
    assert(
      connectionTest.body?.credentialSource === "user-vault",
      "connection test should use the saved user vault key."
    );
    assert(Number.isFinite(connectionTest.body?.latencyMs), "connection test should include latencyMs.");

    const companion = await request("/api/companions", {
      method: "POST",
      body: {
        name: "真实联调回响",
        relationshipKind: "CUSTOM",
        customKind: "真实供应商联调对象",
        userAddress: "我",
        companionAddress: "回响",
        personality: ["温柔", "稳定", "简洁"],
        speakingStyle: "自然中文，短句回应，不使用 Markdown 格式符号。",
        background: "用于验证用户自带 API key 的真实供应商聊天链路。",
        boundaries: "不输出密钥、端点、prompt 或调试信息。",
        immersionEnabled: true,
        proactiveMessagesEnabled: true,
        proactiveFrequencyPreset: "1m",
        proactiveFrequencyMinutes: 1
      }
    });
    assertStatus(companion, 201, "create companion");
    const conversationId = companion.body?.companion?.conversationId;
    const companionId = companion.body?.companion?.id;
    assert(typeof conversationId === "string" && conversationId, "created companion should include conversationId.");
    assert(typeof companionId === "string" && companionId, "created companion should include id.");

    const chat = await request(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: {
        content: TEST_MESSAGE
      }
    });
    assertStatus(chat, 201, "send real chat message");
    assertNoSensitiveText(chat.body, "chat response");
    assert(!chat.body?.assistantError, "real chat should not return assistantError.");
    assert(chat.body?.completion?.provider === "compatible", "chat completion should use compatible provider.");
    assert(chat.body?.completion?.model !== "mock-local", "chat completion should not use mock-local.");
    assert(
      typeof chat.body?.assistantMessage?.content === "string" &&
        chat.body.assistantMessage.content.trim().length > 0,
      "assistant message should have content."
    );
    assert(
      chat.body?.assistantMessage?.metadata?.status === "sent",
      "assistant message metadata should be sent."
    );
    assert(
      chat.body?.assistantMessage?.metadata?.provider === "compatible",
      "assistant message metadata should record compatible provider."
    );

    const messages = await request(`/api/conversations/${encodeURIComponent(conversationId)}/messages`);
    assertStatus(messages, 200, "list messages");
    assertNoSensitiveText(messages.body, "messages response");
    assert(
      Array.isArray(messages.body?.messages) &&
        messages.body.messages.some((message) => message.role === "assistant" && message.content?.trim()),
      "message list should include the persisted assistant reply."
    );

    const usage = await request("/api/usage/model-calls?rangeDays=1");
    assertStatus(usage, 200, "usage dashboard");
    assertNoSensitiveText(usage.body, "usage dashboard response");
    assert(
      JSON.stringify(usage.body).includes("chat_reply") &&
        JSON.stringify(usage.body).includes("compatible") &&
        JSON.stringify(usage.body).includes("success"),
      "usage dashboard should include a successful compatible chat_reply entry."
    );

    const proactive = await request("/api/proactive/run", {
      method: "POST",
      body: {
        dryRun: true,
        limit: 1,
        maxDrafts: 1,
        now: new Date(Date.now() + 70_000).toISOString()
      }
    });
    assertStatus(proactive, 200, "proactive dry-run");
    assertNoSensitiveText(proactive.body, "proactive response");
    assert(
      proactive.body?.scope === "current-user" && Number.isFinite(proactive.body?.scannedCount),
      "proactive dry-run should scan the current QA user."
    );
  } finally {
    await cleanupQaUser();
  }
}

function assertCredentialStatus(credential, label) {
  assert(credential?.configured === true, `${label} should be configured.`);
  assert(credential?.provider === "compatible", `${label} should use compatible provider.`);
  assert(credential?.endpointConfigured === true, `${label} should have an endpoint configured.`);
  assert(credential?.model === config.model, `${label} should store the selected model.`);
}

async function cleanupQaUser() {
  if (config.keepQaAccount) {
    console.warn("Skipping QA account cleanup because REAL_PROVIDER_KEEP_QA_ACCOUNT=1.");
    return;
  }

  const deleted = await request(
    "/api/me/account",
    {
      method: "DELETE",
      body: {
        confirmation: ACCOUNT_DELETE_CONFIRMATION
      }
    },
    { allowError: true }
  );

  if (deleted.response.status !== 200) {
    console.warn(
      `QA account cleanup did not complete: status=${deleted.response.status} errorType=${safeToken(deleted.body?.errorType)}`
    );
  }
}

function startDevServer(port) {
  const nextBin = resolve(ROOT_DIR, "node_modules/next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      AUTH_MODE: "local-email",
      NEXT_TELEMETRY_DISABLED: "1",
      LLM_API_KEY: "",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  child.stdout.on("data", (chunk) => rememberServerOutput(chunk));
  child.stderr.on("data", (chunk) => rememberServerOutput(chunk));
  child.on("exit", () => {
    serverExited = true;
  });

  return child;
}

async function waitForServer(url) {
  const deadline = Date.now() + START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (serverExited) {
      throw new Error("Real provider QA dev server exited before becoming ready.");
    }

    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Keep polling until Next finishes booting.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for ${url}.`);
}

async function findExistingLocalApp() {
  for (const candidate of ["http://127.0.0.1:3000", "http://localhost:3000"]) {
    try {
      const response = await fetch(candidate, {
        redirect: "manual",
        signal: AbortSignal.timeout(1_500)
      });
      if (response.status < 500) {
        return candidate;
      }
    } catch {
      // Try the next local app URL before starting a managed server.
    }
  }

  return "";
}

async function request(pathname, options = {}, behavior = {}) {
  const headers = new Headers(options.headers ?? {});
  const cookieHeader = formatCookieHeader(client);
  if (cookieHeader) headers.set("cookie", cookieHeader);

  let body = options.body;
  if (body !== undefined && typeof body !== "string") {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(new URL(pathname, rootUrl), {
    method: options.method ?? "GET",
    headers,
    body,
    signal: AbortSignal.timeout(readPositiveInteger(process.env.REAL_PROVIDER_REQUEST_TIMEOUT_MS, 90_000))
  });
  storeResponseCookies(client, response);

  const text = await response.text();
  const parsed = text ? safeJsonParse(text) : null;

  if (!behavior.allowError && response.status >= 400) {
    throw new Error(
      `${options.method ?? "GET"} ${pathname} returned HTTP ${response.status}; errorType=${safeToken(parsed?.errorType)} retryable=${Boolean(parsed?.retryable)}`
    );
  }

  return {
    response,
    body: parsed
  };
}

async function cleanup() {
  if (!serverProcess || serverExited) return;

  await new Promise((resolve) => {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(serverProcess.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.on("exit", resolve);
      return;
    }

    serverProcess.once("exit", resolve);
    serverProcess.kill("SIGTERM");
    setTimeout(() => {
      if (!serverExited) serverProcess.kill("SIGKILL");
    }, 5_000).unref();
  });
}

function createRequestClient() {
  return { cookies: new Map() };
}

function formatCookieHeader(targetClient) {
  return Array.from(targetClient.cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function storeResponseCookies(targetClient, response) {
  for (const header of getSetCookieHeaders(response)) {
    const [pair] = header.split(";");
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) continue;

    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!name) continue;

    if (value === "") {
      targetClient.cookies.delete(name);
    } else {
      targetClient.cookies.set(name, value);
    }
  }
}

function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const header = response.headers.get("set-cookie");
  return header ? [header] : [];
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 50; port += 1) {
    if (await isPortAvailable(port)) return port;
  }

  throw new Error("No available port found for real provider QA server.");
}

function isPortAvailable(port) {
  return new Promise((resolvePort) => {
    const server = createNetServer();
    server.once("error", () => resolvePort(false));
    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function rememberServerOutput(chunk) {
  const text = redact(String(chunk));
  serverOutput.push(text);
  while (serverOutput.length > 80) serverOutput.shift();
}

function printServerOutput() {
  if (!serverOutput.length) return;

  console.error("Recent sanitized server output:");
  console.error(serverOutput.join("").slice(-6000));
}

function assertStatus(result, expectedStatus, label) {
  assert(result.response.status === expectedStatus, `${label} expected HTTP ${expectedStatus}, got ${result.response.status}.`);
}

function assertNoSensitiveText(value, label) {
  const text = JSON.stringify(value ?? {});
  const redacted = redact(text);
  assert(text === redacted, `${label} contains sensitive-looking provider or secret text.`);
  assert(!text.includes("encryptedApiKey"), `${label} should not include encryptedApiKey.`);
  assert(!text.includes("keyIv"), `${label} should not include keyIv.`);
  assert(!text.includes("keyAuthTag"), `${label} should not include keyAuthTag.`);
  assert(!/Bearer\s+[A-Za-z0-9._~+/=-]+/i.test(text), `${label} should not include Bearer tokens.`);
  assert(!/Authorization/i.test(text), `${label} should not include authorization headers.`);
}

function redact(value) {
  let current = String(value);
  for (const secret of redactionValues) {
    current = current.split(secret).join("[REDACTED]");
  }

  return current
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bAuthorization\b\s*[:=]\s*[^"',;<>}\n]+/gi, "Authorization=[REDACTED]")
    .replace(/\b(api[_-]?key|token|secret|password)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^"',;<>}\n]+)/gi, "$1$2[REDACTED]")
    .replace(/\b(base[_-]?url|endpoint(?:[_-]?url)?)(["']?\s*[:=]\s*)["']?https?:\/\/[^\s"',;<>}]+/gi, "$1$2[REDACTED_URL]")
    .replace(/https?:\/\/[^\s"',;<>]*(?:\/v1|\/v1beta|\/chat\/completions|gateway|provider|tryanotherone|openai|anthropic|gemini|api\.)[^\s"',;<>]*/gi, "[REDACTED_PROVIDER_ENDPOINT]")
    .replace(/\b(prompt|rawPayload|raw_payload|raw payload|stack)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^"',;<>}\n]+)/gi, "$1$2[REDACTED]")
    .replace(/\bat\s+[A-Za-z0-9_.$<>]+\s*\([^)"']+\)/g, "[REDACTED_STACK]");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeToken(value) {
  if (value === undefined || value === null || value === "") return "none";
  return String(value).replace(/[^a-z0-9_-]/gi, "_").slice(0, 64);
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
