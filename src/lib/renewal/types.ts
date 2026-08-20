export const DEMO_USER_ID = "demo-user";

export const relationshipKindLabels = {
  REAL_PERSON_SUBSTITUTE: "现实人物替代",
  MEMORIAL: "逝者纪念",
  EX_PARTNER: "前任",
  LOVER: "恋人",
  FRIEND: "朋友",
  FAMILY: "家人",
  MENTOR: "师友",
  PUBLIC_FIGURE_IMAGINED: "公众人物想象",
  FICTIONAL_CHARACTER: "虚构角色",
  ORIGINAL_CHARACTER: "原创角色",
  CUSTOM: "自定义"
} as const;

export type RelationshipKind = keyof typeof relationshipKindLabels;

export const relationshipKinds = Object.keys(relationshipKindLabels) as RelationshipKind[];

export type MessageRole = "system" | "user" | "assistant";

export type MemoryStatus = "pending" | "active" | "archived" | "deleted";

export type MemoryType =
  | "user_fact"
  | "relationship_event"
  | "companion_profile"
  | "emotional_preference";

export type ProactiveMessageStatus = "draft" | "sent" | "dismissed" | "blocked";

export type ProactiveMessageKind =
  | "DAILY_GREETING"
  | "LAST_CONVERSATION_FOLLOWUP"
  | "ANNIVERSARY"
  | "EMOTION_CARE"
  | "PLAYFUL_MISS_YOU";

export type ProactiveFrequencyPreset = "6h" | "12h" | "24h" | "72h" | "custom";

export type CompanionRecord = {
  id: string;
  userId: string;
  name: string;
  relationshipKind: RelationshipKind;
  customKind: string | null;
  userAddress: string | null;
  companionAddress: string | null;
  personality: string[];
  speakingStyle: string;
  background: string | null;
  boundaries: string | null;
  immersionEnabled: boolean;
  proactiveMessagesEnabled: boolean;
  proactiveFrequencyPreset: ProactiveFrequencyPreset;
  proactiveFrequencyMinutes: number;
  createdAt: string;
  updatedAt: string;
};

export type ConversationRecord = {
  id: string;
  userId: string;
  companionId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
};

export type MessageRecord = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type MemoryRecord = {
  id: string;
  userId: string;
  companionId: string;
  sourceMessageId: string | null;
  type: MemoryType;
  status: MemoryStatus;
  content: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

export type ProactiveMessageRecord = {
  id: string;
  userId: string;
  companionId: string;
  kind: ProactiveMessageKind;
  content: string;
  reason: string | null;
  safety: Record<string, unknown> | null;
  status: ProactiveMessageStatus;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RelationshipStateRecord = {
  id: string;
  companionId: string;
  familiarityScore: number;
  closenessScore: number;
  recentEmotion: string | null;
  importantEvents: string[];
  lastInteractionAt: string | null;
  explanation: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompanionProfile = CompanionRecord & {
  conversationId: string;
  relationshipState: RelationshipStateRecord;
  memories: MemoryRecord[];
};

export type CreateCompanionInput = {
  name: string;
  relationshipKind: RelationshipKind;
  customKind?: string | null;
  userAddress?: string | null;
  companionAddress?: string | null;
  personality?: string[];
  speakingStyle: string;
  background?: string | null;
  boundaries?: string | null;
  immersionEnabled?: boolean;
  proactiveMessagesEnabled?: boolean;
  proactiveFrequencyPreset?: ProactiveFrequencyPreset;
  proactiveFrequencyMinutes?: number;
};

export type UpdateCompanionInput = Partial<CreateCompanionInput>;

export type CreateProactiveMessageInput = {
  kind: ProactiveMessageKind;
  content: string;
  reason?: string | null;
  safety?: Record<string, unknown> | null;
  status?: ProactiveMessageStatus;
  scheduledAt?: string | null;
};

export type UpdateProactiveMessageInput = {
  content?: string;
  reason?: string | null;
  safety?: Record<string, unknown> | null;
  status?: ProactiveMessageStatus;
  scheduledAt?: string | null;
};

export type RepositoryPersistence = "prisma" | "memory";

export type SendMessageResult = {
  userMessage: MessageRecord;
  assistantMessage: MessageRecord | null;
  pendingMemory: MemoryRecord | null;
  relationshipState: RelationshipStateRecord;
  completion: {
    provider: string;
    model: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  } | null;
  assistantError?: {
    message: string;
    provider?: string;
    model?: string;
    status?: number;
  };
};

export type RegenerateMessageResult = {
  assistantMessage: MessageRecord;
  completion: {
    provider: string;
    model: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };
};

export type RenewalRepository = {
  persistence: RepositoryPersistence;
  listCompanions(userId: string): Promise<CompanionProfile[]>;
  listCompanionsForProactive(userId?: string): Promise<CompanionProfile[]>;
  getCompanion(userId: string, companionId: string): Promise<CompanionProfile | null>;
  createCompanion(userId: string, input: CreateCompanionInput): Promise<CompanionProfile>;
  updateCompanion(
    userId: string,
    companionId: string,
    input: UpdateCompanionInput
  ): Promise<CompanionProfile | null>;
  deleteCompanion(userId: string, companionId: string): Promise<boolean>;
  getConversation(userId: string, conversationId: string): Promise<ConversationRecord | null>;
  listMessages(userId: string, conversationId: string): Promise<MessageRecord[]>;
  appendMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<MessageRecord>;
  getMessage(
    userId: string,
    conversationId: string,
    messageId: string
  ): Promise<MessageRecord | null>;
  updateMessage(
    conversationId: string,
    messageId: string,
    input: {
      content?: string;
      metadata?: Record<string, unknown> | null;
    }
  ): Promise<MessageRecord | null>;
  deleteMessage(userId: string, conversationId: string, messageId: string): Promise<boolean>;
  listMemories(
    userId: string,
    companionId: string,
    includeDeleted?: boolean
  ): Promise<MemoryRecord[]>;
  createMemory(
    userId: string,
    companionId: string,
    input: {
      sourceMessageId?: string | null;
      type: MemoryType;
      status: MemoryStatus;
      content: string;
      confidence: number;
    }
  ): Promise<MemoryRecord>;
  updateMemory(
    userId: string,
    memoryId: string,
    input: {
      type?: MemoryType;
      status?: MemoryStatus;
      content?: string;
    }
  ): Promise<MemoryRecord | null>;
  deleteMemory(userId: string, memoryId: string): Promise<MemoryRecord | null>;
  createPendingMemory(
    userId: string,
    companionId: string,
    sourceMessageId: string,
    content: string
  ): Promise<MemoryRecord>;
  listProactiveMessages(
    userId: string,
    companionId: string,
    status?: ProactiveMessageStatus
  ): Promise<ProactiveMessageRecord[]>;
  createProactiveMessage(
    userId: string,
    companionId: string,
    input: CreateProactiveMessageInput
  ): Promise<ProactiveMessageRecord>;
  updateProactiveMessage(
    userId: string,
    proactiveMessageId: string,
    input: UpdateProactiveMessageInput
  ): Promise<ProactiveMessageRecord | null>;
  updateRelationshipAfterMessage(
    companionId: string,
    message: MessageRecord
  ): Promise<RelationshipStateRecord>;
};
