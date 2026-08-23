import { prisma } from "@/lib/prisma";
import { shouldFallbackToMemoryOnPrismaError, shouldUseMemoryFallback } from "@/lib/persistence/memory-fallback";
import { DEMO_USER_ID } from "@/lib/renewal/types";

export const ACCOUNT_DELETE_CONFIRMATION = "删除我的账号";

export type DeleteAccountSummary = {
  userId: string;
  persistence: "prisma" | "memory";
  deleted: true;
  counts: {
    companions: number;
    conversations: number;
    messages: number;
    memories: number;
    relationshipStates: number;
    proactiveMessages: number;
    safetyEvents: number;
    modelUsageLogs: number;
    providerCredentials: number;
  };
};

const databaseUnavailableCodes = new Set(["P1000", "P1001", "P1002", "P1003", "P2021", "P2024"]);

type AccountDeletionStores = typeof globalThis & {
  renewalStore?: {
    companions: Array<{ userId: string; id: string }>;
    conversations: Array<{ userId: string; id: string; companionId: string }>;
    messages: Array<{ conversationId: string }>;
    memories: Array<{ userId: string; companionId: string }>;
    proactiveMessages: Array<{ userId: string; companionId: string }>;
    relationshipStates: Array<{ companionId: string }>;
  };
  renewalCredentialStore?: Map<string, unknown>;
  renewalSafetyEventStore?: {
    events: Array<{ userId: string }>;
  };
  renewalUsageStore?: {
    logs: Array<{ userId: string }>;
  };
  __perpetualRenewalFallbackProfiles?: Map<string, unknown>;
  __perpetualRenewalFallbackSessions?: Map<string, unknown>;
};

export class DeleteAccountValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeleteAccountValidationError";
  }
}

export async function deleteCurrentUserAccount(
  userId: string,
  input: { confirmation?: unknown }
): Promise<DeleteAccountSummary> {
  if (input.confirmation !== ACCOUNT_DELETE_CONFIRMATION) {
    throw new DeleteAccountValidationError(`请输入“${ACCOUNT_DELETE_CONFIRMATION}”确认删除。`);
  }

  if (shouldUseFallbackDeletion()) {
    return deleteFallbackAccount(userId);
  }

  try {
    const counts = await countPrismaUserRecords(userId);
    await prisma.user.delete({ where: { id: userId } });

    return {
      userId,
      persistence: "prisma",
      deleted: true,
      counts
    };
  } catch (error) {
    if (!shouldFallbackToMemory(error)) {
      throw error;
    }

    return deleteFallbackAccount(userId);
  }
}

async function countPrismaUserRecords(userId: string): Promise<DeleteAccountSummary["counts"]> {
  const companionIds = await prisma.companion.findMany({
    where: { userId },
    select: { id: true }
  });
  const conversationIds = await prisma.conversation.findMany({
    where: { userId },
    select: { id: true }
  });

  const companionIdValues = companionIds.map((companion) => companion.id);
  const conversationIdValues = conversationIds.map((conversation) => conversation.id);

  const [
    companions,
    conversations,
    messages,
    memories,
    relationshipStates,
    proactiveMessages,
    safetyEvents,
    modelUsageLogs,
    providerCredentials
  ] = await prisma.$transaction([
    prisma.companion.count({ where: { userId } }),
    prisma.conversation.count({ where: { userId } }),
    prisma.message.count({ where: { conversationId: { in: conversationIdValues } } }),
    prisma.memory.count({ where: { userId } }),
    prisma.relationshipState.count({ where: { userId } }),
    prisma.proactiveMessage.count({ where: { userId } }),
    prisma.safetyEvent.count({ where: { userId } }),
    prisma.modelUsageLog.count({ where: { userId } }),
    prisma.providerCredential.count({ where: { userId } })
  ]);

  return {
    companions,
    conversations,
    messages,
    memories: Math.max(memories, companionIdValues.length ? memories : 0),
    relationshipStates,
    proactiveMessages,
    safetyEvents,
    modelUsageLogs,
    providerCredentials
  };
}

function deleteFallbackAccount(userId: string): DeleteAccountSummary {
  const stores = globalThis as AccountDeletionStores;
  const store = stores.renewalStore;
  const companionIds = new Set(
    (store?.companions ?? []).filter((companion) => companion.userId === userId).map((item) => item.id)
  );
  const conversationIds = new Set(
    (store?.conversations ?? [])
      .filter((conversation) => conversation.userId === userId || companionIds.has(conversation.companionId))
      .map((conversation) => conversation.id)
  );

  const counts = {
    companions: (store?.companions ?? []).filter((item) => item.userId === userId).length,
    conversations: (store?.conversations ?? []).filter(
      (item) => item.userId === userId || companionIds.has(item.companionId)
    ).length,
    messages: (store?.messages ?? []).filter((item) => conversationIds.has(item.conversationId)).length,
    memories: (store?.memories ?? []).filter(
      (item) => item.userId === userId || companionIds.has(item.companionId)
    ).length,
    relationshipStates: (store?.relationshipStates ?? []).filter((item) =>
      companionIds.has(item.companionId)
    ).length,
    proactiveMessages: (store?.proactiveMessages ?? []).filter(
      (item) => item.userId === userId || companionIds.has(item.companionId)
    ).length,
    safetyEvents: (stores.renewalSafetyEventStore?.events ?? []).filter(
      (item) => item.userId === userId
    ).length,
    modelUsageLogs: (stores.renewalUsageStore?.logs ?? []).filter((item) => item.userId === userId)
      .length,
    providerCredentials: stores.renewalCredentialStore?.has(userId) ? 1 : 0
  };

  if (store) {
    store.companions = store.companions.filter((item) => item.userId !== userId);
    store.conversations = store.conversations.filter(
      (item) => item.userId !== userId && !companionIds.has(item.companionId)
    );
    store.messages = store.messages.filter((item) => !conversationIds.has(item.conversationId));
    store.memories = store.memories.filter(
      (item) => item.userId !== userId && !companionIds.has(item.companionId)
    );
    store.proactiveMessages = store.proactiveMessages.filter(
      (item) => item.userId !== userId && !companionIds.has(item.companionId)
    );
    store.relationshipStates = store.relationshipStates.filter(
      (item) => !companionIds.has(item.companionId)
    );
  }

  stores.renewalCredentialStore?.delete(userId);
  if (stores.renewalSafetyEventStore) {
    stores.renewalSafetyEventStore.events = stores.renewalSafetyEventStore.events.filter(
      (item) => item.userId !== userId
    );
  }
  if (stores.renewalUsageStore) {
    stores.renewalUsageStore.logs = stores.renewalUsageStore.logs.filter(
      (item) => item.userId !== userId
    );
  }
  stores.__perpetualRenewalFallbackProfiles?.delete(userId);
  stores.__perpetualRenewalFallbackSessions?.delete(userId);

  return {
    userId,
    persistence: "memory",
    deleted: true,
    counts
  };
}

function shouldUseFallbackDeletion() {
  return shouldUseMemoryFallback();
}

function shouldFallbackToMemory(error: unknown) {
  return shouldFallbackToMemoryOnPrismaError(error, { codes: databaseUnavailableCodes });
}

export function isFallbackDemoAccount(userId: string) {
  return userId === DEMO_USER_ID && shouldUseFallbackDeletion();
}
