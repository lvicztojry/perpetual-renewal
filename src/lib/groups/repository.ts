import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shouldUseMemoryFallback } from "@/lib/persistence/memory-fallback";
import { InMemoryRenewalRepository } from "@/lib/renewal/in-memory-repository";
import { PrismaRenewalRepository } from "@/lib/renewal/prisma-repository";
import type { CompanionProfile } from "@/lib/renewal/types";
import type { GroupState } from "./types";
import { conflict, missing } from "./errors";
import { boundState } from "./validation";

export type ReplyClaim = {
  token: string;
  status: "pending" | "done" | "failed";
  claimedAt: string;
  leaseUntil: string;
  attempts: number;
  source?: "local" | "model";
};
export type GroupControl = { plan: { turn: number; speakers: string[]; proactive: boolean; claims: Record<string, ReplyClaim> } | null; deliveries: Record<string, { turn: number; speakers: string[]; mentionIds: string[] }>; autoRounds: number };
export type StoredGroup = GroupState & { _control: GroupControl };
export interface GroupRepository {
  list(userId: string): Promise<StoredGroup[]>;
  read(userId: string, id: string): Promise<StoredGroup>;
  create(state: StoredGroup): Promise<StoredGroup>;
  delete(userId: string, id: string): Promise<void>;
  /** Synchronous callback, never run models or external effects here. CAS conflicts are not retried. */
  mutate(userId: string, id: string, run: (state: StoredGroup) => StoredGroup): Promise<StoredGroup>;
  companions(userId: string): Promise<CompanionProfile[]>;
}
declare global { var renewalGroupStore: Map<string, StoredGroup> | undefined; }
const store = () => globalThis.renewalGroupStore ??= new Map<string, StoredGroup>();
const clone = <T>(value: T): T => structuredClone(value);
function nextState(before: StoredGroup, next: StoredGroup) {
  if (before.id !== next.id || before.userId !== next.userId) throw conflict();
  if (JSON.stringify(before) === JSON.stringify(next)) return before;
  return boundState({ ...next, revision: before.revision + 1 });
}
export class MemoryGroupRepository implements GroupRepository {
  constructor(private readonly renewal = new InMemoryRenewalRepository()) {}
  async companions(userId: string) { return clone(await this.renewal.listCompanions(userId)); }
  async list(userId: string) { return clone([...store().values()].filter(g => g.userId === userId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))); }
  async read(userId: string, id: string) { const state = store().get(id); if (!state || state.userId !== userId) throw missing(); return clone(state); }
  async create(state: StoredGroup) { if (store().has(state.id)) throw conflict(); store().set(state.id, clone(boundState(state))); return clone(state); }
  async delete(userId: string, id: string) { const state = store().get(id); if (!state || state.userId !== userId) throw missing(); store().delete(id); }
  async mutate(userId: string, id: string, run: (state: StoredGroup) => StoredGroup) {
    // No await between read and write: shared process store mutation is atomic.
    const before = store().get(id); if (!before || before.userId !== userId) throw missing();
    const next = nextState(before, run(clone(before))); store().set(id, clone(next)); return clone(next);
  }
}
export class PrismaGroupRepository implements GroupRepository {
  constructor(private readonly db = prisma, private readonly renewal = new PrismaRenewalRepository()) {}
  companions(userId: string) { return this.renewal.listCompanions(userId); }
  async list(userId: string) { const rows = await this.db.groupWorkspace.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }); return rows.map(row => row.state as unknown as StoredGroup); }
  async read(userId: string, id: string) { const row = await this.db.groupWorkspace.findFirst({ where: { id, userId } }); if (!row) throw missing(); return row.state as unknown as StoredGroup; }
  async create(state: StoredGroup) {
    boundState(state);
    await this.db.groupWorkspace.create({ data: { id: state.id, userId: state.userId, revision: state.revision, state: state as unknown as Prisma.InputJsonValue } });
    return state;
  }
  async delete(userId: string, id: string) { const result = await this.db.groupWorkspace.deleteMany({ where: { id, userId } }); if (!result.count) throw missing(); }
  async mutate(userId: string, id: string, run: (state: StoredGroup) => StoredGroup) {
    const before = await this.read(userId, id);
    const next = nextState(before, run(clone(before)));
    if (next === before) return before;
    const changed = await this.db.groupWorkspace.updateMany({ where: { id, userId, revision: before.revision }, data: { revision: next.revision, state: next as unknown as Prisma.InputJsonValue } });
    if (changed.count !== 1) throw conflict();
    return next;
  }
}
export function createGroupRepository(): GroupRepository { return shouldUseMemoryFallback() ? new MemoryGroupRepository() : new PrismaGroupRepository(); }
export async function listGroupsForExport(userId: string): Promise<GroupState[]> {
  return (await createGroupRepository().list(userId)).map(publicGroup);
}
export async function deleteGroupsForAccount(userId: string) {
  let count = 0; for (const [id, row] of store()) if (row.userId === userId) { store().delete(id); count++; }
  if (!shouldUseMemoryFallback()) { const deleted = await prisma.groupWorkspace.deleteMany({ where: { userId } }); count += deleted.count; }
  return { count };
}
/** Stable keyset page across ALL users. Pass the last id as afterId for the next page. */
export async function listScheduledGroups(limit = 100, afterId?: string): Promise<GroupState[]> {
  const take = Math.min(500, Math.max(1, Math.floor(limit) || 100));
  if (!shouldUseMemoryFallback()) {
    const rows = await prisma.groupWorkspace.findMany({ where: { ...(afterId ? { id: { gt: afterId } } : {}), state: { path: ["settings", "proactiveEnabled"], equals: true } }, orderBy: { id: "asc" }, take });
    return rows.map(row => publicGroup(row.state as unknown as StoredGroup));
  }
  return [...store().values()].filter(g => g.settings.proactiveEnabled && (!afterId || g.id > afterId)).sort((a,b) => a.id < b.id ? -1 : 1).slice(0,take).map(publicGroup);
}
export function publicGroup(state: StoredGroup): GroupState { const { _control, ...group } = clone(state); void _control; return group; }
