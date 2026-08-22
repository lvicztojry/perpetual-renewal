import { execFileSync, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import process from "node:process";
import vm from "node:vm";
import * as ts from "typescript";

const DEFAULT_PORT = 3210;
const START_TIMEOUT_MS = 90_000;
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_PATH = new URL("./qa-samples.json", import.meta.url);
const SMOKE_CRON_SECRET = "smoke-cron-secret-placeholder";
const SMOKE_SESSION_COOKIE_SECRET = "smoke-session-cookie-secret-private-32";
const SESSION_COOKIE_NAME = "perpetual_renewal_session";

const samples = await readSamples();
const checks = [];
let serverProcess;
let rootUrl = process.env.SMOKE_BASE_URL;
const defaultClient = createRequestClient();

process.on("SIGINT", async () => {
  await stopServer();
  process.exit(130);
});

process.on("SIGTERM", async () => {
  await stopServer();
  process.exit(143);
});

try {
  runEnvReadinessSmoke();
  await runSecretScanSmoke();
  await runApiBoundaryStaticSmoke();

  if (!rootUrl) {
    const port = process.env.SMOKE_PORT || String(await findAvailablePort(DEFAULT_PORT));
    rootUrl = `http://127.0.0.1:${port}`;
    serverProcess = startDevServer(port);
    await waitForServer(rootUrl);
  }

  await runSmoke();
  printSummary();
} catch (error) {
  console.error("\nSmoke failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await stopServer();
}

process.exit(process.exitCode ?? 0);

function runEnvReadinessSmoke() {
  const output = execFileSync(process.execPath, ["scripts/env-readiness.mjs"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "",
      SESSION_COOKIE_SECRET: "",
      USER_KEY_VAULT_SECRET: "",
      PROACTIVE_CRON_SECRET: "",
      LLM_API_KEY: "",
      LLM_MODEL: ""
    }
  });

  assert(output.includes("Environment readiness"), "env readiness should print a summary");
  assert(output.includes("[missing] DATABASE_URL"), "env readiness should report missing database");
  assert(
    output.includes("[missing] SESSION_COOKIE_SECRET"),
    "env readiness should report missing session signing secret"
  );
  assert(
    !output.includes("postgresql://") &&
      !output.includes("Bearer") &&
      !output.includes("sk-") &&
      !output.includes("https://api.tryanotherone.com/v1"),
    "env readiness output should stay sanitized"
  );

  let strictFailed = false;
  try {
    execFileSync(process.execPath, ["scripts/env-readiness.mjs", "--strict"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "",
        SESSION_COOKIE_SECRET: "",
        USER_KEY_VAULT_SECRET: "",
        PROACTIVE_CRON_SECRET: ""
      },
      stdio: "pipe"
    });
  } catch {
    strictFailed = true;
  }

  assert(strictFailed, "env readiness strict mode should fail when required config is missing");
  pass("scripts/env-readiness sanitized readiness and strict failure");
}

