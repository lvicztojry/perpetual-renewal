import { spawn } from "node:child_process";
import { createServer } from "node:http";
import process from "node:process";

const MODEL_ID = "fake-compatible-provider-model";
const PLACEHOLDER_KEY = "provider-placeholder-real-provider-fake-key";
const outputTail = [];

const provider = await startFakeCompatibleProvider();

try {
  const result = await runRealProviderQa(provider.baseUrl);
  if (result.code !== 0) {
    console.error("Real provider QA fake-compatible self-test failed.");
    printOutputTail();
    process.exit(result.code || 1);
  }

  console.log("Real provider QA fake-compatible self-test passed.");
} finally {
  await provider.close();
}

async function startFakeCompatibleProvider() {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      response.setHeader("content-type", "application/json");

      if (request.url === "/v1/models") {
        response.end(
          JSON.stringify({
            object: "list",
            data: [
              {
                id: MODEL_ID,
                object: "model"
              }
            ]
          })
        );
        return;
      }

      if (request.url === "/v1/chat/completions") {
        const payload = safeJsonParse(body) ?? {};
        response.end(
          JSON.stringify({
            id: "fake-compatible-provider-chat",
            model: typeof payload.model === "string" ? payload.model : MODEL_ID,
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "我在，这次 BYOK 自测路径已经有回响了。"
                },
                finish_reason: "stop"
              }
            ],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 10,
              total_tokens: 22
            }
          })
        );
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake compatible provider did not expose a TCP port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
      })
  };
}

function runRealProviderQa(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["tests/qa-real-provider.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        REAL_PROVIDER_QA: "1",
        REAL_LLM_PROVIDER: "compatible",
        REAL_LLM_API_KEY: PLACEHOLDER_KEY,
        REAL_LLM_BASE_URL: baseUrl,
        REAL_LLM_MODEL: MODEL_ID,
        REAL_PROVIDER_REQUIRE_MODELS: "1",
        REAL_PROVIDER_TIMEOUT_MS: process.env.REAL_PROVIDER_TIMEOUT_MS ?? "180000",
        REAL_PROVIDER_REQUEST_TIMEOUT_MS: process.env.REAL_PROVIDER_REQUEST_TIMEOUT_MS ?? "90000",
        RENEWAL_REPOSITORY: process.env.RENEWAL_REPOSITORY ?? "memory",
        SESSION_COOKIE_SECRET:
          process.env.SESSION_COOKIE_SECRET ?? "provider-placeholder-session-secret-32-bytes",
        USER_KEY_VAULT_SECRET:
          process.env.USER_KEY_VAULT_SECRET ?? "provider-placeholder-vault-secret-32-bytes",
        LLM_API_KEY: "",
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        GEMINI_API_KEY: "",
        GOOGLE_API_KEY: ""
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    child.stdout.on("data", rememberOutput);
    child.stderr.on("data", rememberOutput);
    child.on("exit", (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0) });
    });
  });
}

function rememberOutput(chunk) {
  outputTail.push(redact(String(chunk)));
  while (outputTail.length > 80) {
    outputTail.shift();
  }
}

function printOutputTail() {
  if (!outputTail.length) return;
  console.error(outputTail.join("").slice(-6000));
}

function redact(value) {
  return String(value)
    .split(PLACEHOLDER_KEY)
    .join("[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(api[_-]?key|token|secret|password)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^"',;<>}\n]+)/gi, "$1$2[REDACTED]")
    .replace(/https?:\/\/[^\s"',;<>]*(?:\/v1|\/chat\/completions|gateway|provider|api\.)[^\s"',;<>]*/gi, "[REDACTED_PROVIDER_ENDPOINT]")
    .replace(/\b(prompt|rawPayload|raw_payload|raw payload|stack)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^"',;<>}\n]+)/gi, "$1$2[REDACTED]");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
