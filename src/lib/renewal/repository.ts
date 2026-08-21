import { InMemoryRenewalRepository } from "./in-memory-repository";
import { PrismaRenewalRepository } from "./prisma-repository";
import { safeLogValue } from "@/lib/logging/sanitize";
import type { MessageRole, ProactiveMessageStatus, RenewalRepository } from "./types";

const databaseUnavailableCodes = new Set([
  "P1000",
  "P1001",
  "P1002",
  "P1003",
  "P1008",
  "P1017",
  "P2021",
  "P2024"
]);

export function createRenewalRepository(): RenewalRepository {
  const fallback = new InMemoryRenewalRepository();
  const isLocalFallbackAllowed = process.env.NODE_ENV !== "production";

  if (
    isLocalFallbackAllowed &&
    (process.env.RENEWAL_REPOSITORY === "memory" || !process.env.DATABASE_URL)
  ) {
    return fallback;
  }

  return new FallbackRenewalRepository(new PrismaRenewalRepository(), fallback);
}

class FallbackRenewalRepository implements RenewalRepository {
  persistence: RenewalRepository["persistence"] = "prisma";
  private warned = false;

  constructor(
    private readonly primary: RenewalRepository,
    private readonly fallback: RenewalRepository
  ) {}

  listCompanions(userId: string) {
    return this.run(
      () => this.primary.listCompanions(userId),
      () => this.fallback.listCompanions(userId)
    );
  }

  listCompanionsForProactive(userId?: string) {
    return this.run(
      () => this.primary.listCompanionsForProactive(userId),
      () => this.fallback.listCompanionsForProactive(userId)
    );
  }

  getCompanion(userId: string, companionId: string) {
    return this.run(
      () => this.primary.getCompanion(userId, companionId),
      () => this.fallback.getCompanion(userId, companionId)
    );
  }

  createCompanion(userId: string, input: Parameters<RenewalRepository["createCompanion"]>[1]) {
    return this.run(
      () => this.primary.createCompanion(userId, input),
      () => this.fallback.createCompanion(userId, input)
    );
  }

  updateCompanion(
    userId: string,
    companionId: string,
    input: Parameters<RenewalRepository["updateCompanion"]>[2]
  ) {
    return this.run(
      () => this.primary.updateCompanion(userId, companionId, input),
      () => this.fallback.updateCompanion(userId, companionId, input)
    );
  }

  deleteCompanion(userId: string, companionId: string) {
    return this.run(
      () => this.primary.deleteCompanion(userId, companionId),
      () => this.fallback.deleteCompanion(userId, companionId)
    );
  }

  getConversation(userId: string, conversationId: string) {
    return this.run(
      () => this.primary.getConversation(userId, conversationId),
      () => this.fallback.getConversation(userId, conversationId)
    );
  }

  listMessages(userId: string, conversationId: string) {
    return this.run(
      () => this.primary.listMessages(userId, conversationId),
      () => this.fallback.listMessages(userId, conversationId)
    );
  }

  appendMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>
  ) {
    return this.run(
      () => this.primary.appendMessage(conversationId, role, content, metadata),
      () => this.fallback.appendMessage(conversationId, role, content, metadata)
    );
  }

  getMessage(userId: string, conversationId: string, messageId: string) {
    return this.run(
      () => this.primary.getMessage(userId, conversationId, messageId),
      () => this.fallback.getMessage(userId, conversationId, messageId)
    );
  }

  updateMessage(
    conversationId: string,
    messageId: string,
    input: Parameters<RenewalRepository["updateMessage"]>[2]
  ) {
    return this.run(
      () => this.primary.updateMessage(conversationId, messageId, input),
      () => this.fallback.updateMessage(conversationId, messageId, input)
    );
  }

  deleteMessage(userId: string, conversationId: string, messageId: string) {
    return this.run(
      () => this.primary.deleteMessage(userId, conversationId, messageId),
      () => this.fallback.deleteMessage(userId, conversationId, messageId)
    );
  }

  listMemories(userId: string, companionId: string, includeDeleted?: boolean) {
    return this.run(
      () => this.primary.listMemories(userId, companionId, includeDeleted),
      () => this.fallback.listMemories(userId, companionId, includeDeleted)
    );
  }

  createMemory(
    userId: string,
    companionId: string,
    input: Parameters<RenewalRepository["createMemory"]>[2]
  ) {
    return this.run(
      () => this.primary.createMemory(userId, companionId, input),
      () => this.fallback.createMemory(userId, companionId, input)
    );
  }

  updateMemory(
    userId: string,
    memoryId: string,
    input: Parameters<RenewalRepository["updateMemory"]>[2]
  ) {
    return this.run(
      () => this.primary.updateMemory(userId, memoryId, input),
      () => this.fallback.updateMemory(userId, memoryId, input)
    );
  }

  deleteMemory(userId: string, memoryId: string) {
    return this.run(
      () => this.primary.deleteMemory(userId, memoryId),
      () => this.fallback.deleteMemory(userId, memoryId)
    );
  }

  createPendingMemory(
    userId: string,
    companionId: string,
    sourceMessageId: string,
    content: string
  ) {
    return this.run(
      () => this.primary.createPendingMemory(userId, companionId, sourceMessageId, content),
      () => this.fallback.createPendingMemory(userId, companionId, sourceMessageId, content)
    );
  }

  listProactiveMessages(userId: string, companionId: string, status?: ProactiveMessageStatus) {
    return this.run(
      () => this.primary.listProactiveMessages(userId, companionId, status),
      () => this.fallback.listProactiveMessages(userId, companionId, status)
    );
  }

  createProactiveMessage(
    userId: string,
    companionId: string,
    input: Parameters<RenewalRepository["createProactiveMessage"]>[2]
  ) {
    return this.run(
      () => this.primary.createProactiveMessage(userId, companionId, input),
      () => this.fallback.createProactiveMessage(userId, companionId, input)
    );
  }

  updateProactiveMessage(
    userId: string,
    proactiveMessageId: string,
    input: Parameters<RenewalRepository["updateProactiveMessage"]>[2]
  ) {
    return this.run(
      () => this.primary.updateProactiveMessage(userId, proactiveMessageId, input),
      () => this.fallback.updateProactiveMessage(userId, proactiveMessageId, input)
    );
  }

  updateRelationshipState(
    userId: string,
    companionId: string,
    input: Parameters<RenewalRepository["updateRelationshipState"]>[2]
  ) {
    return this.run(
      () => this.primary.updateRelationshipState(userId, companionId, input),
      () => this.fallback.updateRelationshipState(userId, companionId, input)
    );
  }

  updateRelationshipAfterMessage(
    companionId: string,
    message: Parameters<RenewalRepository["updateRelationshipAfterMessage"]>[1]
  ) {
    return this.run(
      () => this.primary.updateRelationshipAfterMessage(companionId, message),
      () => this.fallback.updateRelationshipAfterMessage(companionId, message)
    );
  }

  private async run<T>(primary: () => Promise<T>, fallback: () => Promise<T>) {
    try {
      const result = await primary();
      this.persistence = "prisma";
      return result;
    } catch (error) {
      if (!shouldFallbackToMemory(error)) {
        throw error;
      }

      this.warnOnce(error);
      this.persistence = "memory";
      return fallback();
    }
  }

  private warnOnce(error: unknown) {
    if (this.warned) return;
    this.warned = true;

    console.warn(
      "[renewal] Prisma repository unavailable; falling back to in-memory demo store.",
      safeLogValue(error)
    );
  }
}

function shouldFallbackToMemory(error: unknown) {
  if (process.env.NODE_ENV === "production") return false;

  const code = typeof error === "object" && error ? (error as { code?: string }).code : undefined;
  if (code && databaseUnavailableCodes.has(code)) return true;

  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("Can't reach database server") ||
    message.includes("Environment variable not found") ||
    message.includes("does not exist in the current database")
  );
}
