import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { shouldUseMemoryFallback } from "@/lib/persistence/memory-fallback";
import { InMemoryRenewalRepository } from "@/lib/renewal/in-memory-repository";
import { applyMemoryChangeInStore, memoryMissing, memoryRevisionStore, readMemoryExportSnapshotInStore, MemoryLifecycleError } from "./lifecycle";
import { applyPrismaMemoryChange, readPrismaMemoryHistory, readPrismaMemoryExportSnapshot } from "./lifecycle-prisma";

export async function readMemoryHistory(userId: string, memoryId: string, beforeId?: string) {
  if (!shouldUseMemoryFallback()) return readPrismaMemoryHistory(prisma, userId, memoryId, beforeId);
  // Initialize the same owned memory store as private chat, never a parallel store.
  await new InMemoryRenewalRepository().listCompanions(userId);
  if (!globalThis.renewalStore?.memories.some(memory => memory.id === memoryId && memory.userId === userId)) throw memoryMissing();
  const rows = memoryRevisionStore().filter(row => row.userId === userId && row.memoryId === memoryId)
    .slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const start = beforeId ? rows.findIndex(row => row.id === beforeId) + 1 : 0;
  if (beforeId && start === 0) throw memoryMissing();
  const items = structuredClone(rows.slice(start, start + 20));
  return { items, nextCursor: start + 20 < rows.length ? items.at(-1)!.id : null };
}

export async function supersedeMemory(userId: string, memoryId: string, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MemoryLifecycleError(400, "记忆替代参数无效。");
  const row = input as Record<string, unknown>;
  if (row.action !== "supersede" || typeof row.replacementId !== "string" || !row.replacementId || row.replacementId.length > 128 || typeof row.expectedUpdatedAt !== "string" || typeof row.replacementUpdatedAt !== "string") throw new MemoryLifecycleError(400, "记忆替代参数无效。");
  const change = { action: "supersede" as const, replacementId: row.replacementId, expectedUpdatedAt: row.expectedUpdatedAt, replacementUpdatedAt: row.replacementUpdatedAt };
  if (!shouldUseMemoryFallback()) return applyPrismaMemoryChange(prisma, userId, memoryId, change);
  await new InMemoryRenewalRepository().listCompanions(userId);
  return applyMemoryChangeInStore(globalThis.renewalStore!.memories, userId, memoryId, change, randomUUID);
}

export async function readMemoryExportSnapshot(userId: string) {
  if (!shouldUseMemoryFallback()) return readPrismaMemoryExportSnapshot(prisma, userId);
  await new InMemoryRenewalRepository().listCompanions(userId);
  return readMemoryExportSnapshotInStore(globalThis.renewalStore!.memories, userId);
}
