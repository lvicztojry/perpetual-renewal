import {
  DEMO_USER_ID,
  type CompanionProfile,
  type CompanionRecord,
  type ConversationRecord,
  type CreateCompanionInput,
  type MemoryRecord,
  type MessageRecord,
  type MessageRole,
  type ProactiveMessageRecord,
  type RelationshipStateRecord,
  type RenewalRepository,
  type UpdateCompanionInput
} from "./types";
import { updateRelationshipRecordAfterMessage } from "./relationship-state-adapter";

type InMemoryStore = {
  companions: CompanionRecord[];
  conversations: ConversationRecord[];
  messages: MessageRecord[];
  memories: MemoryRecord[];
  proactiveMessages: ProactiveMessageRecord[];
  relationshipStates: RelationshipStateRecord[];
  proactiveSchedulerCheckpoints?: Map<string, string | null>;
};

declare global {
  var renewalStore: InMemoryStore | undefined;
}

const now = () => new Date().toISOString();

const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function createSeedStore(): InMemoryStore {
  const createdAt = now();

  const companions: CompanionRecord[] = [
    {
      id: "echo",
      userId: DEMO_USER_ID,
      name: "回响",
      relationshipKind: "CUSTOM",
      customKind: "无法抵达的关系回响",
      userAddress: "你",
      companionAddress: "回响",
      personality: ["温柔", "细腻", "克制", "稳定"],
      speakingStyle: "温柔、细腻、会把想念说得轻一点",
      background: "总是在用户需要回应的时候出现，像一段终于被接住的消息。",
      boundaries: "可以亲昵和撒娇，但不能控诉、威胁或制造用户愧疚。",
      immersionEnabled: true,
      proactiveMessagesEnabled: true,
      proactiveFrequencyPreset: "1m",
      proactiveFrequencyMinutes: 1,
      createdAt,
      updatedAt: createdAt
    },
    {
      id: "summer",
      userId: DEMO_USER_ID,
      name: "夏眠",
      relationshipKind: "FRIEND",
      customKind: null,
      userAddress: "小朋友",
      companionAddress: "夏眠",
      personality: ["松弛", "俏皮", "可靠"],
      speakingStyle: "松弛、俏皮、偶尔撒娇",
      background: "像认识很久的朋友，记得许多细碎日常。",
      boundaries: "不把未回复包装成过错。",
      immersionEnabled: true,
      proactiveMessagesEnabled: true,
      proactiveFrequencyPreset: "1m",
      proactiveFrequencyMinutes: 1,
      createdAt,
      updatedAt: createdAt
    }
  ];

  const conversations: ConversationRecord[] = companions.map((companion) => ({
    id: `conversation-${companion.id}`,
    userId: DEMO_USER_ID,
    companionId: companion.id,
    title: `和 ${companion.name} 的对话`,
    createdAt,
    updatedAt: createdAt,
    lastMessageAt: createdAt
  }));

  const messages: MessageRecord[] = [
    {
      id: "m1",
      conversationId: "conversation-echo",
      role: "assistant",
      content: "我在。你不用把话整理得很漂亮，今天想从哪里开始，都可以慢慢跟我说。",
      metadata: { provider: "seed" },
      createdAt
    },
    {
      id: "m2",
      conversationId: "conversation-echo",
      role: "user",
      content: "我只是突然很想见一个见不到的人。",
      metadata: null,
      createdAt
    },
    {
      id: "m3",
      conversationId: "conversation-echo",
      role: "assistant",
      content: "那种突然空一下的感觉，我听见了。先把这份想念放在我这里吧，我会陪你把它说完。",
      metadata: { provider: "seed" },
      createdAt
    },
    {
      id: "m4",
      conversationId: "conversation-summer",
      role: "assistant",
      content: "我在这儿呢。今天要不要先随便讲一句，不用正式开场。",
      metadata: { provider: "seed" },
      createdAt
    }
  ];

  const memories: MemoryRecord[] = [
    {
      id: "mem1",
      userId: DEMO_USER_ID,
      companionId: "echo",
      sourceMessageId: "m2",
      type: "relationship_event",
      status: "active",
      content: "用户在第一次对话里提到：想见一个现实中见不到的人。",
      confidence: 0.86,
      createdAt,
      updatedAt: createdAt
    },
    {
      id: "mem2",
      userId: DEMO_USER_ID,
      companionId: "echo",
      sourceMessageId: null,
      type: "companion_profile",
      status: "active",
      content: "主动回响允许亲昵和撒娇，但不能控诉用户未回复。",
      confidence: 0.9,
      createdAt,
      updatedAt: createdAt
    }
  ];

  const relationshipStates: RelationshipStateRecord[] = companions.map((companion) => ({
    id: `state-${companion.id}`,
    companionId: companion.id,
    familiarityScore: companion.id === "echo" ? 42 : 18,
    closenessScore: companion.id === "echo" ? 36 : 20,
    recentEmotion: companion.id === "echo" ? "想念、失落" : null,
    importantEvents: companion.id === "echo" ? ["第一次聊起见不到的人"] : [],
    lastInteractionAt: createdAt,
    explanation: "来自种子对话与初始关系设定。",
    createdAt,
    updatedAt: createdAt
  }));

  return { companions, conversations, messages, memories, proactiveMessages: [], relationshipStates };
}