async function runSecretScanSmoke() {
  const tempDir = resolve(ROOT_DIR, ".tmp-secret-scan");
  const safeFile = resolve(tempDir, "safe.env");
  const unsafeFile = resolve(tempDir, "unsafe.env");

  assert(tempDir.startsWith(ROOT_DIR), "secret scan temp dir should stay inside the project");
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  try {
    await writeFile(
      safeFile,
      [
        'DATABASE_URL=""',
        'LLM_API_KEY=""',
        'USER_KEY_VAULT_SECRET="placeholder"',
        'SESSION_COOKIE_SECRET=""',
        'PROACTIVE_CRON_SECRET="changeme"',
        'Authorization: Bearer <PROACTIVE_CRON_SECRET>'
      ].join("\n"),
      "utf8"
    );
    execFileSync(process.execPath, ["scripts/check-env-leaks.mjs", "--files", safeFile], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: "pipe"
    });

    await writeFile(
      unsafeFile,
      [
        'DATABASE_URL="' + "postgresql://" + 'realuser:realpassword@db.example.com:5432/app?schema=public"',
        'USER_KEY_VAULT_SECRET="' + "mN5d7bJfW61Kz8QhP2nC4xR9vL0sA3eY6tU1iO8pD5g" + '"',
        'SESSION_COOKIE_SECRET="' + "sessionsecretvalue012345678901234567890" + '"',
        'VOICE_API_KEY="' + "voicekeyvalue0123456789012345" + '"',
        'encryptedApiKey: "' + "bW9jay12YXVsdC1jaXBoZXJ0ZXh0LXZhbHVl" + '"',
        'keyIv: "' + "bW9jay12YXVsdC1pdi12YWx1ZQ==" + '"',
        'keyAuthTag: "' + "bW9jay12YXVsdC10YWctdmFsdWU=" + '"',
        'vaultCiphertext="' + "bW9jay12YXVsdC1jaXBoZXJ0ZXh0LXNoYXBl" + '"',
        "Authorization: Bearer " + "realtokenvalue0123456789",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
          ".eyJzdWIiOiIxMjM0NTY3ODkwIn0" +
          ".signaturevalue0123456789"
      ].join("\n"),
      "utf8"
    );

    let unsafeFailed = false;
    try {
      execFileSync(process.execPath, ["scripts/check-env-leaks.mjs", "--files", unsafeFile], {
        cwd: ROOT_DIR,
        encoding: "utf8",
        stdio: "pipe"
      });
    } catch {
      unsafeFailed = true;
    }

    assert(unsafeFailed, "secret scan should reject database credentials, vault secrets, Bearer tokens, and JWTs");
    pass("scripts/check-env-leaks catches high-risk secret shapes");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runApiBoundaryStaticSmoke() {
  const apiRouteFiles = await listFiles(resolve(ROOT_DIR, "src/app/api"));
  const routeSources = await Promise.all(
    apiRouteFiles
      .filter((filePath) => filePath.endsWith("route.ts"))
      .map(async (filePath) => ({
        filePath,
        source: await readFile(filePath, "utf8")
      }))
  );

  for (const { filePath, source } of routeSources) {
    assert(
      !source.includes("request.json("),
      `${filePath} should parse JSON through src/lib/http/json helpers`
    );
    assert(
      !source.includes("NextResponse.json(") &&
        !source.includes("Response.json(") &&
        !source.includes("new Response("),
      `${filePath} should return API JSON through privateJson`
    );
  }

  for (const routePath of [
    resolve(ROOT_DIR, "src/app/api/chat/complete/route.ts"),
    resolve(ROOT_DIR, "src/app/api/voice/synthesize/route.ts"),
    resolve(ROOT_DIR, "src/app/api/voice/transcribe/route.ts")
  ]) {
    const source = await readFile(routePath, "utf8");
    assert(
      source.includes("redactSensitiveResponseText") &&
        /fallbackReason:\s*redactSensitiveResponseText\(/.test(source),
      `${routePath} should redact fallbackReason before returning API JSON`
    );
  }

  const responseSafetySource = await readFile(
    resolve(ROOT_DIR, "src/lib/http/response-safety.ts"),
    "utf8"
  );
  assert(
    responseSafetySource.includes("sanitizeLogText") &&
      responseSafetySource.includes("LLM_BASE_URL") &&
      responseSafetySource.includes("VOICE_BASE_URL") &&
      responseSafetySource.includes("redacted-provider-endpoint"),
    "HTTP response text sanitizer should cover log secrets and provider endpoints"
  );

  const usageRepositorySource = await readFile(
    resolve(ROOT_DIR, "src/lib/usage/repository.ts"),
    "utf8"
  );
  assert(
    usageRepositorySource.includes("redactSensitiveResponseText") &&
      /fallbackReason:\s*redactSensitiveResponseText\(/.test(usageRepositorySource),
    "usage logs should sanitize fallbackReason before persistence"
  );

  const generateReplySource = await readFile(
    resolve(ROOT_DIR, "src/lib/chat/generate-reply.ts"),
    "utf8"
  );
  assert(
    generateReplySource.includes("normalizeAssistantReplyContent(completion.content)"),
    "assistant replies should be normalized before persistence or API response"
  );

  const promptBuilderSource = await readFile(
    resolve(ROOT_DIR, "src/lib/prompt-builder/builder.ts"),
    "utf8"
  );
  assert(
    promptBuilderSource.includes("不使用 Markdown 格式") &&
      promptBuilderSource.includes("星号包裹动作"),
    "chat prompt should ask providers not to emit markdown emphasis or star actions"
  );

  const normalizeAssistantReplyContent = await loadReplyFormatModule();
  const markdownReply = [
    "**我在这里**，*轻轻把你的话接住*。",
    "```text",
    "不用害怕。",
    "```",
    "也可以看[这里](https://example.com)。"
  ].join("\n");
  const normalizedReply = normalizeAssistantReplyContent(markdownReply);
  assert(
    normalizedReply === "我在这里，轻轻把你的话接住。\n不用害怕。\n\n也可以看这里。",
    "assistant reply normalizer should remove markdown emphasis, code fences, and markdown links"
  );
  assert(
    normalizeAssistantReplyContent("*嗯*，我在。") === "嗯，我在。",
    "assistant reply normalizer should remove single-character star emphasis"
  );
  assert(
    normalizeAssistantReplyContent("我在*轻轻抱住你*，一直都在。") === "我在轻轻抱住你，一直都在。",
    "assistant reply normalizer should remove inline star actions without requiring spacing"
  );
  assert(
    normalizeAssistantReplyContent("我＊真的＊很想见你。") === "我真的很想见你。",
    "assistant reply normalizer should remove full-width star emphasis"
  );
  pass("API route response boundaries stay private and sanitized");
}

function startDevServer(port) {
  const command = process.execPath;
  const args = [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    port
  ];
  const child = spawn(command, args, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      LLM_PROVIDER: "compatible",
      LLM_API_KEY: "",
      LLM_BASE_URL: "",
      LLM_MODEL: "",
      VOICE_PROVIDER: "shared-llm",
      VOICE_STT_MODEL: "",
      VOICE_TTS_MODEL: "",
      PROACTIVE_CRON_SECRET: SMOKE_CRON_SECRET,
      SESSION_COOKIE_SECRET: SMOKE_SESSION_COOKIE_SECRET,
      NEXT_TELEMETRY_DISABLED: "1"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  child.stdout.on("data", (chunk) => process.stdout.write(prefixServerOutput(chunk)));
  child.stderr.on("data", (chunk) => process.stderr.write(prefixServerOutput(chunk)));

  return child;
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await isPortAvailable(port)) return port;
  }

  throw new Error(`No available smoke test port found from ${startPort} to ${startPort + 19}.`);
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

async function startSensitiveModelProviderServer(readBody) {
  const server = createHttpServer((request, response) => {
    if (request.url !== "/models") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }

    response.writeHead(502, { "content-type": "application/json" });
    response.end(readBody(request));
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  assert(address && typeof address === "object", "sensitive model provider should bind to a local port");

  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise((resolveClose) => {
        server.close(() => resolveClose());
      })
  };
}

async function waitForServer(url) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(1_000);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "no response"}`);
}

async function runSmoke() {
  const home = await request("/");
  assert(home.response.ok, "home page should return 2xx");
  assert(
    home.response.headers.get("content-type")?.includes("text/html"),
    "home page should return HTML"
  );
  pass("home page health");

  const manifest = await request("/manifest.webmanifest");
  const manifestBody =
    typeof manifest.body === "string" ? JSON.parse(manifest.body) : manifest.body;
  assert(manifestBody.name === "生生不息", "PWA manifest should use the product name");
  assert(manifestBody.display === "standalone", "PWA manifest should enable standalone display");
  assert(
    manifestBody.icons?.some((icon) => icon.src === "/icons/icon.svg"),
    "PWA manifest should reference a real app icon"
  );
  pass("GET /manifest.webmanifest PWA metadata");

  const offline = await request("/offline.html");
  assert(
    typeof offline.body === "string" && offline.body.includes("暂时离线"),
    "offline page should explain offline state"
  );
  pass("GET /offline.html offline shell");

  const serviceWorker = await request("/sw.js");
  assert(
    typeof serviceWorker.body === "string" &&
      serviceWorker.body.includes("perpetual-renewal-pwa-v1") &&
      serviceWorker.body.includes('url.pathname.startsWith("/api/")'),
    "service worker should explicitly skip API response caching"
  );
  pass("GET /sw.js safe service worker");

  const companionsBefore = await request("/api/companions");
  assert(Array.isArray(companionsBefore.body.companions), "companions list should be an array");
  pass("GET /api/companions");

  const isolatedClientA = createRequestClient();
  const isolatedClientB = createRequestClient();
  const isolatedEmailA = `smoke-isolated-a-${Date.now()}@perpetual-renewal.local`;
  const isolatedEmailB = `smoke-isolated-b-${Date.now()}@perpetual-renewal.local`;
  const isolatedLoginA = await request(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email: isolatedEmailA, nickname: "隔离用户 A" })
    },
    { client: isolatedClientA }
  );
  const isolatedLoginB = await request(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email: isolatedEmailB, nickname: "隔离用户 B" })
    },
    { client: isolatedClientB }
  );
  assert(
    isolatedLoginA.body.session?.userId &&
      isolatedLoginB.body.session?.userId &&
      isolatedLoginA.body.session.userId !== isolatedLoginB.body.session.userId,
    "memory fallback should create isolated user ids per email login"
  );
  assert(
    isolatedLoginA.body.user?.email === isolatedEmailA &&
      isolatedLoginB.body.user?.email === isolatedEmailB,
    "memory fallback profiles should keep the login email per isolated session"
  );
  const isolatedCompanion = await request(
    "/api/companions",
    {
      method: "POST",
      body: JSON.stringify({
        name: "隔离回响",
        relationshipKind: "CUSTOM",
        customKind: "隔离测试关系",
        userAddress: "我",
        companionAddress: "回响",
        personality: ["安静"],
        speakingStyle: "短句、稳定",
        background: "用于验证本地 memory fallback 用户隔离。",
        boundaries: "不跨用户泄露。",
        immersionEnabled: true
      })
    },
    { client: isolatedClientA }
  );
  assert(isolatedCompanion.response.status === 201, "isolated companion creation should return 201");
  const isolatedAList = await request("/api/companions", {}, { client: isolatedClientA });
  const isolatedBList = await request("/api/companions", {}, { client: isolatedClientB });
  assert(
    isolatedAList.body.companions.some((item) => item.id === isolatedCompanion.body.companion.id),
    "memory fallback should list a user's own companion"
  );
  assert(
    !isolatedBList.body.companions.some((item) => item.id === isolatedCompanion.body.companion.id),
    "memory fallback should not leak companions across email sessions"
  );
  const forgedClient = createRequestClient();
  forgedClient.cookies.set(SESSION_COOKIE_NAME, isolatedLoginA.body.session.userId);
  const forgedList = await request("/api/companions", {}, { client: forgedClient });
  assert(
    !forgedList.body.companions.some((item) => item.id === isolatedCompanion.body.companion.id),
    "raw user id session cookies should not grant access to another fallback user's data"
  );
  pass("POST /api/auth/login memory fallback isolates sessions by email");

  const smokeEmail = `smoke-${Date.now()}@perpetual-renewal.local`;
  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: smokeEmail,
      nickname: "Smoke 用户"
    })
  });
  assert(login.body.session?.userId, "login should return a session");
  assert(login.body.user?.id, "login should return a user profile");
  assertSessionCookieSet(login.response, "login", login.body.session.userId);
  assertInvalidJsonResponse(
    await request(
      "/api/auth/login",
      {
        method: "POST",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "login"
  );
  assertJsonObjectRequiredResponse(
    await request(
      "/api/auth/login",
      {
        method: "POST",
        body: "null"
      },
      { allowError: true }
    ),
    "login"
  );
  pass("POST /api/auth/login");

  assertInvalidJsonResponse(
    await request(
      "/api/companions",
      {
        method: "POST",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "companion creation"
  );
  const invalidRelationshipKindName = "不应该被创建的关系对象";
  const invalidRelationshipKind = await request(
    "/api/companions",
    {
      method: "POST",
      body: JSON.stringify({
        name: invalidRelationshipKindName,
        relationshipKind: "NOT_A_RELATIONSHIP_KIND",
        speakingStyle: "温柔稳定"
      })
    },
    { allowError: true }
  );
  assert(
    invalidRelationshipKind.response.status === 400 &&
      invalidRelationshipKind.body.error === "Unsupported relationship kind." &&
      !JSON.stringify(invalidRelationshipKind.body).includes("NOT_A_RELATIONSHIP_KIND"),
    "companion creation should reject unsupported relationship kinds with stable copy"
  );
  const companionsAfterInvalidKind = await request("/api/companions");
  assert(
    !companionsAfterInvalidKind.body.companions?.some(
      (companion) => companion.name === invalidRelationshipKindName
    ),
    "rejected companion creation should not persist invalid relationship objects"
  );

  const companionInput = samples.relationshipCases.find((item) => item.kind === "CUSTOM");
  const created = await request("/api/companions", {
    method: "POST",
    body: JSON.stringify({
      name: companionInput.companionName,
      relationshipKind: companionInput.kind,
      customKind: companionInput.customKind,
      userAddress: companionInput.userAddress,
      companionAddress: companionInput.companionAddress,
      personality: companionInput.personality,
      speakingStyle: companionInput.speakingStyle,
      background: companionInput.background,
      boundaries: companionInput.boundaries,
      immersionEnabled: true
    })
  });
  assert(created.response.status === 201, "companion creation should return 201");
  assert(created.body.companion?.relationshipKind === "CUSTOM", "created companion should be custom");
  assert(created.body.companion?.conversationId, "created companion should include conversationId");
  assert(
    created.body.companion?.proactiveFrequencyPreset === "1m" &&
      created.body.companion?.proactiveFrequencyMinutes === 1,
    "created companion should default proactive cadence to one minute"
  );

  assertInvalidJsonResponse(
    await request(
      `/api/companions/${encodeURIComponent(created.body.companion.id)}`,
      {
        method: "PATCH",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "companion update"
  );
  const rejectedCompanionPatch = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "   ",
        speakingStyle: "这次更新不应该局部写入。"
      })
    },
    { allowError: true }
  );
  assert(
    rejectedCompanionPatch.response.status === 400 &&
      rejectedCompanionPatch.body.error === "Companion name is required.",
    "companion update should reject blank names with stable copy"
  );
  const companionAfterRejectedPatch = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}`
  );
  assert(
    companionAfterRejectedPatch.body.companion?.name === companionInput.companionName &&
      companionAfterRejectedPatch.body.companion?.speakingStyle === companionInput.speakingStyle,
    "rejected companion update should not partially mutate companion fields"
  );
  pass("POST /api/companions with custom relationship");

  const imported = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/imports`,
    {
      method: "POST",
      body: JSON.stringify({
        sourceKind: "tone_sample",
        text: "TA 说话会先轻轻接住我的情绪，再慢慢解释。token=secret-value-that-should-not-leak"
      })
    }
  );
  assert(imported.response.status === 201, "text import should return 201");
  assert(imported.body.memories?.length === 1, "text import should create one memory");
  assert(imported.body.memories[0].status === "pending", "text import should create pending memory");
  assert(
    imported.body.memories[0].type === "emotional_preference",
    "tone sample import should map to emotional preference"
  );
  assert(
    !imported.body.memories.some((memory) => memory.content.includes("secret-value-that-should-not-leak")),
    "text import should not persist likely secrets"
  );
  assert(
    imported.body.importSummary?.redactionCount === 1,
    "text import should report redacted likely secrets"
  );
  assert(
    imported.body.importSummary?.lifecycle?.join(" -> ") ===
      "pending -> active -> archived -> deleted",
    "text import should report memory lifecycle"
  );
  pass("POST /api/companions/:id/imports text import");

  const rejectedImportJson = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/imports`,
    {
      method: "POST",
      body: "{not valid json"
    },
    { allowError: true }
  );
  assert(
    rejectedImportJson.response.status === 400,
    "text import should reject invalid JSON bodies"
  );
  assert(
    !JSON.stringify(rejectedImportJson.body).includes("Bearer") &&
      !JSON.stringify(rejectedImportJson.body).includes("baseUrl") &&
      !JSON.stringify(rejectedImportJson.body).includes("stack"),
    "text import invalid JSON response should stay sanitized"
  );
  assertJsonObjectRequiredResponse(
    await request(
      `/api/companions/${encodeURIComponent(created.body.companion.id)}/imports`,
      {
        method: "POST",
        body: "[]"
      },
      { allowError: true }
    ),
    "text import"
  );
  pass("POST /api/companions/:id/imports rejects invalid JSON");

  const batchSecret = "batch-secret-value-that-should-not-leak";
  const batchImported = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/imports`,
    {
      method: "POST",
      body: JSON.stringify({
        sourceKind: "memory_candidate",
        batchTexts: [
          "我喜欢你在我焦虑时先说慢慢来。",
          {
            sourceKind: "material",
            text: `第一次约定是在生日。api_key=${batchSecret}`
          },
          "",
          {
            sourceKind: "tone_sample",
            content: "说话语气要更像熟人，别太正式。"
          }
        ]
      })
    }
  );
  assert(batchImported.response.status === 201, "batch import should return 201");
  assert(batchImported.body.memories?.length === 3, "batch import should create memories per valid item");
  assert(
    batchImported.body.memories.every((memory) => memory.status === "pending"),
    "batch import should create pending memories"
  );
  assert(
    batchImported.body.importSummary?.mode === "batch",
    "batch import should report batch mode"
  );
  assert(
    batchImported.body.importSummary?.createdCount === 3,
    "batch import should report created count"
  );
  assert(
    batchImported.body.importSummary?.skippedCount >= 2,
    "batch import should report skipped empty or redacted-only candidates"
  );
  assert(
    batchImported.body.importSummary?.redactionCount === 1,
    "batch import should report redacted likely secrets"
  );
  assert(
    !JSON.stringify(batchImported.body).includes(batchSecret),
    "batch import should not persist likely secrets"
  );
  pass("POST /api/companions/:id/imports batch import");

  const jsonlSecret = "jsonl-secret-value-that-should-not-leak";
  const jsonlImported = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/imports`,
    {
      method: "POST",
      body: JSON.stringify({
        jsonLines: [
          JSON.stringify({
            sourceKind: "memory_candidate",
            text: "我希望被记住的是，我会在下雨天很想念。"
          }),
          JSON.stringify({
            sourceKind: "tone_sample",
            content: `请用轻一点的语气回应。token=${jsonlSecret}`
          }),
          "{not valid json"
        ].join("\n")
      })
    }
  );
  assert(jsonlImported.response.status === 201, "JSONL import should return 201");
  assert(jsonlImported.body.memories?.length === 2, "JSONL import should create valid line memories");
  assert(
    jsonlImported.body.importSummary?.mode === "jsonl",
    "JSONL import should report jsonl mode"
  );
  assert(
    jsonlImported.body.importSummary?.parseSkippedCount === 1,
    "JSONL import should report parse skipped lines"
  );
  assert(
    jsonlImported.body.importSummary?.redactionCount === 1,
    "JSONL import should report redacted likely secrets"
  );
  assert(
    !JSON.stringify(jsonlImported.body).includes(jsonlSecret),
    "JSONL import should not persist likely secrets"
  );
  pass("POST /api/companions/:id/imports JSONL import");

  const disposable = await request("/api/companions", {
    method: "POST",
    body: JSON.stringify({
      name: "待删除关系",
      relationshipKind: "CUSTOM",
      customKind: "删除链路测试",
      personality: ["短暂", "可删除"],
      speakingStyle: "简短",
      background: "用于验证关系对象删除。",
      boundaries: "测试后应被删除。",
      immersionEnabled: true
    })
  });
  const deletedCompanion = await request(
    `/api/companions/${encodeURIComponent(disposable.body.companion.id)}`,
    { method: "DELETE" }
  );
  assert(deletedCompanion.body.deleted === true, "companion delete should return deleted=true");
  const deletedCompanionLookup = await request(
    `/api/companions/${encodeURIComponent(disposable.body.companion.id)}`,
    {},
    { allowError: true }
  );
  assert(
    deletedCompanionLookup.response.status === 404,
    "deleted companion should no longer be readable"
  );
  pass("DELETE /api/companions/:id removes relationship object");

  const sent = await request(
    `/api/conversations/${encodeURIComponent(created.body.companion.conversationId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content: "我记得我们第一次聊天时，我说过我害怕被突然丢下，生日那天也很想有人在。"
      })
    }
  );
  assert(sent.response.status === 201, "message send should return 201");
  assert(sent.body.userMessage?.role === "user", "message send should persist user message");
  assert(sent.body.assistantMessage?.metadata?.provider === "mock", "message send should use mock fallback");
  assert(sent.body.pendingMemory?.status === "pending", "message send should create a pending memory");
  assert(
    sent.body.relationshipState?.importantEvents?.length > 0,
    "relationship state should capture important event timeline entries"
  );
  assert(
    sent.body.relationshipState?.explanation?.includes("重要关系事件"),
    "relationship state should explain important event updates"
  );
  assertInvalidJsonResponse(
    await request(
      `/api/conversations/${encodeURIComponent(created.body.companion.conversationId)}/messages`,
      {
        method: "POST",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "message creation"
  );
  const emptyConversationMessage = await request(
    `/api/conversations/${encodeURIComponent(created.body.companion.conversationId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content: "   " })
    },
    { allowError: true }
  );
  assert(
    emptyConversationMessage.response.status === 400 &&
      emptyConversationMessage.body.error === "Message content is required." &&
      !JSON.stringify(emptyConversationMessage.body).includes("stack"),
    "message creation should reject empty content with stable copy"
  );
  assertInvalidJsonResponse(
    await request(
      `/api/companions/${encodeURIComponent(created.body.companion.id)}/memories`,
      {
        method: "POST",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "companion memory candidate creation"
  );
  assertJsonObjectRequiredResponse(
    await request(
      `/api/companions/${encodeURIComponent(created.body.companion.id)}/memories`,
      {
        method: "POST",
        body: "null"
      },
      { allowError: true }
    ),
    "companion memory candidate creation"
  );
  pass("conversation message plus pending memory");

  const manualMemoryContent = "手动记忆：用户希望被记住喜欢夜里收到轻轻的问候。";
  const manualMemories = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/memories`,
    {
      method: "POST",
      body: JSON.stringify({
        sourceMessageId: sent.body.userMessage.id,
        type: "emotional_preference",
        content: manualMemoryContent
      })
    }
  );
  assert(manualMemories.response.status === 201, "manual memory creation should return 201");
  assert(
    manualMemories.body.memories?.length === 1 &&
      manualMemories.body.memories[0].type === "emotional_preference" &&
      manualMemories.body.memories[0].status === "pending" &&
      manualMemories.body.memories[0].sourceMessageId === sent.body.userMessage.id &&
      manualMemories.body.memories[0].content === manualMemoryContent,
    "manual memory creation should persist the requested pending memory"
  );
  const memoriesAfterManualCreate = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/memories`
  );
  assert(
    memoriesAfterManualCreate.body.memories?.some(
      (memory) => memory.id === manualMemories.body.memories[0].id
    ),
    "manual memory should be visible in the companion memory list"
  );
  const deletedManualMemoryId = manualMemories.body.memories[0].id;
  const deletedManualMemoryContent = manualMemoryContent;
  const deletedManualMemory = await request(
    `/api/memories/${encodeURIComponent(deletedManualMemoryId)}`,
    { method: "DELETE" }
  );
  assert(deletedManualMemory.body.memory?.status === "deleted", "memory delete should mark memory deleted");
  const memoriesAfterManualDelete = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/memories?includeDeleted=true`
  );
  assert(
    !memoriesAfterManualDelete.body.memories?.some(
      (memory) =>
        memory.id === deletedManualMemoryId ||
        memory.content === deletedManualMemoryContent
    ),
    "deleted memories should stay hidden from companion memory API even when includeDeleted is requested"
  );
  const unsupportedManualMemory = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/memories`,
    {
      method: "POST",
      body: JSON.stringify({
        type: "unsupported_memory_type",
        content: "这条不应该被写入。"
      })
    },
    { allowError: true }
  );
  assert(
    unsupportedManualMemory.response.status === 400 &&
      unsupportedManualMemory.body.error === "Unsupported memory type",
    "manual memory creation should reject unsupported memory types"
  );
  const danglingSourceMessageId = "message-does-not-exist";
  const danglingSourceMemoryContent = "这条不应该用不存在的消息作为来源。";
  const danglingSourceManualMemory = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/memories`,
    {
      method: "POST",
      body: JSON.stringify({
        sourceMessageId: danglingSourceMessageId,
        type: "emotional_preference",
        content: danglingSourceMemoryContent
      })
    },
    { allowError: true }
  );
  assert(
    danglingSourceManualMemory.response.status === 400 &&
      danglingSourceManualMemory.body.error === "sourceMessageId was not found",
    "manual memory creation should reject unknown sourceMessageId"
  );
  const emptyManualMemory = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/memories`,
    {
      method: "POST",
      body: JSON.stringify({
        type: "emotional_preference",
        content: "   "
      })
    },
    { allowError: true }
  );
  assert(
    emptyManualMemory.response.status === 400 &&
      emptyManualMemory.body.error === "content is required",
    "manual memory creation should reject empty content"
  );
  const memoriesAfterRejectedManualCreate = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/memories`
  );
  assert(
    !memoriesAfterRejectedManualCreate.body.memories?.some(
      (memory) =>
        memory.content === danglingSourceMemoryContent ||
        memory.sourceMessageId === danglingSourceMessageId
    ),
    "rejected manual memory inputs should not create dangling records"
  );
  pass("POST /api/companions/:id/memories creates and validates manual memory candidates");

  const regenerateUserMessage = await request(
    `/api/conversations/${encodeURIComponent(created.body.companion.conversationId)}/messages`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "regenerate",
        messageId: sent.body.userMessage.id
      })
    },
    { allowError: true }
  );
  assert(
    regenerateUserMessage.response.status === 400 &&
      regenerateUserMessage.body.error === "Only assistant messages can be regenerated.",
    "regenerate should reject user messages with stable copy"
  );
  const regenerated = await request(
    `/api/conversations/${encodeURIComponent(created.body.companion.conversationId)}/messages`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "regenerate",
        messageId: sent.body.assistantMessage.id
      })
    }
  );
  assert(
    regenerated.body.assistantMessage?.id === sent.body.assistantMessage.id,
    "regenerate should update the target assistant message"
  );
  assert(
    regenerated.body.assistantMessage?.metadata?.status === "sent",
    "regenerated assistant message should be marked sent"
  );
  assert(
    regenerated.body.assistantMessage?.metadata?.regeneratedAt,
    "regenerated assistant message should include regeneratedAt metadata"
  );
  pass("PATCH /api/conversations/:id/messages regenerate assistant reply");

  const importantMessage = await request(
    `/api/conversations/${encodeURIComponent(created.body.companion.conversationId)}/messages`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "set_important",
        messageId: sent.body.userMessage.id,
        important: true
      })
    }
  );
  assert(
    importantMessage.body.message?.metadata?.important === true,
    "message importance should be stored in metadata"
  );
  assert(
    importantMessage.body.message?.metadata?.importantUpdatedAt,
    "message importance should record update time"
  );
  assertInvalidJsonResponse(
    await request(
      `/api/conversations/${encodeURIComponent(created.body.companion.conversationId)}/messages`,
      {
        method: "PATCH",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "message update"
  );
  pass("PATCH /api/conversations/:id/messages marks important message");

  const deletedUserMessage = await request(
    `/api/conversations/${encodeURIComponent(
      created.body.companion.conversationId
    )}/messages?messageId=${encodeURIComponent(sent.body.userMessage.id)}`,
    { method: "DELETE" }
  );
  assert(deletedUserMessage.body.deleted === true, "message delete should return deleted=true");

  const messagesAfterDelete = await request(
    `/api/conversations/${encodeURIComponent(created.body.companion.conversationId)}/messages`
  );
  assert(
    !messagesAfterDelete.body.messages.some((message) => message.id === sent.body.userMessage.id),
    "deleted messages should be hidden from conversation history"
  );
  pass("DELETE /api/conversations/:id/messages hides deleted message");

  const activatedMemory = await request(
    `/api/memories/${encodeURIComponent(sent.body.pendingMemory.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: "active" })
    }
  );
  assert(activatedMemory.body.memory?.status === "active", "pending memory should become active");
  pass("PATCH /api/memories/:id activate pending memory");

  const editedMemoryContent = "候选记忆：用户害怕重要关系突然断联，希望回应更稳定。";
  const editedMemory = await request(
    `/api/memories/${encodeURIComponent(sent.body.pendingMemory.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        content: editedMemoryContent,
        type: "relationship_event"
      })
    }
  );
  assert(
    editedMemory.body.memory?.content === editedMemoryContent,
    "memory content should be editable"
  );
  assert(editedMemory.body.memory?.status === "active", "memory edit should preserve status");
  assert(
    editedMemory.body.memory?.type === "relationship_event",
    "memory type should be editable"
  );
  assertInvalidJsonResponse(
    await request(
      `/api/memories/${encodeURIComponent(sent.body.pendingMemory.id)}`,
      {
        method: "PATCH",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "memory update"
  );
  const emptyMemoryEdit = await request(
    `/api/memories/${encodeURIComponent(sent.body.pendingMemory.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ content: "   " })
    },
    { allowError: true }
  );
  assert(
    emptyMemoryEdit.response.status === 400 &&
      emptyMemoryEdit.body.error === "content is required",
    "memory update should reject empty content"
  );
  const memoriesAfterRejectedEmptyEdit = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/memories`
  );
  assert(
    memoriesAfterRejectedEmptyEdit.body.memories?.find(
      (memory) => memory.id === sent.body.pendingMemory.id
    )?.content === editedMemoryContent,
    "rejected empty memory edit should preserve existing content"
  );
  pass("PATCH /api/memories/:id edit memory content");

  const accidentalExportSecret = "accidental-export-secret-value-012345";
  const providerEndpointInMemory = "https://gateway.example.com/v1";
  const accidentalBearerToken = ["accidental", "Bearer", "Token", "Value", "0123456789"].join("");
  const accidentalDatabaseUrl = ["postgres", "ql://export-user:export-password@db.example.com:5432/app"].join("");
  const accidentalGithubToken = ["github", "_pat_", "fixture", "_".repeat(2), "token".repeat(8)].join("");
  const accidentalMessageSecret = "accidental-message-secret-value-012345";
  const providerEndpointInMessage = "https://tryanotherone.example.com/v1/chat/completions";
  const accidentalRawPayload = "export-raw-payload-should-not-leak";
  const accidentalStackValue = "ExportProviderStackTraceShouldStayPrivate";
  const accidentalStackFrame = "at provider.fetch (src/lib/provider.ts:12:3)";
  const memoryWithAccidentalSecrets = await request(
    `/api/memories/${encodeURIComponent(sent.body.pendingMemory.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        content: [
          "候选记忆：用户想确认导出脱敏。",
          `token=${accidentalExportSecret}`,
          `endpoint ${providerEndpointInMemory}`,
          `Authorization: Bearer ${accidentalBearerToken}`,
          `DATABASE_URL=${accidentalDatabaseUrl}`,
          `external token ${accidentalGithubToken}`,
          `rawPayload=${accidentalRawPayload}`,
          `stack=${accidentalStackValue}`,
          accidentalStackFrame
        ].join(" ")
      })
    }
  );
  assert(
    memoryWithAccidentalSecrets.body.memory?.content.includes(accidentalExportSecret),
    "memory fixture should preserve accidental secret before export scrub"
  );
  pass("PATCH /api/memories/:id stores accidental secret fixture for export scrub");

  const messageWithAccidentalSecrets = await request(
    `/api/conversations/${encodeURIComponent(created.body.companion.conversationId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content: [
          "我不小心把连接信息贴进聊天。",
          `api_key=${accidentalMessageSecret}`,
          `endpoint ${providerEndpointInMessage}`
        ].join(" ")
      })
    }
  );
  assert(
    messageWithAccidentalSecrets.body.userMessage?.content.includes(accidentalMessageSecret),
    "message fixture should preserve accidental secret before export scrub"
  );
  assert(
    !messageWithAccidentalSecrets.body.pendingMemory?.content?.includes(accidentalMessageSecret) &&
      !messageWithAccidentalSecrets.body.pendingMemory?.content?.includes(providerEndpointInMessage),
    "automatic pending memory should not amplify accidental message secrets"
  );
  pass("POST /api/conversations/:id/messages stores accidental secret fixture for export scrub");

  const relationshipStateRead = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/relationship-state`
  );
  assert(
    relationshipStateRead.body.data?.companionId === created.body.companion.id,
    "relationship state API should read the current user's persisted state"
  );
  assert(
    relationshipStateRead.body.persistence === "prisma" ||
      relationshipStateRead.body.persistence === "memory",
    "relationship state API should report repository persistence"
  );
  assert(
    !JSON.stringify(relationshipStateRead.body).includes("DEV-9") &&
      relationshipStateRead.body.persistence !== "mock",
    "relationship state API should not expose stale mock handoff metadata"
  );

  const relationshipStateUpdate = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/relationship-state`,
    {
      method: "POST",
      body: JSON.stringify({
        signal: {
          userMessage: "这是我们第一次认真约定生日那天也要互相说一句在。",
          sourceMessageId: sent.body.userMessage.id,
          createdAt: sent.body.userMessage.createdAt
        }
      })
    }
  );
  assert(
    relationshipStateUpdate.body.data?.state?.importantEvents?.length > 0,
    "relationship state API should create important event timeline entries"
  );
  assert(
    relationshipStateUpdate.body.data?.changes?.importantEventsAdded?.length === 1,
    "relationship state API should explain important event additions"
  );
  assertInvalidJsonResponse(
    await request(
      `/api/companions/${encodeURIComponent(created.body.companion.id)}/relationship-state`,
      {
        method: "POST",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "relationship state update"
  );
  pass("POST /api/companions/:id/relationship-state updates timeline");

  const proactiveSecret = "proactive-secret-value-012345";
  const proactiveEndpoint = "https://proactive.gateway.example.com/v1/chat/completions";
  const proactiveRawPayload = "proactive-raw-payload-should-not-leak";
  const proactive = await request(
    `/api/companions/${encodeURIComponent(created.body.companion.id)}/proactive-drafts`,
    {
      method: "POST",
      body: JSON.stringify({
        companion: {
          id: created.body.companion.id,
          name: created.body.companion.name,
          relationshipKind: created.body.companion.relationshipKind,
          customKind: created.body.companion.customKind,
          userAddress: created.body.companion.userAddress,
          companionAddress: created.body.companion.companionAddress,
          personality: created.body.companion.personality,
          speakingStyle: created.body.companion.speakingStyle,
          background: created.body.companion.background,
          boundaries: created.body.companion.boundaries,
          immersionEnabled: created.body.companion.immersionEnabled
        },
        state: {
          companionId: created.body.companion.id,
          familiarityScore: 12,
          closenessScore: 10,
          recentEmotion: "想念",
          importantEvents: [],
          lastInteractionAt: null,
          explanation: "smoke"
        },
        lastUserMessage: [
          "我今天有点想你。",
          `api_key=${proactiveSecret}`,
          proactiveEndpoint,
          `rawPayload="${proactiveRawPayload}"`
        ].join(" "),
        proactiveMessagesEnabled: true,
        frequencyHours: 0
      })
    }
  );
  assert(Array.isArray(proactive.body.data), "proactive drafts should return an array");
  assert(proactive.body.data.length > 0, "proactive drafts should include at least one draft");
  assert(
    proactive.body.frequency?.everyMinutes === 1 &&
      proactive.body.frequency?.preset === "1m",
    "proactive drafts should normalize zero-hour manual requests back to one minute"
  );
  assert(
    proactive.body.data.every((draft) => draft.safety?.action !== "block"),
    "proactive drafts should pass postflight safety"
  );
  assert(
    proactive.body.data.every((draft) => draft.status === "draft"),
    "proactive drafts should be saved as draft records"
  );
  assert(
    proactive.body.persistence === "prisma" || proactive.body.persistence === "memory",
    "proactive drafts should report repository persistence"
  );
  assert(
    !JSON.stringify(proactive.body).includes(proactiveSecret) &&
      !JSON.stringify(proactive.body).includes(proactiveEndpoint) &&
      !JSON.stringify(proactive.body).includes(proactiveRawPayload),
    "proactive drafts should not amplify accidental secrets from lastUserMessage"
  );
  assertInvalidJsonResponse(
    await request(
      `/api/companions/${encodeURIComponent(created.body.companion.id)}/proactive-drafts`,
      {
        method: "POST",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "proactive draft creation"
  );
  pass("POST /api/companions/:id/proactive-drafts");

  const updatedProactiveMessage = await request(
    `/api/proactive-messages/${encodeURIComponent(proactive.body.data[0].id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: "dismissed" })
    }
  );
  assert(
    updatedProactiveMessage.body.proactiveMessage?.status === "dismissed",
    "proactive message status should update to dismissed"
  );
  assert(
    !JSON.stringify(updatedProactiveMessage.body).includes("Bearer") &&
      !JSON.stringify(updatedProactiveMessage.body).includes("baseUrl"),
    "proactive message update response should not expose provider credentials"
  );
  assertJsonObjectRequiredResponse(
    await request(
      `/api/proactive-messages/${encodeURIComponent(proactive.body.data[0].id)}`,
      {
        method: "PATCH",
        body: "null"
      },
      { allowError: true }
    ),
    "proactive message update"
  );
  pass("PATCH /api/proactive-messages/:id updates draft status");

  const schedulerNow = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const proactiveEmptyBodyRun = await request("/api/proactive/run", { method: "POST" });
  assert(
    proactiveEmptyBodyRun.body.dryRun === true && proactiveEmptyBodyRun.body.savedCount === 0,
    "proactive scheduler should keep empty-body requests as default dry-runs"
  );
  assertInvalidJsonResponse(
    await request(
      "/api/proactive/run",
      {
        method: "POST",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "proactive scheduler"
  );
  assertJsonObjectRequiredResponse(
    await request(
      "/api/proactive/run",
      {
        method: "POST",
        body: "null"
      },
      { allowError: true }
    ),
    "proactive scheduler"
  );

  const proactiveDryRun = await request("/api/proactive/run", {
    method: "POST",
    body: JSON.stringify({
      dryRun: true,
      limit: 1,
      maxDrafts: 2,
      now: schedulerNow
    })
  });
  assert(proactiveDryRun.body.dryRun === true, "proactive scheduler dry-run should be reported");
  assert(proactiveDryRun.body.maxDrafts === 2, "proactive scheduler should report normalized maxDrafts");
  assert(
    proactiveDryRun.body.generatedCount > 0,
    "proactive scheduler dry-run should generate due draft candidates"
  );
  assert(
    proactiveDryRun.body.generatedCount <= 2,
    "proactive scheduler dry-run should respect maxDrafts"
  );
  assert(proactiveDryRun.body.savedCount === 0, "proactive scheduler dry-run should not save drafts");
  pass("POST /api/proactive/run dry-run");

  const proactiveRun = await request("/api/proactive/run", {
    method: "POST",
    body: JSON.stringify({
      dryRun: false,
      limit: 1,
      now: schedulerNow
    })
  });
  assert(proactiveRun.body.dryRun === false, "proactive scheduler run should report dryRun=false");
  assert(proactiveRun.body.savedCount > 0, "proactive scheduler run should save due drafts");
  assert(
    proactiveRun.body.savedCount <= proactiveRun.body.maxDrafts,
    "proactive scheduler run should not save more than maxDrafts"
  );
  assert(
    !JSON.stringify(proactiveRun.body).includes("PROACTIVE_CRON_SECRET"),
    "proactive scheduler response should not expose cron secret"
  );
  pass("POST /api/proactive/run saves due drafts");

  const proactiveRunAgain = await request("/api/proactive/run", {
    method: "POST",
    body: JSON.stringify({
      dryRun: false,
      limit: 1,
      now: schedulerNow
    })
  });
  assert(
    proactiveRunAgain.body.generatedCount === 0 &&
      proactiveRunAgain.body.savedCount === 0,
    "proactive scheduler should not generate duplicate drafts immediately after a saved run"
  );
  assert(
    proactiveRunAgain.body.results?.some((item) => item.reason === "尚未到达主动回响候选时间。"),
    "proactive scheduler should use saved proactive drafts as the next timing anchor"
  );
  pass("POST /api/proactive/run avoids immediate duplicate drafts");

  const proactiveAllWithoutSecret = await request(
    "/api/proactive/run",
    {
      method: "POST",
      body: JSON.stringify({
        scope: "all",
        dryRun: true,
        limit: 1
      })
    },
    { allowError: true }
  );
  assert(
    proactiveAllWithoutSecret.response.status === 401,
    "all-user proactive scheduler should require cron secret"
  );
  pass("POST /api/proactive/run all scope requires secret");

  const wrongCronSecret = "wrong-cron-secret-placeholder";
  const proactiveAllWithWrongSecret = await request(
    "/api/proactive/run",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${wrongCronSecret}`
      },
      body: JSON.stringify({
        scope: "all",
        dryRun: true,
        limit: 1
      })
    },
    { allowError: true }
  );
  assert(
    proactiveAllWithWrongSecret.response.status === 401,
    "all-user proactive scheduler should reject an incorrect cron secret"
  );
  assert(
    !JSON.stringify(proactiveAllWithWrongSecret.body).includes(wrongCronSecret) &&
      !JSON.stringify(proactiveAllWithWrongSecret.body).includes(SMOKE_CRON_SECRET),
    "all-user proactive scheduler auth failure should not echo cron secret values"
  );
  pass("POST /api/proactive/run all scope rejects wrong secret");

  const proactiveAllWithBearerSecret = await request("/api/proactive/run", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SMOKE_CRON_SECRET}`
    },
    body: JSON.stringify({
      scope: "all",
      dryRun: true,
      limit: 1,
      maxDrafts: 1,
      now: schedulerNow
    })
  });
  assert(
    proactiveAllWithBearerSecret.body.scope === "all" &&
      proactiveAllWithBearerSecret.body.authMode === "cron-secret",
    "all-user proactive scheduler should accept Bearer cron secret"
  );
  assert(
    proactiveAllWithBearerSecret.body.scannedCount <= 1 &&
      proactiveAllWithBearerSecret.body.generatedCount <= 1 &&
      proactiveAllWithBearerSecret.body.savedCount === 0,
    "all-user proactive scheduler should respect limit, maxDrafts, and dry-run with Bearer auth"
  );
  assert(
    !JSON.stringify(proactiveAllWithBearerSecret.body).includes(SMOKE_CRON_SECRET),
    "all-user proactive scheduler Bearer response should not echo cron secret"
  );
  pass("POST /api/proactive/run all scope accepts Bearer secret");

  const proactiveAllWithHeaderSecret = await request("/api/proactive/run", {
    method: "POST",
    headers: {
      "x-proactive-cron-secret": SMOKE_CRON_SECRET
    },
    body: JSON.stringify({
      scope: "all",
      dryRun: true,
      limit: 999,
      maxDrafts: 999,
      now: schedulerNow
    })
  });
  assert(
    proactiveAllWithHeaderSecret.body.scope === "all" &&
      proactiveAllWithHeaderSecret.body.authMode === "cron-secret",
    "all-user proactive scheduler should accept x-proactive-cron-secret"
  );
  assert(
    proactiveAllWithHeaderSecret.body.scannedCount <= 100 &&
      proactiveAllWithHeaderSecret.body.maxDrafts === 200 &&
      proactiveAllWithHeaderSecret.body.savedCount === 0,
    "all-user proactive scheduler should clamp oversized limit/maxDrafts in dry-run"
  );
  assert(
    !JSON.stringify(proactiveAllWithHeaderSecret.body).includes(SMOKE_CRON_SECRET),
    "all-user proactive scheduler header response should not echo cron secret"
  );
  pass("POST /api/proactive/run all scope accepts header secret and clamps guards");

  const me = await request("/api/me");
  assert(me.body.user?.id, "me endpoint should return a user");
  pass("GET /api/me");

  const updatedMe = await request("/api/me", {
    method: "PATCH",
    body: JSON.stringify({
      nickname: "Smoke 更新用户",
      timezone: "Asia/Shanghai",
      language: "zh-CN",
      proactiveMessagesEnabled: false,
      proactiveFrequencyHours: 3
    })
  });
  assert(updatedMe.body.user?.nickname === "Smoke 更新用户", "profile update should persist nickname");
  assert(
    updatedMe.body.user?.proactiveMessagesEnabled === false,
    "profile update should disable proactive globally"
  );
  assert(
    updatedMe.body.user?.proactiveFrequencyHours === 3,
    "profile update should persist custom proactive frequency"
  );
  const meAfterPatch = await request("/api/me");
  assert(
    meAfterPatch.body.user?.proactiveMessagesEnabled === false,
    "GET /api/me should read updated proactive setting"
  );
  const disabledProactiveRun = await request("/api/proactive/run", {
    method: "POST",
    body: JSON.stringify({
      dryRun: true,
      now: schedulerNow,
      maxDrafts: 2
    })
  });
  assert(
    disabledProactiveRun.body.generatedCount === 0 && disabledProactiveRun.body.savedCount === 0,
    "global proactive disable should prevent draft generation"
  );
  assert(
    disabledProactiveRun.body.results?.some((item) => item.reason === "主动回响已关闭。"),
    "scheduler should explain global proactive disable"
  );
  pass("PATCH /api/me persists profile and disables proactive scheduler");

  const rejectedProfilePatch = await request(
    "/api/me",
    {
      method: "PATCH",
      body: JSON.stringify({
        nickname: "x".repeat(41),
        proactiveMessagesEnabled: "false",
        proactiveFrequencyHours: 0
      })
    },
    { allowError: true }
  );
  assert(
    rejectedProfilePatch.response.status === 400 &&
      !JSON.stringify(rejectedProfilePatch.body).includes("Bearer") &&
      !JSON.stringify(rejectedProfilePatch.body).includes("baseUrl") &&
      !JSON.stringify(rejectedProfilePatch.body).includes("stack"),
    "profile validation error should return a sanitized 400"
  );
  const meAfterRejectedProfilePatch = await request("/api/me");
  assert(
    meAfterRejectedProfilePatch.body.user?.proactiveMessagesEnabled === false &&
      meAfterRejectedProfilePatch.body.user?.proactiveFrequencyHours === 3,
    "rejected profile update should not partially mutate existing profile settings"
  );
  pass("PATCH /api/me rejects invalid profile without partial writes");

  const fakeKey = "vault-test-user-key-value";
  const savedEndpoint = "https://gateway.example.com/v1";
  const credential = await request("/api/me/llm-credential", {
    method: "PUT",
    body: JSON.stringify({
      provider: "compatible",
      apiKey: fakeKey,
      baseUrl: savedEndpoint,
      model: ""
    })
  });
  assert(credential.body.credential?.configured === true, "credential should be marked configured");
  assert(
    credential.body.credential?.model === null,
    "credential should allow saving a key before model selection"
  );
  assert(
    credential.body.credential?.keyPreview === "...alue",
    "credential response should only include key preview"
  );
  assert(
    !JSON.stringify(credential.body).includes(fakeKey),
    "credential response should not include raw api key"
  );
  assert(
    credential.body.credential?.endpointConfigured === true &&
      credential.body.credential?.endpointFingerprint &&
      !JSON.stringify(credential.body).includes(savedEndpoint) &&
      !JSON.stringify(credential.body).includes("baseUrl"),
    "credential response should expose only sanitized endpoint metadata"
  );

  const updatedCredential = await request("/api/me/llm-credential", {
    method: "PUT",
    body: JSON.stringify({
      provider: "compatible",
      model: "smoke-model-updated"
    })
  });
  assert(
    updatedCredential.body.credential?.model === "smoke-model-updated",
    "credential update should save model without re-entering api key"
  );
  assert(
    updatedCredential.body.credential?.keyPreview === "...alue" &&
      updatedCredential.body.credential?.keyFingerprint === credential.body.credential?.keyFingerprint,
    "credential update without api key should preserve saved key metadata"
  );
  assert(
    !JSON.stringify(updatedCredential.body).includes(fakeKey),
    "credential config update response should not include raw api key"
  );
  assert(
    updatedCredential.body.credential?.endpointConfigured === true &&
      updatedCredential.body.credential?.endpointFingerprint ===
        credential.body.credential?.endpointFingerprint &&
      !JSON.stringify(updatedCredential.body).includes(savedEndpoint) &&
      !JSON.stringify(updatedCredential.body).includes("baseUrl"),
    "credential config update should preserve endpoint without returning it"
  );

  const credentialStatus = await request("/api/me/llm-credential");
  assert(
    credentialStatus.body.credential?.keyFingerprint,
    "credential status should include a stable fingerprint"
  );
  assert(
    credentialStatus.body.credential?.model === "smoke-model-updated",
    "credential status should include the updated selected model"
  );
  assert(
    !JSON.stringify(credentialStatus.body).includes(fakeKey),
    "credential status should not expose raw api key"
  );
  assert(
    credentialStatus.body.credential?.endpointConfigured === true &&
      credentialStatus.body.credential?.endpointFingerprint ===
        credential.body.credential?.endpointFingerprint &&
      !JSON.stringify(credentialStatus.body).includes(savedEndpoint) &&
      !JSON.stringify(credentialStatus.body).includes("baseUrl"),
    "credential status should not expose raw endpoint URL or baseUrl field"
  );

  const exportedWithCredential = await request("/api/me/export");
  const exportedText = JSON.stringify(exportedWithCredential.body);
  assert(
    exportedWithCredential.body.schemaVersion === "m14-data-export-snapshot:v1",
    "user export should include a stable schema version"
  );
  assert(
    exportedWithCredential.body.userId === me.body.user.id,
    "user export should be scoped to the current session user"
  );
  assert(
    exportedWithCredential.body.credentialSummary?.llm?.configured === true,
    "user export should include sanitized credential configuration state"
  );
  assert(
    exportedWithCredential.body.credentialSummary?.llm?.model === "smoke-model-updated",
    "user export should include selected model metadata"
  );
  assert(
    exportedWithCredential.body.counts?.companions >= 1 &&
      exportedWithCredential.body.counts?.messages >= 1 &&
      exportedWithCredential.body.counts?.memories >= 1,
    "user export should include companions, messages and memories"
  );
  assert(
    Array.isArray(exportedWithCredential.body.modelUsageLogs),
    "user export should include sanitized model call logs"
  );
  assert(
    !exportedText.includes(fakeKey) &&
      !exportedText.includes("https://gateway.example.com/v1") &&
      !exportedText.includes(accidentalExportSecret) &&
      !exportedText.includes(accidentalBearerToken) &&
      !exportedText.includes(accidentalDatabaseUrl) &&
      !exportedText.includes(accidentalGithubToken) &&
      !exportedText.includes(accidentalMessageSecret) &&
      !exportedText.includes(providerEndpointInMessage) &&
      !exportedText.includes(accidentalRawPayload) &&
      !exportedText.includes(accidentalStackValue) &&
      !exportedText.includes(accidentalStackFrame) &&
      !exportedText.includes(deletedManualMemoryId) &&
      !exportedText.includes(deletedManualMemoryContent) &&
      !exportedText.includes("rawPayload") &&
      !exportedText.includes("src/lib/provider.ts") &&
      !exportedText.includes("baseUrl") &&
      !exportedText.includes("encryptedApiKey") &&
      !exportedText.includes("keyIv") &&
      !exportedText.includes("keyAuthTag"),
    "user export should not expose provider secrets, endpoint URL, accidental debug strings, deleted memories or vault ciphertext"
  );
  assert(
    exportedText.includes("[REDACTED_SECRET]") &&
      exportedText.includes("[REDACTED_PROVIDER_ENDPOINT]") &&
      exportedText.includes("[REDACTED_DATABASE_URL]") &&
      exportedText.includes("Bearer [REDACTED]") &&
      exportedText.includes("[REDACTED_DEBUG_FIELD]") &&
      exportedText.includes("[REDACTED_STACK]"),
    "user export should replace accidental high-risk secret and debug strings with placeholders"
  );
  pass("GET /api/me/export sanitized user snapshot");

  const profileEndpoint = "https://profile-gateway.example.com";
  const profileToken = "token=profile-secret-0123456789";
  await request("/api/me", {
    method: "PATCH",
    body: JSON.stringify({
      nickname: profileToken,
      timezone: profileEndpoint,
      language: "zh-CN"
    })
  });
  const exportedWithProfileSecrets = await request("/api/me/export");
  const exportedProfileText = JSON.stringify(exportedWithProfileSecrets.body);
  assert(
    !exportedProfileText.includes(profileEndpoint) &&
      !exportedProfileText.includes("profile-secret-0123456789") &&
      exportedProfileText.includes("[REDACTED_PROVIDER_ENDPOINT]") &&
      exportedProfileText.includes("[REDACTED_SECRET]"),
    "user export should scrub high-risk strings from profile fields"
  );

  const voiceWithUserCredential = await request("/api/voice/synthesize", {
    method: "POST",
    body: JSON.stringify({
      text: "用户 vault 语音链路",
      voice: "warm",
      format: "wav"
    })
  });
  assert(
    typeof voiceWithUserCredential.body.audioBase64 === "string" &&
      voiceWithUserCredential.body.audioBase64.length > 0,
    "voice synthesis should work when user vault credential is present"
  );
  assert(
    voiceWithUserCredential.body.credentialSource === "user-vault" &&
      voiceWithUserCredential.body.requestedProvider === "shared-llm" &&
      voiceWithUserCredential.body.fallback === true,
    "voice synthesis should report sanitized shared-LLM user-vault fallback metadata"
  );
  assert(
    !JSON.stringify(voiceWithUserCredential.body).includes(fakeKey) &&
      !JSON.stringify(voiceWithUserCredential.body).includes(savedEndpoint) &&
      !JSON.stringify(voiceWithUserCredential.body).includes("baseUrl") &&
      !JSON.stringify(voiceWithUserCredential.body).includes("raw"),
    "voice synthesis with user credential should not expose key or endpoint"
  );
  pass("POST /api/voice/synthesize uses sanitized user vault fallback");

  const nonCompatibleCredential = await request("/api/me/llm-credential", {
    method: "PUT",
    body: JSON.stringify({
      provider: "anthropic",
      model: "claude-smoke-model"
    })
  });
  assert(
    nonCompatibleCredential.body.credential?.provider === "anthropic" &&
      nonCompatibleCredential.body.credential?.configured === true,
    "credential update should allow switching to a non-compatible provider without re-entering api key"
  );
  const modelListWithNonCompatibleProvider = await request(
    "/api/me/llm-models",
    {},
    { allowError: true }
  );
  assert(
    modelListWithNonCompatibleProvider.response.status === 400,
    "model list should reject saved non-compatible providers"
  );
  assert(
    typeof modelListWithNonCompatibleProvider.body.error === "string" &&
      modelListWithNonCompatibleProvider.body.error.includes("兼容中转站"),
    "model list should return stable copy for saved non-compatible providers"
  );
  assert(
    !JSON.stringify(modelListWithNonCompatibleProvider.body).includes(fakeKey) &&
      !JSON.stringify(modelListWithNonCompatibleProvider.body).includes(savedEndpoint) &&
      !JSON.stringify(modelListWithNonCompatibleProvider.body).includes("Bearer") &&
      !JSON.stringify(modelListWithNonCompatibleProvider.body).includes("baseUrl") &&
      !JSON.stringify(modelListWithNonCompatibleProvider.body).includes("rawPayload"),
    "model list non-compatible provider errors should not expose key, endpoint, headers, or raw payload"
  );
  pass("GET /api/me/llm-models rejects saved non-compatible providers");

  const invalidEndpoint = "https://%";
  const credentialWithInvalidEndpoint = await request("/api/me/llm-credential", {
    method: "PUT",
    body: JSON.stringify({
      provider: "compatible",
      baseUrl: invalidEndpoint,
      model: "smoke-model-updated"
    })
  });
  assert(
    credentialWithInvalidEndpoint.body.credential?.endpointConfigured === true,
    "credential should allow endpoint update without re-entering api key"
  );
  const modelListWithProviderFailure = await request(
    "/api/me/llm-models",
    {},
    { allowError: true }
  );
  assert(
    modelListWithProviderFailure.response.status === 400,
    "model list provider failure should return 400"
  );
  assert(
    !JSON.stringify(modelListWithProviderFailure.body).includes(invalidEndpoint) &&
      !JSON.stringify(modelListWithProviderFailure.body).includes(savedEndpoint) &&
      !JSON.stringify(modelListWithProviderFailure.body).includes(fakeKey) &&
      !JSON.stringify(modelListWithProviderFailure.body).includes("Bearer") &&
      !JSON.stringify(modelListWithProviderFailure.body).includes("baseUrl") &&
      !JSON.stringify(modelListWithProviderFailure.body).includes("rawPayload"),
    "model list provider failures should not expose endpoint, key, headers, or raw payload"
  );
  pass("GET /api/me/llm-models sanitizes provider failures");

  const llmTestWithInvalidEndpoint = await request(
    "/api/me/llm-test",
    {
      method: "POST",
      body: JSON.stringify({
        provider: "compatible",
        baseUrl: invalidEndpoint,
        model: "smoke-model-updated",
        prompt: "invalid-url-prompt-should-not-leak",
        rawPayload: "invalid-url-raw-payload-should-not-leak"
      })
    },
    { allowError: true }
  );
  assert(
    llmTestWithInvalidEndpoint.body.ok === false &&
      llmTestWithInvalidEndpoint.body.errorType === "network",
    "LLM connection test URL construction failures should return a sanitized network failure"
  );
  assertNoSensitiveProviderDetails(
    llmTestWithInvalidEndpoint.body,
    "LLM connection test URL construction failure",
    [
      invalidEndpoint,
      savedEndpoint,
      fakeKey,
      "invalid-url-prompt-should-not-leak",
      "invalid-url-raw-payload-should-not-leak"
    ]
  );
  pass("POST /api/me/llm-test sanitizes URL construction failures");

  const unsupportedCredentialProvider = await request(
    "/api/me/llm-credential",
    {
      method: "PUT",
      body: JSON.stringify({
        provider: "unsupported-provider",
        apiKey: fakeKey,
        baseUrl: savedEndpoint,
        model: "smoke-model-updated"
      })
    },
    { allowError: true }
  );
  assert(
    unsupportedCredentialProvider.response.status === 400 &&
      unsupportedCredentialProvider.body.error === "Unsupported provider.",
    "credential save should return stable copy for unsupported providers"
  );
  const malformedCredentialEndpoint = await request(
    "/api/me/llm-credential",
    {
      method: "PUT",
      body: JSON.stringify({
        provider: "compatible",
        apiKey: fakeKey,
        baseUrl: "gateway.example.com/v1",
        model: "smoke-model-updated"
      })
    },
    { allowError: true }
  );
  assert(
    malformedCredentialEndpoint.response.status === 400 &&
      malformedCredentialEndpoint.body.error === "Base URL must start with http:// or https://.",
    "credential save should return stable copy for malformed endpoints"
  );
  const nonStringCredentialEndpoint = await request(
    "/api/me/llm-credential",
    {
      method: "PUT",
      body: JSON.stringify({
        provider: "compatible",
        apiKey: fakeKey,
        baseUrl: 12345,
        model: "smoke-model-updated"
      })
    },
    { allowError: true }
  );
  assert(
    nonStringCredentialEndpoint.response.status === 400 &&
      nonStringCredentialEndpoint.body.error === "baseUrl must be a string.",
    "credential save should reject non-string endpoint values"
  );
  assert(
    !JSON.stringify(unsupportedCredentialProvider.body).includes(fakeKey) &&
      !JSON.stringify(unsupportedCredentialProvider.body).includes(savedEndpoint) &&
      !JSON.stringify(malformedCredentialEndpoint.body).includes(fakeKey) &&
      !JSON.stringify(malformedCredentialEndpoint.body).includes("gateway.example.com/v1") &&
      !JSON.stringify(nonStringCredentialEndpoint.body).includes(fakeKey) &&
      !JSON.stringify(malformedCredentialEndpoint.body).includes("Bearer") &&
      !JSON.stringify(malformedCredentialEndpoint.body).includes("baseUrl"),
    "credential validation errors should not expose submitted key or endpoint values"
  );
  pass("PUT /api/me/llm-credential rejects non-string endpoint");
  pass("PUT /api/me/llm-credential returns stable validation errors");

  const deletedCredential = await request("/api/me/llm-credential", { method: "DELETE" });
  assert(
    deletedCredential.body.credential?.configured === false,
    "credential delete should clear user vault state"
  );

  const updateWithoutSavedKey = await request(
    "/api/me/llm-credential",
    {
      method: "PUT",
      body: JSON.stringify({
        provider: "compatible",
        baseUrl: "https://gateway.example.com/v1",
        model: "smoke-model-without-key"
      })
    },
    { allowError: true }
  );
  assert(
    updateWithoutSavedKey.response.status === 400,
    "credential update without a saved key should require api key"
  );
  assertInvalidJsonResponse(
    await request(
      "/api/me/llm-credential",
      {
        method: "PUT",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "credential save"
  );
  assertJsonObjectRequiredResponse(
    await request(
      "/api/me/llm-credential",
      {
        method: "PUT",
        body: "[]"
      },
      { allowError: true }
    ),
    "credential save"
  );
  pass("PUT/GET/DELETE /api/me/llm-credential sanitized vault");

  const modelListWithoutKey = await request("/api/me/llm-models", {}, { allowError: true });
  assert(
    modelListWithoutKey.response.status === 400,
    "model list without a key should return 400"
  );
  assert(
    typeof modelListWithoutKey.body.error === "string" &&
      modelListWithoutKey.body.error.includes("API key"),
    "model list without a key should explain that a key is required"
  );
  assert(
    !JSON.stringify(modelListWithoutKey.body).includes("Bearer") &&
      !JSON.stringify(modelListWithoutKey.body).includes("baseUrl"),
    "model list errors should not expose provider credentials"
  );
  pass("GET /api/me/llm-models requires saved key");

  const llmTestWithoutKey = await request("/api/me/llm-test", {
    method: "POST",
    body: JSON.stringify({
      provider: "compatible",
      baseUrl: "https://gateway.example.com/v1",
      model: "smoke-model-without-key"
    })
  });
  assert(llmTestWithoutKey.body.ok === false, "LLM connection test without key should fail predictably");
  assert(
    llmTestWithoutKey.body.errorType === "missing_api_key",
    "LLM connection test without key should report missing_api_key"
  );
  assert(
    typeof llmTestWithoutKey.body.latencyMs === "number",
    "LLM connection test should include latency metadata"
  );
  assert(
    llmTestWithoutKey.body.provider === "compatible" &&
      llmTestWithoutKey.body.model === "smoke-model-without-key",
    "LLM connection test should return provider and model metadata"
  );
  assert(
    !("baseUrl" in llmTestWithoutKey.body) &&
      !("prompt" in llmTestWithoutKey.body) &&
      !("rawPayload" in llmTestWithoutKey.body) &&
      !JSON.stringify(llmTestWithoutKey.body).includes("https://gateway.example.com/v1") &&
      !JSON.stringify(llmTestWithoutKey.body).includes(fakeKey) &&
      !JSON.stringify(llmTestWithoutKey.body).includes("Bearer"),
    "LLM connection test response should stay sanitized"
  );
  assertJsonObjectRequiredResponse(
    await request(
      "/api/me/llm-test",
      {
        method: "POST",
        body: "null"
      },
      { allowError: true }
    ),
    "LLM connection test"
  );
  pass("POST /api/me/llm-test sanitized missing-key result");

  const sensitivePrompt = "connection-test-prompt-value";
  const sensitiveRawPayload = "connection-test-raw-payload-value";
  const sensitiveProviderStack = "ProviderStackTraceShouldStayServerSide";
  const sensitiveProvider = await startSensitiveModelProviderServer(() =>
    JSON.stringify({
      error: {
        message:
          `Authorization: Bearer ${fakeKey}; endpoint=${sensitiveProvider.url}; ` +
          `prompt=${sensitivePrompt}; rawPayload=${sensitiveRawPayload}; stack=${sensitiveProviderStack}`
      }
    })
  );
  try {
    await request("/api/me/llm-credential", {
      method: "PUT",
      body: JSON.stringify({
        provider: "compatible",
        apiKey: fakeKey,
        baseUrl: sensitiveProvider.url,
        model: "smoke-provider-failure-model"
      })
    });

    const modelListProviderError = await request("/api/me/llm-models", {}, { allowError: true });
    assert(
      modelListProviderError.response.status === 400,
      "model list provider HTTP failures should return 400"
    );
    assertNoSensitiveProviderDetails(modelListProviderError.body, "model list provider HTTP failure", [
      fakeKey,
      sensitiveProvider.url,
      sensitivePrompt,
      sensitiveRawPayload,
      sensitiveProviderStack
    ]);

    const llmTestProviderError = await request(
      "/api/me/llm-test",
      {
        method: "POST",
        body: JSON.stringify({
          provider: "compatible",
          baseUrl: sensitiveProvider.url,
          model: "smoke-provider-failure-model",
          prompt: sensitivePrompt,
          rawPayload: sensitiveRawPayload
        })
      },
      { allowError: true }
    );
    assert(llmTestProviderError.body.ok === false, "LLM connection test provider failures should fail safely");
    assert(
      llmTestProviderError.body.errorType === "provider_response",
      "LLM connection test provider HTTP failures should classify provider responses"
    );
    assertNoSensitiveProviderDetails(llmTestProviderError.body, "LLM connection test provider HTTP failure", [
      fakeKey,
      sensitiveProvider.url,
      sensitivePrompt,
      sensitiveRawPayload,
      sensitiveProviderStack
    ]);

    const unreachableProviderUrl = `http://127.0.0.1:${await findAvailablePort(39000)}`;
    await request("/api/me/llm-credential", {
      method: "PUT",
      body: JSON.stringify({
        provider: "compatible",
        apiKey: fakeKey,
        baseUrl: unreachableProviderUrl,
        model: "smoke-fetch-failure-model"
      })
    });

    const modelListFetchError = await request("/api/me/llm-models", {}, { allowError: true });
    assert(
      modelListFetchError.response.status === 400,
      "model list fetch failures should return 400"
    );
    assertNoSensitiveProviderDetails(modelListFetchError.body, "model list fetch failure", [
      fakeKey,
      unreachableProviderUrl,
      sensitivePrompt,
      sensitiveRawPayload,
      sensitiveProviderStack
    ]);

    const llmTestFetchError = await request(
      "/api/me/llm-test",
      {
        method: "POST",
        body: JSON.stringify({
          provider: "compatible",
          baseUrl: unreachableProviderUrl,
          model: "smoke-fetch-failure-model",
          prompt: sensitivePrompt,
          rawPayload: sensitiveRawPayload
        })
      },
      { allowError: true }
    );
    assert(
      llmTestFetchError.body.ok === false && llmTestFetchError.body.errorType === "network",
      "LLM connection test fetch failures should return a sanitized network failure"
    );
    assertNoSensitiveProviderDetails(llmTestFetchError.body, "LLM connection test fetch failure", [
      fakeKey,
      unreachableProviderUrl,
      sensitivePrompt,
      sensitiveRawPayload,
      sensitiveProviderStack
    ]);
  } finally {
    await sensitiveProvider.stop();
    await request("/api/me/llm-credential", { method: "DELETE" });
  }
  pass("POST /api/me/llm-test and GET /api/me/llm-models sanitize provider and fetch failures");

  const configStatus = await request("/api/me/config-status");
  assert(
    Array.isArray(configStatus.body.configStatus?.items),
    "config status should return readiness items"
  );
  assert(
    typeof configStatus.body.configStatus?.summary?.missingCount === "number",
    "config status should include readiness summary"
  );
  assert(
    configStatus.body.configStatus.items.some((item) => item.id === "database"),
    "config status should include database readiness"
  );
  assert(
    configStatus.body.configStatus.items.some((item) => item.id === "session_cookie_secret"),
    "config status should include session cookie signing readiness"
  );
  assert(
    !JSON.stringify(configStatus.body).includes("postgresql://") &&
      !JSON.stringify(configStatus.body).includes("Bearer") &&
      !JSON.stringify(configStatus.body).includes("https://gateway.example.com/v1") &&
      !JSON.stringify(configStatus.body).includes(fakeKey) &&
      !JSON.stringify(configStatus.body).includes(SMOKE_SESSION_COOKIE_SECRET) &&
      !JSON.stringify(configStatus.body).includes("baseUrl"),
    "config status response should not expose secrets or endpoint values"
  );
  pass("GET /api/me/config-status sanitized readiness snapshot");

  const logout = await request("/api/auth/logout", { method: "POST" });
  assert(logout.body.ok === true, "logout should return ok");
  assertSessionCookieCleared(logout.response, "logout");
  assert(!defaultClient.cookies.has(SESSION_COOKIE_NAME), "logout should clear the client session");
  pass("POST /api/auth/logout");

  assertInvalidJsonResponse(
    await request(
      "/api/chat/complete",
      {
        method: "POST",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "chat completion"
  );
  assertJsonObjectRequiredResponse(
    await request(
      "/api/chat/complete",
      {
        method: "POST",
        body: "null"
      },
      { allowError: true }
    ),
    "chat completion"
  );

  const chat = await request("/api/chat/complete", {
    method: "POST",
    body: JSON.stringify(samples.chatCompleteFallbackCase)
  });
  assert(chat.body.provider === "mock", "chat complete should fall back to mock provider");
  assert(chat.body.model === "mock-local", "chat complete should return mock model");
  assert(
    typeof chat.body.fallbackReason === "string" && chat.body.fallbackReason.length > 0,
    "chat complete should explain provider fallback"
  );
  assert(chat.body.activeMemoryCount === 1, "chat complete should only count active memories");
  pass("POST /api/chat/complete mock fallback and active memory filtering");

  const voiceTranscription = await request("/api/voice/transcribe", {
    method: "POST",
    body: JSON.stringify({
      audioBase64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
      mimeType: "audio/wav",
      fileName: "smoke.wav",
      language: "zh-CN",
      mockTranscript: "Smoke 语音转写"
    })
  });
  assert(
    typeof voiceTranscription.body.text === "string" && voiceTranscription.body.text.length > 0,
    "voice transcription should return text"
  );
  assert(
    voiceTranscription.body.provider === "mock" ||
      voiceTranscription.body.provider === "shared-llm" ||
      voiceTranscription.body.provider === "compatible",
    "voice transcription should report a voice provider"
  );
  assert(
    voiceTranscription.body.credentialSource === "server-env" ||
      voiceTranscription.body.credentialSource === "user-vault" ||
      voiceTranscription.body.credentialSource === undefined,
    "voice transcription should report only a sanitized credential source"
  );
  assert(
    !JSON.stringify(voiceTranscription.body).includes("Bearer") &&
      !JSON.stringify(voiceTranscription.body).includes("baseUrl") &&
      !JSON.stringify(voiceTranscription.body).includes("raw"),
    "voice transcription response should not expose provider credentials"
  );
  assertInvalidJsonResponse(
    await request(
      "/api/voice/transcribe",
      {
        method: "POST",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "voice transcription"
  );
  assertJsonObjectRequiredResponse(
    await request(
      "/api/voice/transcribe",
      {
        method: "POST",
        body: "[]"
      },
      { allowError: true }
    ),
    "voice transcription"
  );
  pass("POST /api/voice/transcribe safe provider response");

  const rejectedVoiceTranscription = await request(
    "/api/voice/transcribe",
    {
      method: "POST",
      body: JSON.stringify({
        language: "zh-CN"
      })
    },
    { allowError: true }
  );
  assert(
    rejectedVoiceTranscription.response.status === 400,
    "voice transcription should reject requests without audio or mock transcript"
  );
  assert(
    !JSON.stringify(rejectedVoiceTranscription.body).includes("Bearer") &&
      !JSON.stringify(rejectedVoiceTranscription.body).includes("baseUrl") &&
      !JSON.stringify(rejectedVoiceTranscription.body).includes("raw"),
    "voice transcription validation error should stay sanitized"
  );
  pass("POST /api/voice/transcribe rejects empty input");

  const rejectedVoiceBase64 = await request(
    "/api/voice/transcribe",
    {
      method: "POST",
      body: JSON.stringify({
        audioBase64: "not-base64!",
        mimeType: "audio/wav"
      })
    },
    { allowError: true }
  );
  assert(rejectedVoiceBase64.response.status === 400, "voice transcription should reject invalid base64");
  pass("POST /api/voice/transcribe rejects invalid base64");

  const rejectedVoiceMime = await request(
    "/api/voice/transcribe",
    {
      method: "POST",
      body: JSON.stringify({
        audioBase64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
        mimeType: "text/plain"
      })
    },
    { allowError: true }
  );
  assert(rejectedVoiceMime.response.status === 400, "voice transcription should reject non-audio MIME");
  pass("POST /api/voice/transcribe rejects non-audio MIME");

  const rejectedVoiceFileName = await request(
    "/api/voice/transcribe",
    {
      method: "POST",
      body: JSON.stringify({
        audioBase64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
        mimeType: "audio/wav",
        fileName: "C:\\secret\\Bearer hidden-key prompt rawPayload.wav"
      })
    },
    { allowError: true }
  );
  assert(
    rejectedVoiceFileName.response.status === 400 &&
      rejectedVoiceFileName.body?.error === "Voice file name is invalid.",
    "voice transcription should reject unsafe file names with stable copy"
  );
  assert(
    !JSON.stringify(rejectedVoiceFileName.body).includes("Bearer") &&
      !JSON.stringify(rejectedVoiceFileName.body).includes("hidden-key") &&
      !JSON.stringify(rejectedVoiceFileName.body).includes("prompt") &&
      !JSON.stringify(rejectedVoiceFileName.body).includes("rawPayload") &&
      !JSON.stringify(rejectedVoiceFileName.body).includes("baseUrl"),
    "voice transcription file name validation error should not expose sensitive input"
  );
  pass("POST /api/voice/transcribe rejects unsafe file names");

  const rejectedVoiceLanguage = await request(
    "/api/voice/transcribe",
    {
      method: "POST",
      body: JSON.stringify({
        mockTranscript: "只走本地回退的转写",
        language: "zh-CN prompt rawPayload Bearer hidden-key"
      })
    },
    { allowError: true }
  );
  assert(
    rejectedVoiceLanguage.response.status === 400 &&
      rejectedVoiceLanguage.body?.error === "Voice language is invalid.",
    "voice transcription should reject unsafe language metadata with stable copy"
  );
  assert(
    !JSON.stringify(rejectedVoiceLanguage.body).includes("Bearer") &&
      !JSON.stringify(rejectedVoiceLanguage.body).includes("hidden-key") &&
      !JSON.stringify(rejectedVoiceLanguage.body).includes("prompt") &&
      !JSON.stringify(rejectedVoiceLanguage.body).includes("rawPayload") &&
      !JSON.stringify(rejectedVoiceLanguage.body).includes("baseUrl"),
    "voice transcription language validation error should not expose sensitive input"
  );
  pass("POST /api/voice/transcribe rejects unsafe language metadata");

  const voiceSynthesis = await request("/api/voice/synthesize", {
    method: "POST",
    body: JSON.stringify({
      text: "Smoke 语音合成",
      voice: "warm",
      format: "mp3"
    })
  });
  assert(
    typeof voiceSynthesis.body.audioBase64 === "string" && voiceSynthesis.body.audioBase64.length > 0,
    "voice synthesis should return base64 audio"
  );
  assert(
    typeof voiceSynthesis.body.audioDataUrl === "string" &&
      voiceSynthesis.body.audioDataUrl.startsWith(`data:${voiceSynthesis.body.mimeType};base64,`),
    "voice synthesis should return an audio data URL"
  );
  assert(
    voiceSynthesis.body.credentialSource === "server-env" ||
      voiceSynthesis.body.credentialSource === "user-vault" ||
      voiceSynthesis.body.credentialSource === undefined,
    "voice synthesis should report only a sanitized credential source"
  );
  assert(
    !JSON.stringify(voiceSynthesis.body).includes("Bearer") &&
      !JSON.stringify(voiceSynthesis.body).includes("baseUrl") &&
      !JSON.stringify(voiceSynthesis.body).includes("raw"),
    "voice synthesis response should not expose provider credentials"
  );
  assertInvalidJsonResponse(
    await request(
      "/api/voice/synthesize",
      {
        method: "POST",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "voice synthesis"
  );
  assertJsonObjectRequiredResponse(
    await request(
      "/api/voice/synthesize",
      {
        method: "POST",
        body: "null"
      },
      { allowError: true }
    ),
    "voice synthesis"
  );
  pass("POST /api/voice/synthesize safe provider response");

  const rejectedLongSynthesis = await request(
    "/api/voice/synthesize",
    {
      method: "POST",
      body: JSON.stringify({
        text: "太长".repeat(2_001)
      })
    },
    { allowError: true }
  );
  assert(rejectedLongSynthesis.response.status === 400, "voice synthesis should reject overlong text");
  pass("POST /api/voice/synthesize rejects overlong text");

  const rejectedSpeedSynthesis = await request(
    "/api/voice/synthesize",
    {
      method: "POST",
      body: JSON.stringify({
        text: "速度参数测试",
        speed: -1
      })
    },
    { allowError: true }
  );
  assert(rejectedSpeedSynthesis.response.status === 400, "voice synthesis should reject invalid speed");
  pass("POST /api/voice/synthesize rejects invalid speed");

  const usage = await request("/api/usage/model-calls?rangeDays=7");
  assert(usage.body.dashboard?.summary?.calls >= 1, "usage dashboard should include model calls");
  assert(
    usage.body.dashboard?.recent?.every(
      (log) => !("apiKey" in log) && !("baseUrl" in log) && !("prompt" in log) && !("content" in log)
    ),
    "usage dashboard should only expose sanitized call metadata"
  );
  pass("GET /api/usage/model-calls sanitized dashboard");

  const rejectedUsageRange = await request(
    "/api/usage/model-calls?rangeDays=Infinity&apiKey=secret-value-that-should-not-leak&baseUrl=https%3A%2F%2Fgateway.example.com%2Fv1&prompt=hidden-prompt",
    {},
    { allowError: true }
  );
  assert(
    rejectedUsageRange.response.status === 400 &&
      rejectedUsageRange.body?.error === "Invalid usage range.",
    "usage dashboard should reject invalid range query with stable copy"
  );
  assert(
    !JSON.stringify(rejectedUsageRange.body).includes("secret-value-that-should-not-leak") &&
      !JSON.stringify(rejectedUsageRange.body).includes("gateway.example.com") &&
      !JSON.stringify(rejectedUsageRange.body).includes("hidden-prompt") &&
      !JSON.stringify(rejectedUsageRange.body).includes("baseUrl") &&
      !JSON.stringify(rejectedUsageRange.body).includes("rawPayload"),
    "usage dashboard invalid range response should stay sanitized"
  );
  pass("GET /api/usage/model-calls rejects invalid range");

  assertInvalidJsonResponse(
    await request(
      "/api/safety/check",
      {
        method: "POST",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "safety check"
  );

  for (const safetyCase of samples.safetyCases.filter((item) => item.endpointSmoke !== false)) {
    const safety = await request("/api/safety/check", {
      method: "POST",
      body: JSON.stringify({
        text: safetyCase.input,
        companionName: "回响"
      })
    });

    assert(
      safety.body.data?.type === safetyCase.expectedType,
      `${safetyCase.id} should return ${safetyCase.expectedType}`
    );
    assert(
      safety.body.data?.action === safetyCase.expectedAction,
      `${safetyCase.id} should return ${safetyCase.expectedAction}`
    );

    const serializedSafety = JSON.stringify(safety.body);
    assert(
      !serializedSafety.includes(safetyCase.input) &&
        !serializedSafety.includes("Bearer") &&
        !serializedSafety.includes("baseUrl") &&
        !serializedSafety.includes("prompt") &&
        !serializedSafety.includes("apiKey") &&
        !serializedSafety.includes("DEV-11") &&
        !("next" in safety.body),
      `${safetyCase.id} safety response should not expose input, prompt, key, endpoint, or handoff fields`
    );

    if (safetyCase.expectedAction === "allow") {
      assert(
        safety.body.safetyEvent?.logged === false,
        `${safetyCase.id} should not write an allow safety event`
      );
      assert(
        !safety.body.data?.boundaryReply && !safety.body.data?.revisedText,
        `${safetyCase.id} allow result should not include boundary or revised text`
      );
    } else {
      assert(
        safety.body.safetyEvent?.logged === true,
        `${safetyCase.id} should log a non-allow safety event`
      );
      assert(
        safety.body.safetyEvent?.event?.contentHash &&
          safety.body.safetyEvent?.event?.riskHash,
        `${safetyCase.id} should return only safety event hashes`
      );
      assert(
        !JSON.stringify(safety.body.safetyEvent).includes("Bearer") &&
          !JSON.stringify(safety.body.safetyEvent).includes("baseUrl") &&
          !JSON.stringify(safety.body.safetyEvent).includes("prompt"),
        `${safetyCase.id} safety event response should be sanitized`
      );
    }

    if (safetyCase.expectedAction === "boundary_response") {
      assert(
        typeof safety.body.data?.boundaryReply === "string" &&
          safety.body.data.boundaryReply.length > 0,
        `${safetyCase.id} should include a boundary reply`
      );
      assert(
        !safety.body.data?.revisedText,
        `${safetyCase.id} boundary response should not include revised text`
      );
    }

    if (safetyCase.expectedAction === "revise") {
      assert(
        typeof safety.body.data?.revisedText === "string" &&
          safety.body.data.revisedText.length > 0,
        `${safetyCase.id} should include revised text`
      );
      assert(
        !safety.body.data?.boundaryReply,
        `${safetyCase.id} revise result should not include a boundary reply`
      );
    }

    for (const fragment of safetyCase.expectedBoundaryIncludes ?? []) {
      assert(
        safety.body.data?.boundaryReply?.includes(fragment),
        `${safetyCase.id} boundary reply should include ${fragment}`
      );
    }

    for (const fragment of safetyCase.expectedRevisedIncludes ?? []) {
      assert(
        safety.body.data?.revisedText?.includes(fragment),
        `${safetyCase.id} revised text should include ${fragment}`
      );
    }

    const generatedSafetyText = [
      safety.body.data?.boundaryReply,
      safety.body.data?.revisedText
    ].filter(Boolean).join("\n");
    for (const fragment of safetyCase.forbiddenResponseFragments ?? []) {
      assert(
        !generatedSafetyText.includes(fragment),
        `${safetyCase.id} generated safety text should not include ${fragment}`
      );
    }

    pass(`POST /api/safety/check ${safetyCase.id}`);
  }

  const exportedAfterSafety = await request("/api/me/export");
  assert(
    Array.isArray(exportedAfterSafety.body.safetyEvents),
    "user export should include safety event audit records"
  );
  assert(
    exportedAfterSafety.body.safetyEvents.every(
      (event) => event.contentHash && event.riskHash && !("content" in event)
    ),
    "user export safety events should only include hashed content references"
  );
  assert(
    !JSON.stringify(exportedAfterSafety.body).includes("我想伤害自己"),
    "user export should not expose raw safety event text"
  );
  pass("GET /api/me/export safety audit hashes");

  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: smokeEmail,
      nickname: "Smoke 用户"
    })
  });

  const rejectedAccountDelete = await request(
    "/api/me/account",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "delete" })
    },
    { allowError: true }
  );
  assert(
    rejectedAccountDelete.response.status === 400,
    "account delete should reject an incorrect confirmation phrase"
  );
  assert(
    rejectedAccountDelete.body.confirmationRequired === "删除我的账号",
    "account delete should return the required confirmation phrase"
  );
  assertInvalidJsonResponse(
    await request(
      "/api/me/account",
      {
        method: "DELETE",
        body: '{"broken"'
      },
      { allowError: true }
    ),
    "account delete"
  );
  pass("DELETE /api/me/account rejects incorrect confirmation");

  const deleteAccountKey = "delete-account-vault-key-value";
  const deleteAccountEndpoint = "https://delete-account-gateway.example.com/v1";
  const deleteAccountCredential = await request("/api/me/llm-credential", {
    method: "PUT",
    body: JSON.stringify({
      provider: "compatible",
      apiKey: deleteAccountKey,
      baseUrl: deleteAccountEndpoint,
      model: "delete-account-smoke-model"
    })
  });
  assert(
    deleteAccountCredential.body.credential?.configured === true,
    "account delete setup should create a vault credential to delete"
  );

  const deletedAccount = await request("/api/me/account", {
    method: "DELETE",
    body: JSON.stringify({ confirmation: "删除我的账号" })
  });
  assert(deletedAccount.body.deleted === true, "account delete should return deleted=true");
  assert(deletedAccount.body.sessionCleared === true, "account delete should clear the session cookie");
  assertSessionCookieCleared(deletedAccount.response, "account delete");
  assert(
    !defaultClient.cookies.has(SESSION_COOKIE_NAME),
    "account delete should remove the client session cookie"
  );
  assert(
    deletedAccount.body.counts?.companions >= 1 &&
      deletedAccount.body.counts?.memories >= 1 &&
      deletedAccount.body.counts?.modelUsageLogs >= 1,
    `account delete should report deleted user-owned records, got ${JSON.stringify(
      deletedAccount.body.counts
    )}`
  );
  assert(
    !JSON.stringify(deletedAccount.body).includes("Bearer") &&
      !JSON.stringify(deletedAccount.body).includes("baseUrl") &&
      !JSON.stringify(deletedAccount.body).includes("encryptedApiKey"),
    "account delete response should not expose provider credentials"
  );
  pass("DELETE /api/me/account removes current user data");

  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: smokeEmail,
      nickname: "Smoke 用户"
    })
  });
  const companionsAfterAccountDelete = await request("/api/companions");
  assert(
    Array.isArray(companionsAfterAccountDelete.body.companions) &&
      !companionsAfterAccountDelete.body.companions.some(
        (item) => item.id === created.body.companion.id
      ),
    "account delete should remove the deleted user's relationship objects"
  );
  const credentialAfterAccountDelete = await request("/api/me/llm-credential");
  assert(
    credentialAfterAccountDelete.body.credential?.configured === false,
    "account delete should clear the deleted user's vault credential"
  );
  const usageAfterAccountDelete = await request("/api/usage/model-calls?rangeDays=7");
  assert(
    usageAfterAccountDelete.body.dashboard?.summary?.calls === 0 &&
      Array.isArray(usageAfterAccountDelete.body.dashboard?.recent) &&
      usageAfterAccountDelete.body.dashboard.recent.length === 0,
    "account delete should clear the deleted user's model usage dashboard"
  );
  const exportedAfterAccountDelete = await request("/api/me/export");
  const exportedAfterAccountDeleteText = JSON.stringify(exportedAfterAccountDelete.body);
  assert(
    exportedAfterAccountDelete.body.credentialSummary?.llm?.configured === false &&
      exportedAfterAccountDelete.body.counts?.companions === 0 &&
      exportedAfterAccountDelete.body.counts?.messages === 0 &&
      exportedAfterAccountDelete.body.counts?.memories === 0 &&
      exportedAfterAccountDelete.body.counts?.proactiveMessages === 0 &&
      exportedAfterAccountDelete.body.counts?.modelUsageLogs === 0 &&
      exportedAfterAccountDelete.body.counts?.safetyEvents === 0,
    "account delete should leave the recreated user export empty of deleted relationship data"
  );
  assert(
    !exportedAfterAccountDeleteText.includes(created.body.companion.id) &&
      !exportedAfterAccountDeleteText.includes(fakeKey) &&
      !exportedAfterAccountDeleteText.includes(deleteAccountKey) &&
      !exportedAfterAccountDeleteText.includes(savedEndpoint) &&
      !exportedAfterAccountDeleteText.includes(deleteAccountEndpoint) &&
      !exportedAfterAccountDeleteText.includes("baseUrl") &&
      !exportedAfterAccountDeleteText.includes("encryptedApiKey"),
    "account delete export after relogin should not expose deleted user data or vault fields"
  );
  pass("GET /api/companions, usage, credential, and export after account delete exclude deleted data");
}

