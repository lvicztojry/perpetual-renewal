import type { MemoryRecord, MemoryStatus, MemoryType } from "@/lib/renewal/types";

export type MemoryRevisionRecord = { id: string; userId: string; companionId: string; memoryId: string; kind: "edit" | "status" | "superseded" | "accepted"; before: MemoryRecord; after: MemoryRecord; relatedMemoryId: string | null; createdAt: string };
export type MemoryChange = { action: "edit"; expectedUpdatedAt?: string; content?: string; type?: MemoryType; status?: MemoryStatus }
  | { action: "supersede"; expectedUpdatedAt: string; replacementId: string; replacementUpdatedAt: string };
export class MemoryLifecycleError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message); }
}
export const memoryMissing = () => new MemoryLifecycleError(404, "没有找到这条记忆。");
export const memoryConflict = () => new MemoryLifecycleError(409, "记忆已更新，请重新读取后核对。");
const invalid = () => new MemoryLifecycleError(400, "记忆修改参数无效。");

/** Pure planning: no writes until ALL ownership, version and transition checks pass. */
export function planMemoryChange(records: MemoryRecord[], userId: string, memoryId: string, change: MemoryChange, id: () => string, clock = Date.now()) {
  const found = records.find(memory => memory.id === memoryId && memory.userId === userId);
  if (!found) throw memoryMissing();
  const original = structuredClone(found);
  const checkVersion = (memory: MemoryRecord, version: string | undefined, required = false) => {
    if (version === undefined && !required) return;
    if (typeof version !== "string" || !Number.isFinite(Date.parse(version))) throw invalid();
    if (Date.parse(version) !== Date.parse(memory.updatedAt)) throw memoryConflict();
  };
  checkVersion(original, change.expectedUpdatedAt, change.action === "supersede");
  const result: MemoryRecord[] = [], revisions: MemoryRevisionRecord[] = [], purgeHistoryIds: string[] = [];
  const record = (before: MemoryRecord, after: MemoryRecord, kind: MemoryRevisionRecord["kind"], relatedMemoryId: string | null = null) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    after.updatedAt = new Date(Math.max(clock, Date.parse(before.updatedAt) + 1)).toISOString();
    result.push(after);
    if (after.status === "deleted") { purgeHistoryIds.push(after.id); return; }
    revisions.push({ id: id(), userId, companionId: before.companionId, memoryId: before.id, kind, before, after: structuredClone(after), relatedMemoryId, createdAt: after.updatedAt });
  };
  if (change.action === "supersede") {
    if (original.status !== "active" || change.replacementId === memoryId) throw memoryConflict();
    const candidate = records.find(memory => memory.id === change.replacementId && memory.userId === userId && memory.companionId === original.companionId);
    if (!candidate || candidate.status === "deleted") throw memoryMissing();
    checkVersion(candidate, change.replacementUpdatedAt, true);
    record(original, { ...original, status: "archived", supersededById: candidate.id }, "superseded", candidate.id);
    record(structuredClone(candidate), { ...candidate, status: "active", supersededById: null }, "accepted", original.id);
  } else {
    if (original.status === "deleted") {
      if (change.status === "deleted" && change.content === undefined && change.type === undefined) return { memories: [original], revisions, purgeHistoryIds: [original.id] };
      throw new MemoryLifecycleError(409, "已遗忘的记忆不能恢复，请重新建立记忆。");
    }
    if (change.type !== undefined && !["user_fact", "relationship_event", "companion_profile", "emotional_preference"].includes(change.type)) throw invalid();
    if (change.status !== undefined && !["active", "pending", "archived", "deleted"].includes(change.status)) throw invalid();
    if (change.content !== undefined && (typeof change.content !== "string" || !change.content.trim() || change.content.length > 8000)) throw invalid();
    const status = change.status ?? original.status;
    if (status === "pending" && original.status !== "pending") throw new MemoryLifecycleError(409, "已确认的记忆不能退回候选，请归档或建立新候选。");
    if (status === "active" && original.supersededById) throw new MemoryLifecycleError(409, "这条记忆已被后续事实替代，请通过替代操作重新确认。");
    const next = { ...original, status, ...(change.type ? { type: change.type } : {}), ...(change.content !== undefined ? { content: change.content.trim() } : {}) };
    if (status === "deleted") { next.content = "[已遗忘]"; next.sourceMessageId = null; }
    record(original, next, change.content !== undefined || change.type !== undefined ? "edit" : "status");
  }
  return { memories: result.length ? result : [original], revisions, purgeHistoryIds };
}

declare global { var renewalMemoryRevisionStore: MemoryRevisionRecord[] | undefined; }
export const memoryRevisionStore = () => globalThis.renewalMemoryRevisionStore ??= [];
/** One synchronous snapshot: a forget cannot interleave between facts and their history. */
export function readMemoryExportSnapshotInStore(memories: MemoryRecord[], userId: string) {
  const owned = memories.filter(row => row.userId === userId && row.status !== "deleted");
  const ids = new Set(owned.map(row => row.id));
  return structuredClone({ memories: owned, revisions: memoryRevisionStore().filter(row => row.userId === userId && ids.has(row.memoryId)) });
}
export function clearMemoryHistory(userId: string, companionId?: string) {
  globalThis.renewalMemoryRevisionStore = memoryRevisionStore().filter(row => row.userId !== userId || (companionId !== undefined && row.companionId !== companionId));
}
export function applyMemoryChangeInStore(memories: MemoryRecord[], userId: string, memoryId: string, change: MemoryChange, id: () => string) {
  const plan = planMemoryChange(memories, userId, memoryId, change, id);
  // Clone all results first; no mutation/await can expose a partially accepted pair.
  const next = plan.memories.map(memory => structuredClone(memory));
  const history = memoryRevisionStore().filter(row => !plan.purgeHistoryIds.includes(row.memoryId));
  for (const memory of next) Object.assign(memories.find(item => item.id === memory.id && item.userId === userId)!, memory);
  globalThis.renewalMemoryRevisionStore = [...history, ...structuredClone(plan.revisions)];
  return structuredClone(next);
}
