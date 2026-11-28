import { randomUUID } from "node:crypto";
import type { Memory, Prisma, PrismaClient } from "@prisma/client";
import type { MemoryRecord } from "@/lib/renewal/types";
import { memoryConflict, memoryMissing, planMemoryChange, type MemoryChange } from "./lifecycle";

export function lifecycleMemoryRecord(row: Memory): MemoryRecord {
  return { id: row.id, userId: row.userId, companionId: row.companionId, sourceMessageId: row.sourceMessageId,
    supersededById: row.supersededById, type: row.type.toLowerCase() as MemoryRecord["type"],
    status: row.status.toLowerCase() as MemoryRecord["status"], content: row.content, confidence: row.confidence,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

/** Every changed memory and its own before/after log commit or roll back together. */
export async function applyPrismaMemoryChange(db: PrismaClient, userId: string, memoryId: string, change: MemoryChange) {
  return db.$transaction(async tx => {
    const ids = change.action === "supersede" ? [memoryId, change.replacementId] : [memoryId];
    const rows = await tx.memory.findMany({ where: { userId, id: { in: ids } } });
    const originals = rows.map(lifecycleMemoryRecord);
    const plan = planMemoryChange(originals, userId, memoryId, change, randomUUID);
    for (const next of plan.memories) {
      const before = originals.find(memory => memory.id === next.id)!;
      if (JSON.stringify(before) === JSON.stringify(next)) continue;
      const changed = await tx.memory.updateMany({ where: { id: next.id, userId, updatedAt: new Date(before.updatedAt) }, data: {
        content: next.content, type: next.type.toUpperCase() as Memory["type"], status: next.status.toUpperCase() as Memory["status"],
        sourceMessageId: next.sourceMessageId, supersededById: next.supersededById ?? null, updatedAt: new Date(next.updatedAt)
      } });
      if (changed.count !== 1) throw memoryConflict();
    }
    if (plan.purgeHistoryIds.length) await tx.memoryRevision.deleteMany({ where: { userId, memoryId: { in: plan.purgeHistoryIds } } });
    if (plan.revisions.length) await tx.memoryRevision.createMany({ data: plan.revisions.map(row => ({ ...row,
      before: row.before as unknown as Prisma.InputJsonValue, after: row.after as unknown as Prisma.InputJsonValue,
      createdAt: new Date(row.createdAt)
    })) });
    return plan.memories;
  }, { isolationLevel: "Serializable", timeout: 20000, maxWait: 5000 }).catch(error => {
    if (typeof error === "object" && error && "code" in error && error.code === "P2034") throw memoryConflict();
    throw error;
  });
}

export async function readPrismaMemoryHistory(db: PrismaClient, userId: string, memoryId: string, beforeId?: string) {
  const memory = await db.memory.findFirst({ where: { id: memoryId, userId } });
  if (!memory) throw memoryMissing();
  const cursor = beforeId ? await db.memoryRevision.findFirst({ where: { id: beforeId, memoryId, userId } }) : null;
  if (beforeId && !cursor) throw memoryMissing();
  const rows = await db.memoryRevision.findMany({ where: { userId, memoryId,
    ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {})
  }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21 });
  return { items: rows.slice(0, 20).map(row => ({ ...row, createdAt: row.createdAt.toISOString() })), nextCursor: rows.length > 20 ? rows[19].id : null };
}

/** Snapshot semantics: facts and revision history describe the same database point in time. */
export async function readPrismaMemoryExportSnapshot(db: PrismaClient, userId: string) {
  return db.$transaction(async tx => {
    const memories = await tx.memory.findMany({ where: { userId, status: { not: "DELETED" } }, orderBy: { id: "asc" } });
    const revisions = await tx.memoryRevision.findMany({ where: { userId, memory: { userId, status: { not: "DELETED" } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return { memories: memories.map(lifecycleMemoryRecord), revisions };
  }, { isolationLevel: "RepeatableRead", timeout: 20000, maxWait: 5000 });
}
