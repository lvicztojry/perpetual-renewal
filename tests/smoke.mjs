import { execFileSync, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import process from "node:process";

const DEFAULT_PORT = 3210;
const START_TIMEOUT_MS = 90_000;
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_PATH = new URL("./qa-samples.json", import.meta.url);
const SMOKE_CRON_SECRET = "smoke-cron-secret-placeholder";

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
      USER_KEY_VAULT_SECRET: "",
      PROACTIVE_CRON_SECRET: "",
      LLM_API_KEY: "",
      LLM_MODEL: ""
    }
  });

  assert(output.includes("Environment readiness"), "env readiness should print a summary");
  assert(output.includes("[missing] DATABASE_URL"), "env readiness should report missing database");
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
    const server = createServer();

    server.once("error", () => resolvePort(false));
    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });
    server.listen(port, "127.0.0.1");
  });
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
  pass("POST /api/auth/login");

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
  pass("conversation message plus pending memory");

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
  pass("PATCH /api/memories/:id edit memory content");

  const accidentalExportSecret = "accidental-export-secret-value-012345";
  const providerEndpointInMemory = "https://gateway.example.com/v1";
  const accidentalBearerToken = ["accidental", "Bearer", "Token", "Value", "0123456789"].join("");
  const accidentalDatabaseUrl = ["postgres", "ql://export-user:export-password@db.example.com:5432/app"].join("");
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
          `DATABASE_URL=${accidentalDatabaseUrl}`
        ].join(" ")
      })
    }
  );
  assert(
    memoryWithAccidentalSecrets.body.memory?.content.includes(accidentalExportSecret),
    "memory fixture should preserve accidental secret before export scrub"
  );
  pass("PATCH /api/memories/:id stores accidental secret fixture for export scrub");

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
  pass("POST /api/companions/:id/relationship-state updates timeline");

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
        lastUserMessage: "我今天有点想你。",
        proactiveMessagesEnabled: true,
        frequencyHours: 0
      })
    }
  );
  assert(Array.isArray(proactive.body.data), "proactive drafts should return an array");
  assert(proactive.body.data.length > 0, "proactive drafts should include at least one draft");
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
  pass("PATCH /api/proactive-messages/:id updates draft status");

  const schedulerNow = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
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

  const fakeKey = "vault-test-user-key-value";
  const credential = await request("/api/me/llm-credential", {
    method: "PUT",
    body: JSON.stringify({
      provider: "compatible",
      apiKey: fakeKey,
      baseUrl: "https://gateway.example.com/v1",
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

  const updatedCredential = await request("/api/me/llm-credential", {
    method: "PUT",
    body: JSON.stringify({
      provider: "compatible",
      baseUrl: "https://gateway.example.com/v1",
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
      !exportedText.includes("baseUrl") &&
      !exportedText.includes("encryptedApiKey") &&
      !exportedText.includes("keyIv") &&
      !exportedText.includes("keyAuthTag"),
    "user export should not expose provider secrets, endpoint URL, accidental secret strings or vault ciphertext"
  );
  assert(
    exportedText.includes("[REDACTED_SECRET]") &&
      exportedText.includes("[REDACTED_PROVIDER_ENDPOINT]") &&
      exportedText.includes("[REDACTED_DATABASE_URL]") &&
      exportedText.includes("Bearer [REDACTED]"),
    "user export should replace accidental high-risk secret strings with placeholders"
  );
  pass("GET /api/me/export sanitized user snapshot");

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
      !JSON.stringify(voiceWithUserCredential.body).includes("https://gateway.example.com/v1") &&
      !JSON.stringify(voiceWithUserCredential.body).includes("baseUrl") &&
      !JSON.stringify(voiceWithUserCredential.body).includes("raw"),
    "voice synthesis with user credential should not expose key or endpoint"
  );
  pass("POST /api/voice/synthesize uses sanitized user vault fallback");

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
  pass("POST /api/me/llm-test sanitized missing-key result");

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
    !JSON.stringify(configStatus.body).includes("postgresql://") &&
      !JSON.stringify(configStatus.body).includes("Bearer") &&
      !JSON.stringify(configStatus.body).includes("https://gateway.example.com/v1") &&
      !JSON.stringify(configStatus.body).includes(fakeKey) &&
      !JSON.stringify(configStatus.body).includes("baseUrl"),
    "config status response should not expose secrets or endpoint values"
  );
  pass("GET /api/me/config-status sanitized readiness snapshot");

  const logout = await request("/api/auth/logout", { method: "POST" });
  assert(logout.body.ok === true, "logout should return ok");
  pass("POST /api/auth/logout");

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
        !serializedSafety.includes("apiKey"),
      `${safetyCase.id} safety response should not expose input, prompt, key or endpoint fields`
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
  pass("DELETE /api/me/account rejects incorrect confirmation");

  const deletedAccount = await request("/api/me/account", {
    method: "DELETE",
    body: JSON.stringify({ confirmation: "删除我的账号" })
  });
  assert(deletedAccount.body.deleted === true, "account delete should return deleted=true");
  assert(deletedAccount.body.sessionCleared === true, "account delete should clear the session cookie");
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
  pass("GET /api/companions after account delete excludes deleted user's relationships");
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

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok && !behavior.allowError) {
    throw new Error(`${options.method ?? "GET"} ${pathname} returned ${response.status}: ${stringify(body)}`);
  }

  return { response, body };
}

function formatCookieHeader(client) {
  return Array.from(client.cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function storeResponseCookies(client, response) {
  const setCookieHeaders =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : splitSetCookieHeader(response.headers.get("set-cookie"));

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

function splitSetCookieHeader(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((item) => item.trim());
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
