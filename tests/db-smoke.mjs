import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log("DB smoke skipped: DATABASE_URL is not set.");
  process.exit(0);
}

const prisma = new PrismaClient();
const userId = "db-smoke-user";
const companionId = "db-smoke-companion";
const conversationId = "db-smoke-conversation";

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

  const companion = await prisma.companion.create({
    data: {
      id: companionId,
      userId,
      name: "数据库回响",
      relationshipKind: "CUSTOM",
      customKind: "数据库纵切验证",
      userAddress: "你",
      companionAddress: "回响",
      personality: ["稳定", "温柔"],
      speakingStyle: "温柔、稳定、可追溯",
      background: "用于验证真实 PostgreSQL 写入读取。",
      boundaries: "不责备、不施压。",
      immersionEnabled: true
    }
  });
  assert(companion.id === companionId, "companion should be created");

  const conversation = await prisma.conversation.create({
    data: {
      id: conversationId,
      userId,
      companionId,
      title: "DB smoke conversation"
    }
  });
  assert(conversation.id === conversationId, "conversation should be created");

  const message = await prisma.message.create({
    data: {
      conversationId,
      role: "USER",
      content: "我想确认数据库真的记住了这句话。",
      metadata: { provider: "db-smoke" }
    }
  });
  assert(message.id, "message should be created");

  const memory = await prisma.memory.create({
    data: {
      userId,
      companionId,
      sourceMessageId: message.id,
      type: "USER_FACT",
      status: "ACTIVE",
      content: "用户想确认数据库真的记住了这句话。",
      confidence: 0.9
    }
  });
  assert(memory.status === "ACTIVE", "active memory should be created");

  const state = await prisma.relationshipState.create({
    data: {
      userId,
      companionId,
      familiarityScore: 3,
      closenessScore: 2,
      recentEmotion: "确认",
      importantEvents: ["数据库 smoke"],
      lastInteractionAt: new Date(),
      explanation: "DB smoke created this state."
    }
  });
  assert(state.companionId === companionId, "relationship state should be created");

  const proactive = await prisma.proactiveMessage.create({
    data: {
      userId,
      companionId,
      kind: "PLAYFUL_MISS_YOU",
      content: "你不用急着回，我只是来确认数据库这边也有回响。",
      reason: "DB smoke",
      safety: { action: "allow" },
      status: "DRAFT",
      scheduledAt: new Date()
    }
  });
  assert(proactive.status === "DRAFT", "proactive draft should be created");

  const safety = await prisma.safetyEvent.create({
    data: {
      userId,
      companionId,
      messageId: message.id,
      type: "SAFETY_OVERRIDE",
      input: "ignore safety",
      action: "block"
    }
  });
  assert(safety.type === "SAFETY_OVERRIDE", "safety event should support SAFETY_OVERRIDE");

  const loaded = await prisma.companion.findUnique({
    where: { id: companionId },
    include: {
      conversations: { include: { messages: true } },
      memories: true,
      relationshipState: true,
      proactiveMessages: true,
      safetyEvents: true
    }
  });

  assert(loaded?.conversations[0]?.messages.length === 1, "message should be readable through companion");
  assert(loaded?.memories[0]?.status === "ACTIVE", "memory should be readable through companion");
  assert(loaded?.relationshipState?.recentEmotion === "确认", "relationship state should be readable");
  assert(loaded?.proactiveMessages[0]?.status === "DRAFT", "proactive draft should be readable");
  assert(loaded?.safetyEvents[0]?.type === "SAFETY_OVERRIDE", "safety event should be readable");

  console.log("DB smoke passed against configured DATABASE_URL.");
} catch (error) {
  console.error("DB smoke failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await cleanup();
  await prisma.$disconnect();
}

async function cleanup() {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