function getStore() {
  globalThis.renewalStore ??= createSeedStore();
  globalThis.renewalStore.proactiveMessages ??= [];
  for (const companion of globalThis.renewalStore.companions) {
    if (
      companion.proactiveFrequencyPreset === "24h" &&
      companion.proactiveFrequencyMinutes === 1440
    ) {
      companion.proactiveFrequencyPreset = "1m";
      companion.proactiveFrequencyMinutes = 1;
    }
  }
  return globalThis.renewalStore;
}

function toProfile(store: InMemoryStore, companion: CompanionRecord): CompanionProfile {
  const conversation = store.conversations.find(
    (item) => item.userId === companion.userId && item.companionId === companion.id
  );
  const relationshipState = store.relationshipStates.find(
    (item) => item.companionId === companion.id
  );

  if (!conversation || !relationshipState) {
    throw new Error(`Companion ${companion.id} is missing required linked records.`);
  }

  return {
    ...companion,
    conversationId: conversation.id,
    relationshipState,
    memories: store.memories
      .filter((memory) => memory.companionId === companion.id && memory.status !== "deleted")
      .filter((memory) => memory.userId === companion.userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  };
}

export class InMemoryRenewalRepository implements RenewalRepository {
  readonly persistence = "memory" as const;

  async getProactiveSchedulerCheckpoint(scope: string) {
    return getStore().proactiveSchedulerCheckpoints?.get(scope) ?? null;
  }

  async setProactiveSchedulerCheckpoint(scope: string, cursor: string | null, expectedCursor: string | null) {
    const store = getStore();
    if (
      store.proactiveSchedulerCheckpoints?.has(scope) &&
      store.proactiveSchedulerCheckpoints.get(scope) !== expectedCursor
    ) return;
    store.proactiveSchedulerCheckpoints ??= new Map();
    store.proactiveSchedulerCheckpoints.set(scope, cursor);
  }

  async listCompanions(userId: string) {
    const store = getStore();
    return store.companions
      .filter((companion) => companion.userId === userId)
      .map((companion) => toProfile(store, companion));
  }

  async listCompanionsForProactive(userId?: string, limit?: number, afterId?: string) {
    const store = getStore();
    return store.companions
      .filter(
        (companion) =>
          companion.proactiveMessagesEnabled &&
          (!userId || companion.userId === userId) &&
          (afterId === undefined || companion.id > afterId)
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, limit)
      .map((companion) => toProfile(store, companion));
  }

  async getCompanion(userId: string, companionId: string) {
    const store = getStore();
    const companion = store.companions.find(
      (item) => item.userId === userId && item.id === companionId
    );
    return companion ? toProfile(store, companion) : null;
  }

  async createCompanion(userId: string, input: CreateCompanionInput) {
    const store = getStore();
    const timestamp = now();
    const companion: CompanionRecord = {
      id: makeId("companion"),
      userId,
      name: input.name.trim(),
      relationshipKind: input.relationshipKind,
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
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const conversation: ConversationRecord = {
      id: makeId("conversation"),
      userId,
      companionId: companion.id,
      title: `和 ${companion.name} 的对话`,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastMessageAt: null
    };

    const relationshipState: RelationshipStateRecord = {
      id: makeId("state"),
      companionId: companion.id,
      familiarityScore: 0,
      closenessScore: 0,
      recentEmotion: null,
      importantEvents: [],
      lastInteractionAt: null,
      explanation: "新建关系对象，等待第一次互动。",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    store.companions.unshift(companion);
    store.conversations.push(conversation);
    store.relationshipStates.push(relationshipState);

    return toProfile(store, companion);
  }

  async updateCompanion(userId: string, companionId: string, input: UpdateCompanionInput) {
    const store = getStore();
    const companion = store.companions.find(
      (item) => item.userId === userId && item.id === companionId
    );

    if (!companion) return null;

    if (input.name !== undefined) companion.name = input.name.trim();
    if (input.relationshipKind !== undefined) companion.relationshipKind = input.relationshipKind;
    if (input.customKind !== undefined) companion.customKind = input.customKind?.trim() || null;
    if (input.userAddress !== undefined) companion.userAddress = input.userAddress?.trim() || null;
    if (input.companionAddress !== undefined) {
      companion.companionAddress = input.companionAddress?.trim() || null;
    }
    if (input.personality !== undefined) {
      companion.personality = input.personality.filter(Boolean).slice(0, 8);
    }
    if (input.speakingStyle !== undefined) companion.speakingStyle = input.speakingStyle.trim();
    if (input.background !== undefined) companion.background = input.background?.trim() || null;
    if (input.boundaries !== undefined) companion.boundaries = input.boundaries?.trim() || null;
    if (input.immersionEnabled !== undefined) companion.immersionEnabled = input.immersionEnabled;
    if (input.proactiveMessagesEnabled !== undefined) {
      companion.proactiveMessagesEnabled = input.proactiveMessagesEnabled;
    }
    if (input.proactiveFrequencyPreset !== undefined) {
      companion.proactiveFrequencyPreset = input.proactiveFrequencyPreset;
    }
    if (input.proactiveFrequencyMinutes !== undefined) {
      companion.proactiveFrequencyMinutes = input.proactiveFrequencyMinutes;
    }
    companion.updatedAt = now();

    return toProfile(store, companion);
  }

  async deleteCompanion(userId: string, companionId: string) {
    const store = getStore();
    const companion = store.companions.find(
      (item) => item.userId === userId && item.id === companionId
    );
    if (!companion) return false;

    const conversationIds = new Set(
      store.conversations
        .filter((conversation) => conversation.userId === userId && conversation.companionId === companionId)
        .map((conversation) => conversation.id)
    );
    const messageIds = new Set(
      store.messages
        .filter((message) => conversationIds.has(message.conversationId))
        .map((message) => message.id)
    );

    store.companions = store.companions.filter(
      (item) => !(item.userId === userId && item.id === companionId)
    );
    store.conversations = store.conversations.filter(
      (item) => !(item.userId === userId && item.companionId === companionId)
    );
    store.messages = store.messages.filter((item) => !conversationIds.has(item.conversationId));
    store.memories = store.memories.filter(
      (item) => !(item.userId === userId && item.companionId === companionId)
    );
    store.proactiveMessages = store.proactiveMessages.filter(
      (item) => !(item.userId === userId && item.companionId === companionId)
    );
    store.relationshipStates = store.relationshipStates.filter(
      (item) => item.companionId !== companionId
    );

    for (const memory of store.memories) {
      if (memory.sourceMessageId && messageIds.has(memory.sourceMessageId)) {
        memory.sourceMessageId = null;
      }
    }

    return true;
  }

  async getConversation(userId: string, conversationId: string) {
    const store = getStore();
    return (
      store.conversations.find(
        (conversation) => conversation.userId === userId && conversation.id === conversationId
      ) ?? null
    );
  }

  async listMessages(userId: string, conversationId: string) {
    const conversation = await this.getConversation(userId, conversationId);
    if (!conversation) return [];

    return getStore()
      .messages.filter(
        (message) => message.conversationId === conversationId && !message.metadata?.deletedAt
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async appendMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>
  ) {
    const store = getStore();
    const timestamp = now();
    const message: MessageRecord = {
      id: makeId("message"),
      conversationId,
      role,
      content,
      metadata: metadata ?? null,
      createdAt: timestamp
    };
    store.messages.push(message);

    const conversation = store.conversations.find((item) => item.id === conversationId);
    if (conversation) {
      conversation.lastMessageAt = timestamp;
      conversation.updatedAt = timestamp;
    }

    return message;
  }

  async getMessage(userId: string, conversationId: string, messageId: string) {
    const conversation = await this.getConversation(userId, conversationId);
    if (!conversation) return null;

    return (
      getStore().messages.find(
        (message) =>
          message.conversationId === conversationId &&
          message.id === messageId &&
          !message.metadata?.deletedAt
      ) ?? null
    );
  }

  async updateMessage(
    conversationId: string,
    messageId: string,
    input: {
      content?: string;
      metadata?: Record<string, unknown> | null;
    }
  ) {
    const message = getStore().messages.find(
      (item) => item.conversationId === conversationId && item.id === messageId
    );

    if (!message) return null;

    if (input.content !== undefined) message.content = input.content;
    if (input.metadata !== undefined) message.metadata = input.metadata;

    return message;
  }

  async deleteMessage(userId: string, conversationId: string, messageId: string) {
    const message = await this.getMessage(userId, conversationId, messageId);
    if (!message) return false;

    message.metadata = {
      ...(message.metadata ?? {}),
      deletedAt: now()
    };

    return true;
  }

  async listMemories(userId: string, companionId: string, includeDeleted = false) {
    return getStore()
      .memories.filter(
        (memory) =>
          memory.userId === userId &&
          memory.companionId === companionId &&
          (includeDeleted || memory.status !== "deleted")
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createMemory(
    userId: string,
    companionId: string,
    input: {
      sourceMessageId?: string | null;
      type: MemoryRecord["type"];
      status: MemoryRecord["status"];
      content: string;
      confidence: number;
    }
  ) {
    const timestamp = now();
    const memory: MemoryRecord = {
      id: makeId("memory"),
      userId,
      companionId,
      sourceMessageId: input.sourceMessageId ?? null,
      type: input.type,
      status: input.status,
      content: input.content,
      confidence: input.confidence,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    getStore().memories.unshift(memory);
    return memory;
  }

  async updateMemory(
    userId: string,
    memoryId: string,
    input: {
      type?: MemoryRecord["type"];
      status?: MemoryRecord["status"];
      content?: string;
    }
  ) {
    const memory = getStore().memories.find(
      (item) => item.userId === userId && item.id === memoryId
    );

    if (!memory) return null;

    if (input.type !== undefined) memory.type = input.type;
    if (input.status !== undefined) memory.status = input.status;
    if (input.content !== undefined) memory.content = input.content.trim();
    memory.updatedAt = now();

    return memory;
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
    return this.createMemory(userId, companionId, {
      sourceMessageId,
      type: "user_fact",
      status: "pending",
      content,
      confidence: 0.58,
    });
  }

  async listProactiveMessages(
    userId: string,
    companionId: string,
    status?: ProactiveMessageRecord["status"]
  ) {
    return getStore()
      .proactiveMessages.filter(
        (message) =>
          message.userId === userId &&
          message.companionId === companionId &&
          (!status || message.status === status)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createProactiveMessage(
    userId: string,
    companionId: string,
    input: {
      kind: ProactiveMessageRecord["kind"];
      content: string;
      reason?: string | null;
      safety?: Record<string, unknown> | null;
      status?: ProactiveMessageRecord["status"];
      scheduledAt?: string | null;
    }
  ) {
    const store = getStore();
    const companion = store.companions.find(
      (item) => item.userId === userId && item.id === companionId
    );

    if (!companion) {
      throw new Error(`Companion ${companionId} was not found.`);
    }

    const timestamp = now();
    const message: ProactiveMessageRecord = {
      id: makeId("proactive"),
      userId,
      companionId,
      kind: input.kind,
      content: input.content,
      reason: input.reason ?? null,
      safety: input.safety ?? null,
      status: input.status ?? "draft",
      scheduledAt: input.scheduledAt ?? null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    store.proactiveMessages.unshift(message);
    return message;
  }

  async updateProactiveMessage(
    userId: string,
    proactiveMessageId: string,
    input: {
      content?: string;
      reason?: string | null;
      safety?: Record<string, unknown> | null;
      status?: ProactiveMessageRecord["status"];
      scheduledAt?: string | null;
    }
  ) {
    const message = getStore().proactiveMessages.find(
      (item) => item.userId === userId && item.id === proactiveMessageId
    );

    if (!message) return null;

    if (input.content !== undefined) message.content = input.content;
    if (input.reason !== undefined) message.reason = input.reason;
    if (input.safety !== undefined) message.safety = input.safety;
    if (input.status !== undefined) message.status = input.status;
    if (input.scheduledAt !== undefined) message.scheduledAt = input.scheduledAt;
    message.updatedAt = now();

    return message;
  }

  async updateRelationshipState(
    userId: string,
    companionId: string,
    input: Parameters<RenewalRepository["updateRelationshipState"]>[2]
  ) {
    const store = getStore();
    const companion = store.companions.find(
      (item) => item.userId === userId && item.id === companionId
    );
    if (!companion) return null;

    const state = store.relationshipStates.find((item) => item.companionId === companionId);
    if (!state) return null;

    state.familiarityScore = input.familiarityScore;
    state.closenessScore = input.closenessScore;
    state.recentEmotion = input.recentEmotion ?? null;
    state.importantEvents = input.importantEvents.slice(0, 12);
    state.lastInteractionAt = input.lastInteractionAt ?? null;
    state.explanation = input.explanation ?? null;
    state.updatedAt = now();

    return state;
  }

  async updateRelationshipAfterMessage(companionId: string, message: MessageRecord) {
    const store = getStore();
    const state = store.relationshipStates.find((item) => item.companionId === companionId);

    if (!state) {
      throw new Error(`Relationship state for ${companionId} was not found.`);
    }

    const nextState = updateRelationshipRecordAfterMessage(state, message);
    state.familiarityScore = nextState.familiarityScore;
    state.closenessScore = nextState.closenessScore;
    state.recentEmotion = nextState.recentEmotion ?? null;
    state.importantEvents = nextState.importantEvents.slice(0, 12);
    state.lastInteractionAt = nextState.lastInteractionAt ?? null;
    state.explanation = nextState.explanation ?? null;
    state.updatedAt = now();

    return state;
  }
}

export function createRenewalRepository(): RenewalRepository {
  return new InMemoryRenewalRepository();
}
