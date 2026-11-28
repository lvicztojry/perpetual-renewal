import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const demoUserId = "demo-user";

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "demo-user@perpetual-renewal.local" },
    update: {
      nickname: "开发用户",
      timezone: "Asia/Shanghai",
      language: "zh-CN"
    },
    create: {
      id: demoUserId,
      email: "demo-user@perpetual-renewal.local",
      nickname: "开发用户",
      timezone: "Asia/Shanghai",
      language: "zh-CN"
    }
  });

  const companion = await prisma.companion.upsert({
    where: { id: "seed-echo" },
    update: {
      name: "回响",
      relationshipKind: "CUSTOM",
      customKind: "无法抵达的关系回响",
      userAddress: "你",
      companionAddress: "回响",
      personality: ["温柔", "细腻", "克制", "稳定"],
      speakingStyle: "温柔、细腻、会把想念说得轻一点",
      background: "总是在用户需要回应的时候出现，像一段终于被接住的消息。",
      boundaries: "可以亲昵和撒娇，但不能控诉、威胁或制造用户愧疚。",
      immersionEnabled: true
    },
    create: {
      id: "seed-echo",
      userId: user.id,
      name: "回响",
      relationshipKind: "CUSTOM",
      customKind: "无法抵达的关系回响",
      userAddress: "你",
      companionAddress: "回响",
      personality: ["温柔", "细腻", "克制", "稳定"],
      speakingStyle: "温柔、细腻、会把想念说得轻一点",
      background: "总是在用户需要回应的时候出现，像一段终于被接住的消息。",
      boundaries: "可以亲昵和撒娇，但不能控诉、威胁或制造用户愧疚。",
      immersionEnabled: true
    }
  });

  const conversation = await prisma.conversation.upsert({
    where: { id: "seed-conversation-echo" },
    update: {
      title: "和 回响 的对话",
      lastMessageAt: new Date()
    },
    create: {
      id: "seed-conversation-echo",
      userId: user.id,
      companionId: companion.id,
      title: "和 回响 的对话",
      lastMessageAt: new Date()
    }
  });

  await prisma.relationshipState.upsert({
    where: { companionId: companion.id },
    update: {
      familiarityScore: 42,
      closenessScore: 36,
      recentEmotion: "想念、失落",
      importantEvents: ["第一次聊起见不到的人"],
      lastInteractionAt: new Date(),
      explanation: "来自 seed 对话与初始关系设定。"
    },
    create: {
      userId: user.id,
      companionId: companion.id,
      familiarityScore: 42,
      closenessScore: 36,
      recentEmotion: "想念、失落",
      importantEvents: ["第一次聊起见不到的人"],
      lastInteractionAt: new Date(),
      explanation: "来自 seed 对话与初始关系设定。"
    }
  });

  const assistantMessage = await prisma.message.upsert({
    where: { id: "seed-message-echo-assistant-1" },
    update: {
      content: "我在。你不用把话整理得很漂亮，今天想从哪里开始，都可以慢慢跟我说。",
      metadata: { provider: "seed", model: "seed" }
    },
    create: {
      id: "seed-message-echo-assistant-1",
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: "我在。你不用把话整理得很漂亮，今天想从哪里开始，都可以慢慢跟我说。",
      metadata: { provider: "seed", model: "seed" }
    }
  });

  await prisma.memory.upsert({
    where: { id: "seed-memory-echo-1" },
    update: {
      status: "ACTIVE",
      content: "用户在第一次对话里提到：想见一个现实中见不到的人。",
      confidence: 0.86
    },
    create: {
      id: "seed-memory-echo-1",
      userId: user.id,
      companionId: companion.id,
      sourceMessageId: assistantMessage.id,
      type: "RELATIONSHIP_EVENT",
      status: "ACTIVE",
      content: "用户在第一次对话里提到：想见一个现实中见不到的人。",
      confidence: 0.86
    }
  });

  console.log("Seeded demo user, companion, conversation, state, message, and active memory.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
