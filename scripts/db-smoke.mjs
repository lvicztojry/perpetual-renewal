import { spawnSync } from "node:child_process";
import process from "node:process";
import { loadLocalEnv } from "./load-local-env.mjs";

const TEST_PREFIX = "db-smoke";
const userId = `${TEST_PREFIX}-user`;
const companionId = `${TEST_PREFIX}-companion`;
const conversationId = `${TEST_PREFIX}-conversation`;

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  console.log("DB smoke skipped: DATABASE_URL is not set.");
  process.exit(0);
}

runPrismaCommand("generate", ["prisma", "generate"]);
runPrismaCommand("validate", ["node", "scripts/prisma-validate.mjs"]);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

try {
  await cleanup();

  const user = await prisma.user.create({
    data: {
      id: userId,
      email: "db-smoke@perpetual-renewal.local",
      nickname: "DB Smoke",
      timezone: "Asia/Shanghai",
      language: "zh-CN"
    }
  });
  assert(user.id === userId, "user should be created");

  const providerCredential = await prisma.providerCredential.create({
    data: {
      userId,
      kind: "llm",
      provider: "compatible",
      baseUrl: "https://db-smoke-gateway.example.invalid/v1",
      model: "db-smoke-model",
      encryptedApiKey: "placeholder",
      keyIv: "iv",
      keyAuthTag: "tag",
      keyFingerprint: "fingerprint",
      keyPreview: "...test",
      encryptionVersion: "aes-256-gcm:v1",
      status: "active"
    }
  });
  assert(providerCredential.kind === "llm", "provider credential should be created");
  assert(providerCredential.baseUrl?.endsWith("/v1"), "provider credential baseUrl should be stored");
  assert(providerCredential.encryptionVersion === "aes-256-gcm:v1", "provider credential version should be stored");

  const loadedCredential = await prisma.providerCredential.findUnique({
    where: { userId_kind: { userId, kind: "llm" } }
  });
  assert(loadedCredential?.keyFingerprint === "fingerprint", "provider credential should be readable by user/kind");

  let duplicateCredentialRejected = false;
  try {
    await prisma.providerCredential.create({
      data: {
        userId,
        kind: "llm",
        provider: "compatible",
        model: "duplicate-db-smoke-model",
        encryptedApiKey: "placeholder-duplicate",
        keyIv: "iv-duplicate",
        keyAuthTag: "tag-duplicate",
        keyFingerprint: "fingerprint-duplicate",
        keyPreview: "...dupe",
        encryptionVersion: "aes-256-gcm:v1",
        status: "active"
      }
    });
  } catch (error) {
    duplicateCredentialRejected = isUniqueConstraintError(error);
  }
  assert(duplicateCredentialRejected, "provider credential should enforce one llm credential per user");

  const companion = await prisma.companion.create({
    data: {
      id: companionId,
      userId,
      name: "数据库回响",
      relationshipKind: "CUSTOM",
      customKind: "数据库上线验证",
      userAddress: "你",
      companionAddress: "回响",
      personality: ["稳定", "温柔", "可追溯"],
      speakingStyle: "温柔、稳定、不过度承诺",
      background: "用于验证真实 PostgreSQL 读写和关联清理。",
      boundaries: "不责备、不施压、不记录真实密钥。",
      immersionEnabled: true,
      proactiveMessagesEnabled: true,
      proactiveFrequencyPreset: "custom",
      proactiveFrequencyMinutes: 180
    }
  });
  assert(companion.id === companionId, "companion should be created");

  const conversation = await prisma.conversation.create({
    data: {
      id: conversationId,
      userId,
      companionId,
      title: "DB readiness smoke",
      lastMessageAt: new Date()
    }
  });
  assert(conversation.id === conversationId, "conversation should be created");

  const userMessage = await prisma.message.create({
    data: {
      conversationId,
      role: "USER",
      content: "DB smoke message",
      metadata: { source: "db-smoke", redacted: true }
    }
  });
  assert(Boolean(userMessage.id), "user message should be created");

  const assistantMessage = await prisma.message.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content: "DB smoke assistant reply",
      metadata: { provider: "db-smoke", model: "db-smoke-model" }
    }
  });
  assert(Boolean(assistantMessage.id), "assistant message should be created");

  const memory = await prisma.memory.create({
    data: {
      userId,
      companionId,
      sourceMessageId: userMessage.id,
      type: "USER_FACT",
      status: "ACTIVE",
      content: "DB smoke verified an active memory linked to a message.",
      confidence: 0.95
    }
  });
  assert(memory.status === "ACTIVE", "active memory should be created");

  const relationshipState = await prisma.relationshipState.create({
    data: {
      userId,
      companionId,
      familiarityScore: 3,
      closenessScore: 2,
      recentEmotion: "确认",
      importantEvents: ["db-smoke"],
      lastInteractionAt: new Date(),
      explanation: "DB readiness smoke created this relationship state."
    }
  });
  assert(relationshipState.companionId === companionId, "relationship state should be created");

  const proactiveDraft = await prisma.proactiveMessage.create({
    data: {
      userId,
      companionId,
      kind: "PLAYFUL_MISS_YOU",
      content: "你不用急着回，我只是来确认数据库这边也有回响。",
      reason: "DB readiness smoke",
      safety: { action: "allow", source: "db-smoke" },
      status: "DRAFT",
      scheduledAt: new Date()
    }
  });
  assert(proactiveDraft.status === "DRAFT", "proactive draft should be created");

  const safetyEvent = await prisma.safetyEvent.create({
    data: {
      userId,
      companionId,
      messageId: userMessage.id,
      type: "SAFETY_OVERRIDE",
      action: "block",
      stage: "input",
      severity: "high",
      contentHash: "db-smoke-content-hash",
      riskHash: "db-smoke-risk-hash"
    }
  });
  assert(safetyEvent.type === "SAFETY_OVERRIDE", "safety event should be created");

  const usageLog = await prisma.modelUsageLog.create({
    data: {
      userId,
      companionId,
      conversationId,
      messageId: assistantMessage.id,
      purpose: "db-smoke",
      provider: "compatible",
      model: "db-smoke-model",
      status: "success",
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      estimatedCostUsd: "0.000001",
      latencyMs: 123
    }
  });
  assert(usageLog.status === "success", "model usage log should be created");

  const loaded = await prisma.companion.findUnique({
    where: { id: companionId },
    include: {
      conversations: { include: { messages: true, modelUsageLogs: true } },
      memories: true,
      relationshipState: true,
      proactiveMessages: true,
      safetyEvents: true,
      modelUsageLogs: true
    }
  });

  assert(loaded?.conversations.length === 1, "conversation should be readable through companion");
  assert(loaded?.conversations[0]?.messages.length === 2, "messages should be readable through conversation");
  assert(loaded?.memories[0]?.sourceMessageId === userMessage.id, "memory should be linked to source message");
  assert(loaded?.relationshipState?.recentEmotion === "确认", "relationship state should be readable");
  assert(loaded?.proactiveMessages[0]?.status === "DRAFT", "proactive draft should be readable");
  assert(loaded?.safetyEvents[0]?.contentHash === "db-smoke-content-hash", "safety event hash should be readable");
  assert(loaded?.modelUsageLogs[0]?.purpose === "db-smoke", "model usage log should be readable through companion");
  assert(
    loaded?.conversations[0]?.modelUsageLogs[0]?.messageId === assistantMessage.id,
    "model usage log should be readable through conversation"
  );
  const credentialCount = await prisma.providerCredential.count({ where: { userId } });
  assert(credentialCount === 1, "provider credential should be readable through user");

  await cleanup();
  await assertCleanup();

  console.log("DB smoke passed against configured PostgreSQL database.");
} catch (error) {
  console.error("DB smoke failed:");
  console.error(sanitize(error instanceof Error ? error.stack || error.message : String(error)));
  process.exitCode = 1;
} finally {
  if (process.exitCode) {
    await cleanup().catch(() => undefined);
  }
  await prisma.$disconnect();
}

