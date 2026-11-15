import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shouldUseMemoryFallback } from "@/lib/persistence/memory-fallback";
import { InMemoryRenewalRepository } from "@/lib/renewal/in-memory-repository";
import { PrismaRenewalRepository } from "@/lib/renewal/prisma-repository";
import type { CompanionProfile } from "@/lib/renewal/types";
import type { DreamProfile, DreamState } from "./types";
import { conflict, missing } from "./errors";

export type DreamMutation = { state: DreamState; profile?: DreamProfile };
export interface DreamRepository {
  read(userId: string, companionId: string): Promise<{ companion: CompanionProfile; state: DreamState | null }>;
  mutate(userId: string, companionId: string, run: (companion: CompanionProfile, state: DreamState | null) => DreamMutation): Promise<{ companion: CompanionProfile; state: DreamState }>;
}
type StoredDream = { userId: string; state: DreamState };
declare global { var renewalDreamStore: Map<string, StoredDream> | undefined; }
const memoryStore = () => globalThis.renewalDreamStore ??= new Map<string, StoredDream>();
const clone = <T>(value: T): T => structuredClone(value);
const timestamp = (companion: CompanionProfile) => new Date(Math.max(Date.now(), Date.parse(companion.updatedAt) + 1)).toISOString();

export class MemoryDreamRepository implements DreamRepository {
  // This repository uses renewal's shared global store, never an isolated companion store.
  constructor(private readonly renewal = new InMemoryRenewalRepository()) {}
  async read(userId: string, companionId: string) {
    const companion = await this.renewal.getCompanion(userId, companionId);
    if (!companion) throw missing();
    const stored = memoryStore().get(companionId);
    return clone({ companion, state: stored?.userId === userId ? stored.state : null });
  }
  async mutate(userId: string, companionId: string, run: (companion: CompanionProfile, state: DreamState | null) => DreamMutation) {
    const result = this.renewal.atomicDreamUpdate(userId, companionId, companion => {
      const stored = memoryStore().get(companionId);
      const next = run(companion, stored?.userId === userId ? clone(stored.state) : null);
      if (next.profile) {
        companion.updatedAt = timestamp(companion);
        Object.assign(companion, clone(next.profile));
        next.state.baseCompanionUpdatedAt = companion.updatedAt;
      }
      memoryStore().set(companionId, { userId, state: clone(next.state) });
      return { value: clone({ companion, state: next.state }), profile: next.profile, updatedAt: companion.updatedAt };
    });
    if (!result) throw missing();
    return result;
  }
}

export class PrismaDreamRepository implements DreamRepository {
  private readonly renewal = new PrismaRenewalRepository();
  async read(userId: string, companionId: string) {
    const companion = await this.renewal.getCompanion(userId, companionId);
    if (!companion) throw missing();
    const row = await prisma.dreamWorkspace.findFirst({ where: { userId, companionId } });
    return { companion, state: row ? row.state as unknown as DreamState : null };
  }
  async mutate(userId: string, companionId: string, run: (companion: CompanionProfile, state: DreamState | null) => DreamMutation) {
    // Read before taking any lock; never acquire a second connection inside the transaction.
    const companion = await this.renewal.getCompanion(userId, companionId);
    if (!companion) throw missing();
    return prisma.$transaction(async tx => {
      // A no-op versioned update locks the parent before a workspace exists.
      // Prisma qualifies the configured schema; raw unqualified SQL would hit public.
      const locked = await tx.companion.updateMany({
        where: { id: companionId, userId, updatedAt: new Date(companion.updatedAt) },
        data: { updatedAt: new Date(companion.updatedAt) }
      });
      if (locked.count !== 1) throw conflict();
      const row = await tx.dreamWorkspace.findFirst({ where: { userId, companionId } });
      const next = run(companion, row ? row.state as unknown as DreamState : null);
      if (next.profile) {
        const updatedAt = timestamp(companion);
        const changed = await tx.companion.updateMany({ where: { id: companionId, userId, updatedAt: new Date(companion.updatedAt) }, data: { ...next.profile, updatedAt: new Date(updatedAt) } });
        if (changed.count !== 1) throw conflict();
        Object.assign(companion, next.profile, { updatedAt });
        next.state.baseCompanionUpdatedAt = updatedAt;
      }
      const data = { revision: next.state.revision, state: next.state as unknown as Prisma.InputJsonValue };
      if (row) {
        const changed = await tx.dreamWorkspace.updateMany({ where: { id: row.id, userId, revision: row.revision }, data });
        if (changed.count !== 1) throw conflict();
      } else {
        await tx.dreamWorkspace.create({ data: { id: next.state.id, userId, companionId, ...data } });
      }
      return { companion, state: next.state };
    });
  }
}
export function createDreamRepository(): DreamRepository {
  return shouldUseMemoryFallback() ? new MemoryDreamRepository() : new PrismaDreamRepository();
}
/** Export includes rounds, feedback, fragments and retained versions. No DB-error fallback. */
export async function listDreamWorkspacesForExport(userId: string) {
  if (!shouldUseMemoryFallback()) return prisma.dreamWorkspace.findMany({ where: { userId }, orderBy: { id: "asc" } });
  const companionIds = new Set((await new InMemoryRenewalRepository().listCompanions(userId)).map(c => c.id));
  return clone([...memoryStore().values()].filter(row => row.userId === userId && companionIds.has(row.state.companionId)));
}
/** DB deletion also happens through FK cascades; call this for memory account/companion cleanup. */
export async function deleteDreamWorkspaces(userId: string, companionId?: string) {
  if (!shouldUseMemoryFallback()) return prisma.dreamWorkspace.deleteMany({ where: { userId, ...(companionId ? { companionId } : {}) } });
  for (const [id, row] of memoryStore()) if (row.userId === userId && (!companionId || id === companionId)) memoryStore().delete(id);
}