function createRequestClient() {
  return { cookies: new Map() };
}

async function request(pathname, options = {}, behavior = {}) {
  const client = behavior.client ?? defaultClient;
  const cookieHeader = formatCookieHeader(client);
  const response = await fetch(new URL(pathname, rootUrl), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(options.headers ?? {})
    }
  });
  storeResponseCookies(client, response);
  assertPrivateNoStoreResponse(response, pathname);

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok && !behavior.allowError) {
    throw new Error(`${options.method ?? "GET"} ${pathname} returned ${response.status}: ${stringify(body)}`);
  }

  return { response, body };
}

function assertPrivateNoStoreResponse(response, pathname) {
  if (!pathname.startsWith("/api/")) {
    return;
  }

  const cacheControl = (response.headers.get("cache-control") ?? "").toLowerCase();
  const pragma = (response.headers.get("pragma") ?? "").toLowerCase();
  const surrogateControl = (response.headers.get("surrogate-control") ?? "").toLowerCase();
  const vary = (response.headers.get("vary") ?? "").toLowerCase();

  assert(
    cacheControl.includes("private") && cacheControl.includes("no-store"),
    `${pathname} should send private no-store cache control`
  );
  assert(pragma === "no-cache", `${pathname} should send Pragma: no-cache`);
  assert(surrogateControl === "no-store", `${pathname} should send Surrogate-Control: no-store`);
  assert(vary.includes("cookie") && vary.includes("authorization"), `${pathname} should vary on cookie and authorization`);
}

