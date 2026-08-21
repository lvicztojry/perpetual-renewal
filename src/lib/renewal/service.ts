import { LlmProviderError } from "@/lib/llm/types";
import { generateCompanionReply } from "@/lib/chat";
import { extractMemoryCandidates } from "@/lib/memory/extractor";
import { redactSensitiveResponseText } from "@/lib/http/response-safety";
import { recordModelUsage } from "@/lib/usage";
import { createUserLlmProvider } from "@/lib/llm/user-provider";
import { normalizeProactiveFrequency } from "@/lib/relationship/proactive-frequency";
import {
  DEMO_USER_ID,
  type CreateCompanionInput,
  type MemoryRecord,
  type MemoryStatus,
  type MemoryType,
  type MessageRecord,
  type RelationshipKind,
  type RegenerateMessageResult,
  type RenewalRepository,
  type SendMessageResult,
  type UpdateCompanionInput,
  relationshipKindLabels,
  relationshipKinds
} from "./types";
import { createRenewalRepository } from "./repository";

const repository = createRenewalRepository();

export class CompanionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanionValidationError";
  }
}

export function companionValidationErrorMessage(error: CompanionValidationError) {
  if (error.message === "Companion name is required.") return "Companion name is required.";
  if (error.message === "Speaking style is required.") return "Speaking style is required.";
  if (error.message === "Unsupported relationship kind.") return "Unsupported relationship kind.";
  return "Failed to save companion.";
}

export class MemoryCandidateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryCandidateValidationError";
  }
}

export class MemoryUpdateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryUpdateValidationError";
  }
}

export class MessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageValidationError";
  }
}

export function getRenewalService(userId = DEMO_USER_ID) {
  return new RenewalService(repository, userId);
}

export class RenewalService {
  constructor(
    private readonly repo: RenewalRepository,
    private readonly userId: string
  ) {}

  listCompanions() {
    return this.repo.listCompanions(this.userId);
  }

  async createCompanion(input: CreateCompanionInput) {
    return this.repo.createCompanion(this.userId, normalizeCreateInput(input));
  }

  async updateCompanion(companionId: string, input: UpdateCompanionInput) {
    return this.repo.updateCompanion(this.userId, companionId, normalizeUpdateInput(input));
  }

  async deleteCompanion(companionId: string) {
    return this.repo.deleteCompanion(this.userId, companionId);
  }

  async listMessages(conversationId: string) {
    return this.repo.listMessages(this.userId, conversationId);
  }

  async listMemories(companionId: string, includeDeleted = false) {
    return this.repo.listMemories(this.userId, companionId, includeDeleted);
  }

  async createMemoryCandidates(companionId: string, input: {
    sourceMessageId?: string | null;
    content: string;
    type?: MemoryType;
  }) {
    const companion = await this.repo.getCompanion(this.userId, companionId);
    if (!companion) return null;

    const content = input.content.trim();
    if (!content) throw new MemoryCandidateValidationError("content is required");

    if (input.sourceMessageId) {
      const sourceMessage = await this.repo.getMessage(
        this.userId,
        companion.conversationId,
        input.sourceMessageId
      );
      if (!sourceMessage) {
        throw new MemoryCandidateValidationError("sourceMessageId was not found");
      }
    }

    const candidates = input.type
      ? [
          {
            sourceMessageId: input.sourceMessageId ?? undefined,
            type: input.type,
            status: "pending" as const,
            content,
            confidence: 0.8
          }
        ]
      : extractMemoryCandidates({
          content,
          sourceMessageId: input.sourceMessageId ?? undefined
        }).map((candidate) => ({
          ...candidate,
          type: candidate.type.toLowerCase() as MemoryType,
          status: candidate.status.toLowerCase() as MemoryStatus
        }));

    const memories: MemoryRecord[] = [];
    for (const candidate of candidates) {
      memories.push(
        await this.repo.createMemory(this.userId, companionId, {
          sourceMessageId: candidate.sourceMessageId ?? null,
          type: candidate.type,
          status: candidate.status,
          content: candidate.content,
          confidence: candidate.confidence
        })
      );
    }

    return memories;
  }

  async updateMemory(memoryId: string, input: {
    type?: MemoryType;
    status?: MemoryStatus;
    content?: string;
  }) {
    const update = normalizeMemoryUpdate(input);
    if (input.content !== undefined && !update.content) {
      throw new MemoryUpdateValidationError("content is required");
    }

    return this.repo.updateMemory(this.userId, memoryId, update);
  }

  async deleteMemory(memoryId: string) {
    return this.repo.deleteMemory(this.userId, memoryId);
  }