async function cleanup() {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}

async function assertCleanup() {
  const [
    users,
    companions,
    conversations,
    messages,
    memories,
    relationshipStates,
    proactiveMessages,
    safetyEvents,
    modelUsageLogs,
    providerCredentials
  ] = await Promise.all([
    prisma.user.count({ where: { id: userId } }),
    prisma.companion.count({ where: { id: companionId } }),
    prisma.conversation.count({ where: { id: conversationId } }),
    prisma.message.count({ where: { conversationId } }),
    prisma.memory.count({ where: { userId } }),
    prisma.relationshipState.count({ where: { userId } }),
    prisma.proactiveMessage.count({ where: { userId } }),
    prisma.safetyEvent.count({ where: { userId } }),
    prisma.modelUsageLog.count({ where: { userId } }),
    prisma.providerCredential.count({ where: { userId } })
  ]);

  assert(users === 0, "test user should be cleaned up");
  assert(companions === 0, "test companion should be cleaned up");
  assert(conversations === 0, "test conversation should be cleaned up");
  assert(messages === 0, "test messages should be cleaned up");
  assert(memories === 0, "test memories should be cleaned up");
  assert(relationshipStates === 0, "test relationship state should be cleaned up");
  assert(proactiveMessages === 0, "test proactive drafts should be cleaned up");
  assert(safetyEvents === 0, "test safety events should be cleaned up");
  assert(modelUsageLogs === 0, "test model usage logs should be cleaned up");
  assert(providerCredentials === 0, "test provider credentials should be cleaned up");
}

function runPrismaCommand(label, command) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (result.stdout) {
    process.stdout.write(sanitize(result.stdout));
  }
  if (result.stderr) {
    process.stderr.write(sanitize(result.stderr));
  }
  if (result.status !== 0) {
    throw new Error(`Prisma ${label} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function sanitize(value) {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/https?:\/\/[^\s"']*(?:\/v1|\/v1beta|\/chat\/completions)[^\s"']*/gi, "[REDACTED_PROVIDER_ENDPOINT]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, "[REDACTED_KEY]");
}

function isUniqueConstraintError(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error.code === "P2002" ||
        String(error.message ?? "").toLowerCase().includes("unique constraint"))
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