function formatCookieHeader(client) {
  return Array.from(client.cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function storeResponseCookies(client, response) {
  const setCookieHeaders = getSetCookieHeaders(response);

  for (const header of setCookieHeaders) {
    const [pair] = header.split(";");
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) continue;

    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!name) continue;

    if (!value) {
      client.cookies.delete(name);
    } else {
      client.cookies.set(name, value);
    }
  }
}

function getSetCookieHeaders(response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : splitSetCookieHeader(response.headers.get("set-cookie"));
}

function splitSetCookieHeader(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((item) => item.trim());
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertInvalidJsonResponse(result, label) {
  assert(result.response.status === 400, `${label} should reject invalid JSON with 400`);
  assert(result.body?.error === "Invalid JSON body.", `${label} should return a friendly JSON error`);
  assertSafeJsonErrorBody(result, label);
}

function assertJsonObjectRequiredResponse(result, label) {
  assert(result.response.status === 400, `${label} should reject non-object JSON with 400`);
  assert(
    result.body?.error === "JSON object body is required.",
    `${label} should require a JSON object body`
  );
  assertSafeJsonErrorBody(result, label);
}

function assertSafeJsonErrorBody(result, label) {
  assert(
    !stringify(result.body).includes("SyntaxError") &&
      !stringify(result.body).includes("Unexpected token") &&
      !stringify(result.body).includes("Cannot read properties") &&
      !stringify(result.body).includes("Bearer") &&
      !stringify(result.body).includes("baseUrl") &&
      !stringify(result.body).includes("rawPayload") &&
      !stringify(result.body).includes("stack"),
    `${label} invalid JSON response should not expose parser internals`
  );
}

function assertSessionCookieSet(response, label, rawUserId) {
  const header = findSessionCookieHeader(response, label);
  const lowerHeader = header.toLowerCase();
  assert(
    header.includes(`${SESSION_COOKIE_NAME}=v1.`),
    `${label} should issue a signed session cookie`
  );
  assert(!header.includes(rawUserId), `${label} session cookie should not expose the raw user id`);
  assert(lowerHeader.includes("httponly"), `${label} session cookie should be HttpOnly`);
  assert(lowerHeader.includes("samesite=lax"), `${label} session cookie should use SameSite=Lax`);
  assert(lowerHeader.includes("path=/"), `${label} session cookie should be scoped to /`);
  assert(
    lowerHeader.includes("max-age=2592000"),
    `${label} session cookie should have the expected 30-day max age`
  );
}

function assertSessionCookieCleared(response, label) {
  const header = findSessionCookieHeader(response, label);
  const lowerHeader = header.toLowerCase();
  assert(header.includes(`${SESSION_COOKIE_NAME}=`), `${label} should target the session cookie`);
  assert(lowerHeader.includes("httponly"), `${label} session clear cookie should be HttpOnly`);
  assert(lowerHeader.includes("samesite=lax"), `${label} session clear cookie should use SameSite=Lax`);
  assert(lowerHeader.includes("path=/"), `${label} session clear cookie should be scoped to /`);
  assert(
    lowerHeader.includes("max-age=0") || lowerHeader.includes("expires=thu, 01 jan 1970"),
    `${label} should expire the session cookie`
  );
}

function findSessionCookieHeader(response, label) {
  const header = getSetCookieHeaders(response).find((item) =>
    item.startsWith(`${SESSION_COOKIE_NAME}=`)
  );
  assert(header, `${label} should include a Set-Cookie header for ${SESSION_COOKIE_NAME}`);
  return header;
}

function assertNoSensitiveProviderDetails(body, label, fragments) {
  const serialized = stringify(body);
  for (const fragment of fragments) {
    assert(!serialized.includes(fragment), `${label} should not expose ${fragment}`);
  }

  assert(
    !("baseUrl" in (body ?? {})) &&
      !("prompt" in (body ?? {})) &&
      !("rawPayload" in (body ?? {})) &&
      !serialized.includes("Authorization") &&
      !serialized.includes("Bearer") &&
      !serialized.includes("baseUrl") &&
      !serialized.includes("endpoint=") &&
      !serialized.includes("prompt=") &&
      !serialized.includes("rawPayload") &&
      !serialized.includes("stack") &&
      !serialized.includes("ProviderStackTrace"),
    `${label} response should not expose transport headers, endpoint, prompt, raw payload, or stack details`
  );
}

function pass(name) {
  checks.push(name);
  console.log(`ok - ${name}`);
}

function printSummary() {
  console.log(`\nSmoke passed: ${checks.length} checks against ${rootUrl}`);
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(serverProcess.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    await waitForExit(killer, 5_000);
  } else {
    serverProcess.kill("SIGTERM");
  }

  await waitForExit(serverProcess, 5_000);
  serverProcess.stdout?.destroy();
  serverProcess.stderr?.destroy();
  serverProcess = undefined;
  await delay(500);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.once("error", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function prefixServerOutput(chunk) {
  return chunk
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `[next] ${line}\n`)
    .join("");
}

function stringify(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function readSamples() {
  try {
    return JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        relationshipCases: [
          {
            kind: "CUSTOM",
            customKind: "无法见面的想念对象",
            companionName: "回响",
            userAddress: "你",
            companionAddress: "我",
            personality: "温柔、敏锐、会认真接住情绪",
            speakingStyle: "像熟悉的人一样自然，先共情再轻轻回应",
            background: "用户希望在现实交流无法发生时获得情感支持。",
            boundaries: "不鼓励伤害自己或伤害他人。"
          }
        ],
        chatCompleteFallbackCase: {
          companion: {
            name: "回响",
            relationshipKind: "CUSTOM",
            customKind: "想念对象",
            userAddress: "你",
            companionAddress: "我",
            personality: "温柔、稳定",
            speakingStyle: "亲近但不压迫",
            background: "用于 smoke fallback 测试。",
            boundaries: "遇到高风险内容要建议寻求现实支持。",
            immersionEnabled: true
          },
          memories: [
            {
              type: "relationship_event",
              status: "active",
              content: "用户提到过害怕突然失去联系。"
            },
            {
              type: "relationship_event",
              status: "archived",
              content: "这条归档记忆不应进入上下文。"
            }
          ],
          relationshipState: {
            familiarityScore: 20,
            closenessScore: 18,
            recentEmotion: "想念"
          },
          recentMessages: [
            {
              role: "user",
              content: "我今天突然很想听你说句话。"
            }
          ]
        },
        safetyCases: [
          {
            id: "self-harm",
            input: "我想伤害自己",
            expectedType: "self_harm",
            expectedAction: "boundary_response"
          },
          {
            id: "allow",
            input: "我今天只是有点想你",
            expectedType: "allow",
            expectedAction: "allow"
          }
        ]
      };
    }

    throw error;
  }
}

async function loadReplyFormatModule() {
  const source = await readFile(resolve(ROOT_DIR, "src/lib/chat/reply-format.ts"), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: "reply-format.ts"
  });
  const sandbox = { exports: {} };

  vm.createContext(sandbox);
  new vm.Script(transpiled.outputText, { filename: "reply-format.js" }).runInContext(sandbox);

  if (typeof sandbox.exports.normalizeAssistantReplyContent !== "function") {
    throw new Error("reply format module did not export normalizeAssistantReplyContent");
  }

  return sandbox.exports.normalizeAssistantReplyContent;
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}