  async sendMessage(conversationId: string, content: string): Promise<SendMessageResult | null> {
    const conversation = await this.repo.getConversation(this.userId, conversationId);
    if (!conversation) return null;

    const companion = await this.repo.getCompanion(this.userId, conversation.companionId);
    if (!companion) return null;

    const trimmed = content.trim();
    if (!trimmed) throw new MessageValidationError("Message content is required.");

    const userMessage = await this.repo.appendMessage(conversationId, "user", trimmed);
    const relationshipState = await this.repo.updateRelationshipAfterMessage(
      companion.id,
      userMessage
    );
    const pendingMemory = shouldCreateMemory(trimmed)
      ? await this.repo.createPendingMemory(
          this.userId,
          companion.id,
          userMessage.id,
          `候选记忆：用户刚刚说过“${trimMemoryQuote(trimmed)}”。`
        )
      : null;

    try {
      const history = await this.repo.listMessages(this.userId, conversationId);
      const startedAt = Date.now();
      const llmProvider = await createUserLlmProvider(this.userId);
      const completion = await generateCompanionReply({
        companion: {
          name: companion.name,
          relationshipKind: relationshipKindLabels[companion.relationshipKind],
          customRelationship: companion.customKind,
          userAddress: companion.userAddress,
          companionAddress: companion.companionAddress,
          personality: companion.personality,
          speakingStyle: companion.speakingStyle,
          background: companion.background,
          boundaries: companion.boundaries,
          immersionEnabled: companion.immersionEnabled
        },
        memories: companion.memories,
        relationshipState: companion.relationshipState,
        recentMessages: messagesForPrompt(history),
        temperature: 0.7
      }, llmProvider);
      const assistantMessage = await this.repo.appendMessage(
        conversationId,
        "assistant",
        completion.content,
        {
          status: "sent",
          provider: completion.provider,
          model: completion.model,
          usage: completion.usage
        }
      );
      await recordModelUsage({
        userId: this.userId,
        companionId: companion.id,
        conversationId,
        messageId: assistantMessage.id,
        purpose: "chat_reply",
        provider: completion.provider,
        model: completion.model,
        status: "success",
        usage: completion.usage,
        latencyMs: Date.now() - startedAt,
        fallbackReason: completion.fallbackReason
      });

      return {
        userMessage,
        assistantMessage,
        pendingMemory,
        relationshipState,
        completion: {
          provider: completion.provider,
          model: completion.model,
          usage: completion.usage
        }
      };
    } catch (error) {
      const assistantError = toAssistantError(error);
      const failedMessage = await this.repo.appendMessage(
        conversationId,
        "assistant",
        "回复生成失败了。刚才的话我已经收到了，可以点重试让我重新回应。",
        {
          status: "failed",
          provider: assistantError.provider,
          model: assistantError.model,
          error: assistantError.message,
          statusCode: assistantError.status
        }
      );
      await recordModelUsage({
        userId: this.userId,
        companionId: companion.id,
        conversationId,
        messageId: failedMessage.id,
        purpose: "chat_reply",
        provider: assistantError.provider ?? "unknown",
        model: assistantError.model,
        status: "error",
        errorKind: assistantError.kind,
        httpStatus: assistantError.status
      });

      return {
        userMessage,
        assistantMessage: failedMessage,
        pendingMemory,
        relationshipState,
        completion: null,
        assistantError
      };
    }
  }

  async regenerateMessage(
    conversationId: string,
    messageId: string
  ): Promise<RegenerateMessageResult | null> {
    const conversation = await this.repo.getConversation(this.userId, conversationId);
    if (!conversation) return null;

    const companion = await this.repo.getCompanion(this.userId, conversation.companionId);
    if (!companion) return null;

    const target = await this.repo.getMessage(this.userId, conversationId, messageId);
    if (!target) return null;
    if (target.role !== "assistant") {
      throw new MessageValidationError("Only assistant messages can be regenerated.");
    }

    const history = await this.repo.listMessages(this.userId, conversationId);
    const targetIndex = history.findIndex((message) => message.id === messageId);
    const promptHistory = messagesForPrompt(targetIndex >= 0 ? history.slice(0, targetIndex) : history);

    if (!promptHistory.some((message) => message.role === "user")) {
      throw new MessageValidationError("Regeneration requires at least one prior user message.");
    }

    const startedAt = Date.now();
    const llmProvider = await createUserLlmProvider(this.userId);
    const completion = await generateCompanionReply({
      companion: {
        name: companion.name,
        relationshipKind: relationshipKindLabels[companion.relationshipKind],
        customRelationship: companion.customKind,
        userAddress: companion.userAddress,
        companionAddress: companion.companionAddress,
        personality: companion.personality,
        speakingStyle: companion.speakingStyle,
        background: companion.background,
        boundaries: companion.boundaries,
        immersionEnabled: companion.immersionEnabled
      },
      memories: companion.memories,
      relationshipState: companion.relationshipState,
      recentMessages: promptHistory,
      temperature: 0.75
    }, llmProvider);
    const assistantMessage = await this.repo.updateMessage(conversationId, messageId, {
      content: completion.content,
      metadata: {
        ...(target.metadata ?? {}),
        status: "sent",
        provider: completion.provider,
        model: completion.model,
        usage: completion.usage,
        regeneratedAt: new Date().toISOString(),
        error: undefined,
        statusCode: undefined
      }
    });

    if (!assistantMessage) return null;
    await recordModelUsage({
      userId: this.userId,
      companionId: companion.id,
      conversationId,
      messageId: assistantMessage.id,
      purpose: "chat_regenerate",
      provider: completion.provider,
      model: completion.model,
      status: "success",
      usage: completion.usage,
      latencyMs: Date.now() - startedAt,
      fallbackReason: completion.fallbackReason
    });

    return {
      assistantMessage,
      completion: {
        provider: completion.provider,
        model: completion.model,
        usage: completion.usage
      }
    };
  }

