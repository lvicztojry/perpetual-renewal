import {
  MemoryStatus as PrismaMemoryStatus,
  MemoryType as PrismaMemoryType,
  MessageRole as PrismaMessageRole,
  Prisma,
  ProactiveMessageKind as PrismaProactiveMessageKind,
  ProactiveMessageStatus as PrismaProactiveMessageStatus,
  RelationshipKind as PrismaRelationshipKind
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { updateRelationshipRecordAfterMessage } from "./relationship-state-adapter";

import {
  DEMO_USER_ID,
  type CompanionProfile,
  type CompanionRecord,
  type ConversationRecord,
  type CreateCompanionInput,
  type MemoryRecord,
  type MessageRecord,
  type MessageRole,
  type MemoryStatus,
  type MemoryType,
  type ProactiveMessageKind,
  type ProactiveMessageRecord,
  type ProactiveMessageStatus,
  type RelationshipKind,
  type RelationshipStateRecord,
  type RenewalRepository,
  type UpdateCompanionInput
} from "./types";

const companionProfileInclude = {
  conversations: {
    orderBy: { createdAt: "asc" },
    take: 1
  },
  relationshipState: true,
  memories: {
    where: { status: { not: PrismaMemoryStatus.DELETED } },
    orderBy: { createdAt: "desc" }
  }
} satisfies Prisma.CompanionInclude;

type CompanionWithProfile = Prisma.CompanionGetPayload<{
  include: typeof companionProfileInclude;
}>;

type MessageUpdateInput = Parameters<RenewalRepository["updateMessage"]>[2];

export class PrismaRenewalRepository implements RenewalRepository {
  readonly persistence = "prisma" as const;

  async listCompanions(userId: string) {
    await ensureUser(userId);

    const companions = await prisma.companion.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: companionProfileInclude
    });

    return companions.map(toCompanionProfile);
  }

  async listCompanionsForProactive(userId?: string, limit?: number) {
    if (userId) {
      await ensureUser(userId);
    }

    const companions = await prisma.companion.findMany({
      where: {
        proactiveMessagesEnabled: true,
        ...(userId ? { userId } : {})
      },
      orderBy: { updatedAt: "desc" },
      ...(limit ? { take: limit } : {}),
      include: companionProfileInclude
    });

    return companions.map(toCompanionProfile);
  }

  async getCompanion(userId: string, companionId: string) {
    await ensureUser(userId);

    const companion = await prisma.companion.findFirst({
      where: { id: companionId, userId },
      include: companionProfileInclude
    });

    return companion ? toCompanionProfile(companion) : null;
  }

  async createCompanion(userId: string, input: CreateCompanionInput) {
    await ensureUser(userId);

    const name = input.name.trim();
    const companion = await prisma.companion.create({
      data: {
        userId,
        name,
        relationshipKind: toPrismaRelationshipKind(input.relationshipKind),
        customKind: input.customKind?.trim() || null,
        userAddress: input.userAddress?.trim() || null,
        companionAddress: input.companionAddress?.trim() || null,
        personality: input.personality?.filter(Boolean).slice(0, 8) ?? ["真诚", "贴近"],
        speakingStyle: input.speakingStyle.trim(),
        background: input.background?.trim() || null,
        boundaries: input.boundaries?.trim() || "保持关系内表达，不承诺现实行动、金钱或身份。",
        immersionEnabled: input.immersionEnabled ?? true,
        proactiveMessagesEnabled: input.proactiveMessagesEnabled ?? true,
        proactiveFrequencyPreset: input.proactiveFrequencyPreset ?? "1m",
        proactiveFrequencyMinutes: input.proactiveFrequencyMinutes ?? 1,
        conversations: {
          create: {
            userId,
            title: `和 ${name} 的对话`
          }
        },
        relationshipState: {
          create: {
            userId,
            familiarityScore: 0,
            closenessScore: 0,
            importantEvents: [],
            explanation: "新建关系对象，等待第一次互动。"
          }
        }
      },
      include: companionProfileInclude
    });

    return toCompanionProfile(companion);
  }

  async updateCompanion(userId: string, companionId: string, input: UpdateCompanionInput) {
    await ensureUser(userId);

    const existing = await prisma.companion.findFirst({
      where: { id: companionId, userId },
      select: { id: true }
    });

    if (!existing) return null;

    const companion = await prisma.companion.update({
      where: { id: companionId },
      data: toCompanionUpdateData(input),
      include: companionProfileInclude
    });

    return toCompanionProfile(companion);
  }

  async deleteCompanion(userId: string, companionId: string) {
    await ensureUser(userId);

    const existing = await prisma.companion.findFirst({
      where: { id: companionId, userId },
      select: { id: true }
    });

    if (!existing) return false;

    await prisma.companion.delete({
      where: { id: companionId }
    });

    return true;
  }

  async getConversation(userId: string, conversationId: string) {
    await ensureUser(userId);

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId }
    });

    return conversation ? toConversationRecord(conversation) : null;
  }

  async listMessages(userId: string, conversationId: string) {
    const conversation = await this.getConversation(userId, conversationId);
    if (!conversation) return [];

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" }
    });

    return messages.map(toMessageRecord).filter((message) => !message.metadata?.deletedAt);
  }

  async appendMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>
  ) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true }
    });

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} was not found.`);
    }

    const message = await prisma.message.create({
      data: {
        conversationId,
        role: toPrismaMessageRole(role),
        content,
        metadata: metadata ? sanitizeMetadata(metadata) : undefined
      }
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt }
    });

    return toMessageRecord(message);
  }

  async getMessage(userId: string, conversationId: string, messageId: string) {
    const conversation = await this.getConversation(userId, conversationId);
    if (!conversation) return null;

    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId }
    });
    if (!message) return null;

    const record = toMessageRecord(message);
    return record.metadata?.deletedAt ? null : record;
  }

  async updateMessage(conversationId: string, messageId: string, input: MessageUpdateInput) {
    const existing = await prisma.message.findFirst({
      where: { id: messageId, conversationId }
    });

    if (!existing) return null;

    const message = await prisma.message.update({
      where: { id: messageId },
      data: {
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.metadata !== undefined
          ? { metadata: input.metadata ? sanitizeMetadata(input.metadata) : Prisma.JsonNull }
          : {})
      }
    });

    return toMessageRecord(message);
  }

  async deleteMessage(userId: string, conversationId: string, messageId: string) {
    const message = await this.getMessage(userId, conversationId, messageId);
    if (!message) return false;

    await prisma.message.update({
      where: { id: messageId },
      data: {
        metadata: sanitizeMetadata({
          ...(message.metadata ?? {}),
          deletedAt: new Date().toISOString()
        })
      }
    });

    return true;
  }

  async listMemories(userId: string, companionId: string, includeDeleted = false) {
    await ensureUser(userId);

    const memories = await prisma.memory.findMany({
      where: {
        userId,
        companionId,
        ...(includeDeleted ? {} : { status: { not: PrismaMemoryStatus.DELETED } })
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
    });

    return memories.map(toMemoryRecord);
  }

  async createMemory(
    userId: string,
    companionId: string,
    input: {
      sourceMessageId?: string | null;
      type: MemoryType;
      status: MemoryStatus;
      content: string;
      confidence: number;
    }
  ) {
    await ensureUser(userId);

    const memory = await prisma.memory.create({
      data: {
        userId,
        companionId,
        sourceMessageId: input.sourceMessageId ?? null,
        type: toPrismaMemoryType(input.type),
        status: toPrismaMemoryStatus(input.status),
        content: input.content,
        confidence: input.confidence
      }
    });

    return toMemoryRecord(memory);
  }

  async updateMemory(
    userId: string,
    memoryId: string,
    input: {
      type?: MemoryType;
      status?: MemoryStatus;
      content?: string;
    }
  ) {
    await ensureUser(userId);

    const existing = await prisma.memory.findFirst({
      where: { id: memoryId, userId }
    });

    if (!existing) return null;

    const memory = await prisma.memory.update({
      where: { id: memoryId },
      data: {
        ...(input.type ? { type: toPrismaMemoryType(input.type) } : {}),
        ...(input.status ? { status: toPrismaMemoryStatus(input.status) } : {}),
        ...(input.content !== undefined ? { content: input.content.trim() } : {})
      }
    });

    return toMemoryRecord(memory);
  }

  async deleteMemory(userId: string, memoryId: string) {
    return this.updateMemory(userId, memoryId, { status: "deleted" });
  }

  async createPendingMemory(
    userId: string,
    companionId: string,
    sourceMessageId: string,
    content: string
  ) {
    await ensureUser(userId);

    return this.createMemory(userId, companionId, {
      sourceMessageId,
      type: "user_fact",
      status: "pending",
      content,
      confidence: 0.58
    });
  }

  async listProactiveMessages(
    userId: string,
    companionId: string,
    status?: ProactiveMessageStatus
  ) {
    await ensureUser(userId);

    const messages = await prisma.proactiveMessage.findMany({
      where: {
        userId,
        companionId,
        ...(status ? { status: toPrismaProactiveMessageStatus(status) } : {})
      },
      orderBy: { createdAt: "desc" }
    });

    return messages.map(toProactiveMessageRecord);
  }

  async createProactiveMessage(
    userId: string,
    companionId: string,
    input: {
      kind: ProactiveMessageKind;
      content: string;
      reason?: string | null;
      safety?: Record<string, unknown> | null;
      status?: ProactiveMessageStatus;
      scheduledAt?: string | null;
    }
  ) {
    await ensureUser(userId);

    const existing = await prisma.companion.findFirst({
      where: { id: companionId, userId },
      select: { id: true }
    });

    if (!existing) {
      throw new Error(`Companion ${companionId} was not found.`);
    }

    const message = await prisma.proactiveMessage.create({
      data: {
        userId,
        companionId,
        kind: toPrismaProactiveMessageKind(input.kind),
        content: input.content,
        reason: input.reason ?? null,
        safety: input.safety ? sanitizeMetadata(input.safety) : undefined,
        status: toPrismaProactiveMessageStatus(input.status ?? "draft"),
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null
      }
    });

    return toProactiveMessageRecord(message);
  }

  async updateProactiveMessage(
    userId: string,
    proactiveMessageId: string,
    input: {
      content?: string;
      reason?: string | null;
      safety?: Record<string, unknown> | null;
      status?: ProactiveMessageStatus;
      scheduledAt?: string | null;
    }
  ) {
    await ensureUser(userId);

    const existing = await prisma.proactiveMessage.findFirst({
      where: { id: proactiveMessageId, userId },
      select: { id: true }
    });

    if (!existing) return null;

    const message = await prisma.proactiveMessage.update({
      where: { id: proactiveMessageId },
      data: {
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.safety !== undefined
          ? { safety: input.safety ? sanitizeMetadata(input.safety) : Prisma.JsonNull }
          : {}),
        ...(input.status !== undefined
          ? { status: toPrismaProactiveMessageStatus(input.status) }
          : {}),
        ...(input.scheduledAt !== undefined
          ? { scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null }
          : {})
      }
    });

    return toProactiveMessageRecord(message);
  }

  async updateRelationshipState(
    userId: string,
    companionId: string,
    input: Parameters<RenewalRepository["updateRelationshipState"]>[2]
  ) {
    await ensureUser(userId);

    const existing = await prisma.relationshipState.findFirst({
      where: {
        companionId,
        userId,
        companion: { userId }
      },
      select: { id: true }
    });

    if (!existing) return null;

    const updated = await prisma.relationshipState.update({
      where: { id: existing.id },
      data: {
        familiarityScore: input.familiarityScore,
        closenessScore: input.closenessScore,
        recentEmotion: input.recentEmotion ?? null,
        importantEvents: input.importantEvents.slice(0, 12),
        lastInteractionAt: input.lastInteractionAt ? new Date(input.lastInteractionAt) : null,
        explanation: input.explanation ?? null
      }
    });

    return toRelationshipStateRecord(updated);
  }

  async updateRelationshipAfterMessage(companionId: string, message: MessageRecord) {
    const current = await prisma.relationshipState.findUnique({
      where: { companionId }
    });

    if (!current) {
      throw new Error(`Relationship state for ${companionId} was not found.`);
    }

    const currentRecord = toRelationshipStateRecord(current);
    const nextState = updateRelationshipRecordAfterMessage(currentRecord, message);
    const updated = await prisma.relationshipState.update({
      where: { companionId },
      data: {
        familiarityScore: nextState.familiarityScore,
        closenessScore: nextState.closenessScore,
        recentEmotion: nextState.recentEmotion ?? null,
        importantEvents: nextState.importantEvents.slice(0, 12),
        lastInteractionAt: nextState.lastInteractionAt ? new Date(nextState.lastInteractionAt) : null,
        explanation: nextState.explanation ?? null
      }
    });

    return toRelationshipStateRecord(updated);
  }
}

async function ensureUser(userId: string) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true }
  });

  if (existing) return;

  await prisma.user.create({
    data: {
      id: userId,
      email: fallbackEmailForUser(userId),
      nickname: process.env.DEV_MOCK_USER_NICKNAME ?? "开发用户",
      timezone: process.env.DEV_MOCK_USER_TIMEZONE ?? "Asia/Shanghai",
      language: process.env.DEV_MOCK_USER_LANGUAGE ?? "zh-CN"
    },
    select: { id: true }
  });
}

function fallbackEmailForUser(userId: string) {
  if (userId === DEMO_USER_ID) return "demo-user@perpetual-renewal.local";
  return `${userId}@perpetual-renewal.local`;
}

function toCompanionUpdateData(input: UpdateCompanionInput): Prisma.CompanionUpdateInput {
  const data: Prisma.CompanionUpdateInput = {};

  if (input.name !== undefined) data.name = input.name.trim();
  if (input.relationshipKind !== undefined) {
    data.relationshipKind = toPrismaRelationshipKind(input.relationshipKind);
  }
  if (input.customKind !== undefined) data.customKind = input.customKind?.trim() || null;
  if (input.userAddress !== undefined) data.userAddress = input.userAddress?.trim() || null;
  if (input.companionAddress !== undefined) {
    data.companionAddress = input.companionAddress?.trim() || null;
  }
  if (input.personality !== undefined) {
    data.personality = input.personality.filter(Boolean).slice(0, 8);
  }
  if (input.speakingStyle !== undefined) data.speakingStyle = input.speakingStyle.trim();
  if (input.background !== undefined) data.background = input.background?.trim() || null;
  if (input.boundaries !== undefined) data.boundaries = input.boundaries?.trim() || null;
  if (input.immersionEnabled !== undefined) data.immersionEnabled = input.immersionEnabled;
  if (input.proactiveMessagesEnabled !== undefined) {
    data.proactiveMessagesEnabled = input.proactiveMessagesEnabled;
  }
  if (input.proactiveFrequencyPreset !== undefined) {
    data.proactiveFrequencyPreset = input.proactiveFrequencyPreset;
  }
  if (input.proactiveFrequencyMinutes !== undefined) {
    data.proactiveFrequencyMinutes = input.proactiveFrequencyMinutes;
  }

  return data;
}

function toCompanionProfile(companion: CompanionWithProfile): CompanionProfile {
  const conversation = companion.conversations[0];
  const relationshipState = companion.relationshipState;

  if (!conversation || !relationshipState) {
    throw new Error(`Companion ${companion.id} is missing required linked records.`);
  }

  return {
    ...toCompanionRecord(companion),
    conversationId: conversation.id,
    relationshipState: toRelationshipStateRecord(relationshipState),
    memories: companion.memories.map(toMemoryRecord)
  };
}

function toCompanionRecord(companion: CompanionWithProfile): CompanionRecord {
  return {
    id: companion.id,
    userId: companion.userId,
    name: companion.name,
    relationshipKind: companion.relationshipKind,
    customKind: companion.customKind,
    userAddress: companion.userAddress,
    companionAddress: companion.companionAddress,
    personality: companion.personality,
    speakingStyle: companion.speakingStyle,
    background: companion.background,
    boundaries: companion.boundaries,
    immersionEnabled: companion.immersionEnabled,
    proactiveMessagesEnabled: companion.proactiveMessagesEnabled,
    proactiveFrequencyPreset: companion.proactiveFrequencyPreset as CompanionRecord["proactiveFrequencyPreset"],
    proactiveFrequencyMinutes: companion.proactiveFrequencyMinutes,
    createdAt: companion.createdAt.toISOString(),
    updatedAt: companion.updatedAt.toISOString()
  };
}

function toConversationRecord(
  conversation: Prisma.ConversationGetPayload<Record<string, never>>
): ConversationRecord {
  return {
    id: conversation.id,
    userId: conversation.userId,
    companionId: conversation.companionId,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null
  };
}

function toMessageRecord(message: Prisma.MessageGetPayload<Record<string, never>>): MessageRecord {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role.toLowerCase() as MessageRole,
    content: message.content,
    metadata: toMetadataRecord(message.metadata),
    createdAt: message.createdAt.toISOString()
  };
}

function toMemoryRecord(memory: Prisma.MemoryGetPayload<Record<string, never>>): MemoryRecord {
  return {
    id: memory.id,
    userId: memory.userId,
    companionId: memory.companionId,
    sourceMessageId: memory.sourceMessageId,
    type: memory.type.toLowerCase() as MemoryRecord["type"],
    status: memory.status.toLowerCase() as MemoryRecord["status"],
    content: memory.content,
    confidence: memory.confidence,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString()
  };
}

function toProactiveMessageRecord(
  message: Prisma.ProactiveMessageGetPayload<Record<string, never>>
): ProactiveMessageRecord {
  return {
    id: message.id,
    userId: message.userId,
    companionId: message.companionId,
    kind: message.kind,
    content: message.content,
    reason: message.reason,
    safety: toMetadataRecord(message.safety),
    status: message.status.toLowerCase() as ProactiveMessageStatus,
    scheduledAt: message.scheduledAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString()
  };
}

function toRelationshipStateRecord(
  state: Prisma.RelationshipStateGetPayload<Record<string, never>>
): RelationshipStateRecord {
  return {
    id: state.id,
    companionId: state.companionId,
    familiarityScore: state.familiarityScore,
    closenessScore: state.closenessScore,
    recentEmotion: state.recentEmotion,
    importantEvents: toStringArray(state.importantEvents),
    lastInteractionAt: state.lastInteractionAt?.toISOString() ?? null,
    explanation: state.explanation,
    createdAt: state.createdAt.toISOString(),
    updatedAt: state.updatedAt.toISOString()
  };
}

function toPrismaRelationshipKind(kind: RelationshipKind) {
  return PrismaRelationshipKind[kind];
}

function toPrismaMessageRole(role: MessageRole) {
  return PrismaMessageRole[role.toUpperCase() as keyof typeof PrismaMessageRole];
}

function toPrismaMemoryType(type: MemoryType) {
  return PrismaMemoryType[type.toUpperCase() as keyof typeof PrismaMemoryType];
}

function toPrismaMemoryStatus(status: MemoryStatus) {
  return PrismaMemoryStatus[status.toUpperCase() as keyof typeof PrismaMemoryStatus];
}

function toPrismaProactiveMessageKind(kind: ProactiveMessageKind) {
  return PrismaProactiveMessageKind[kind];
}

function toPrismaProactiveMessageStatus(status: ProactiveMessageStatus) {
  return PrismaProactiveMessageStatus[
    status.toUpperCase() as keyof typeof PrismaProactiveMessageStatus
  ];
}

function toMetadataRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function toStringArray(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function sanitizeMetadata(value: Record<string, unknown>): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Prisma.InputJsonValue] => {
      const [, item] = entry;
      return item !== undefined && isInputJsonValue(item);
    })
  );
}

function isInputJsonValue(value: unknown): value is Prisma.InputJsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) return value.every(isInputJsonValue);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(
      (item) => item !== undefined && isInputJsonValue(item)
    );
  }
  return false;
}