  async deleteMessage(conversationId: string, messageId: string) {
    return this.repo.deleteMessage(this.userId, conversationId, messageId);
  }

  async setMessageImportance(conversationId: string, messageId: string, important: boolean) {
    const target = await this.repo.getMessage(this.userId, conversationId, messageId);
    if (!target) return null;

    return this.repo.updateMessage(conversationId, messageId, {
      metadata: {
        ...(target.metadata ?? {}),
        important,
        importantUpdatedAt: new Date().toISOString()
      }
    });
  }
}

function messagesForPrompt(messages: MessageRecord[]) {
  return messages.filter(
    (message) =>
      message.role !== "system" &&
      message.metadata?.status !== "failed" &&
      !message.metadata?.deletedAt
  );
}

function trimMemoryQuote(text: string) {
  const sanitized = redactSensitiveResponseText(text) ?? "";
  if (sanitized.length <= 42) return sanitized;
  return `${sanitized.slice(0, 42)}...`;
}

function toAssistantError(error: unknown) {
  if (error instanceof LlmProviderError) {
    return {
      message: error.message,
      provider: error.details.provider,
      model: error.details.model,
      kind: error.details.kind,
      status: error.details.status
    };
  }

  return {
    message: error instanceof Error ? error.message : "Assistant reply failed.",
    provider: "unknown"
  };
}

function normalizeCreateInput(input: CreateCompanionInput): CreateCompanionInput {
  assertRelationshipKind(input.relationshipKind);
  const name = input.name?.trim();
  const speakingStyle = input.speakingStyle?.trim();

  if (!name) throw new CompanionValidationError("Companion name is required.");
  if (!speakingStyle) throw new CompanionValidationError("Speaking style is required.");

  const proactiveFrequency = normalizeProactiveFrequency({
    preset: input.proactiveFrequencyPreset,
    everyMinutes: input.proactiveFrequencyMinutes
  });

  return {
    ...input,
    name,
    speakingStyle,
    personality: normalizePersonality(input.personality),
    immersionEnabled: input.immersionEnabled ?? true,
    proactiveMessagesEnabled: input.proactiveMessagesEnabled ?? true,
    proactiveFrequencyPreset: proactiveFrequency.preset,
    proactiveFrequencyMinutes: proactiveFrequency.everyMinutes
  };
}

function normalizeUpdateInput(input: UpdateCompanionInput): UpdateCompanionInput {
  if (input.relationshipKind) assertRelationshipKind(input.relationshipKind);
  if (input.name !== undefined && !input.name.trim()) {
    throw new CompanionValidationError("Companion name is required.");
  }
  if (input.speakingStyle !== undefined && !input.speakingStyle.trim()) {
    throw new CompanionValidationError("Speaking style is required.");
  }

  const proactiveFrequency =
    input.proactiveFrequencyPreset !== undefined || input.proactiveFrequencyMinutes !== undefined
      ? normalizeProactiveFrequency({
          preset: input.proactiveFrequencyPreset,
          everyMinutes: input.proactiveFrequencyMinutes
        })
      : undefined;

  return {
    ...input,
    personality: input.personality ? normalizePersonality(input.personality) : undefined,
    proactiveFrequencyPreset: proactiveFrequency?.preset,
    proactiveFrequencyMinutes: proactiveFrequency?.everyMinutes
  };
}

function normalizePersonality(personality?: string[]) {
  const normalized = personality?.map((item) => item.trim()).filter(Boolean).slice(0, 8);
  return normalized?.length ? normalized : ["真诚", "贴近", "稳定"];
}

function assertRelationshipKind(kind: RelationshipKind) {
  if (!relationshipKinds.includes(kind)) {
    throw new CompanionValidationError("Unsupported relationship kind.");
  }
}

function shouldCreateMemory(content: string) {
  return content.length >= 8;
}

function normalizeMemoryUpdate(input: {
  type?: MemoryType;
  status?: MemoryStatus;
  content?: string;
}) {
  return {
    type: input.type,
    status: input.status,
    content: input.content?.trim()
  };
}
