import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shouldUseMemoryFallback } from "@/lib/persistence/memory-fallback";
import { InMemoryRenewalRepository } from "@/lib/renewal/in-memory-repository";
import { MemoryGroupRepository } from "@/lib/groups/repository";
import { GroupError } from "@/lib/groups/errors";
import { buildStarterRecords } from "./records";

/** Explicit installation only. Stable owner-scoped IDs make retries additive and idempotent. */
export async function installStarterPack(userId: string) {
  const namespace = "starter-" + createHash("sha256").update(userId).digest("hex").slice(0, 24);
  const records = buildStarterRecords(userId, namespace, new Date().toISOString());
  if (shouldUseMemoryFallback()) {
    const renewal = new InMemoryRenewalRepository();
    renewal.installStarterRecords(records);
    const groups = new MemoryGroupRepository(renewal);
    // A concurrent click may have installed the same group while awaiting create.
    try { await groups.create(records.group); }
    catch (error) {
      if (!(error instanceof GroupError) || error.status !== 409) throw error;
      await groups.read(userId, records.group.id);
    }
  } else {
    // Never turn a production write failure into an apparently successful memory install.
    await prisma.$transaction(async tx => {
      for (let index = 0; index < records.companions.length; index++) {
        const companion = records.companions[index];
        const conversation = records.conversations[index];
        const greeting = records.messages[index];
        const { companionId: _companionId, ...state } = records.relationshipStates[index];
        void _companionId;
        const existing = await tx.companion.findUnique({ where: { id: companion.id }, select: { userId: true } });
        if (existing) {
          if (existing.userId !== userId) throw new Error("Starter ownership mismatch");
          continue; // Preserve edits, deleted greetings, memories and relationship progression.
        }
        await tx.companion.upsert({
          where: { id: companion.id }, update: {},
          create: {
            ...companion,
            conversations: { create: {
              id: conversation.id, userId, title: conversation.title, lastMessageAt: conversation.lastMessageAt,
              messages: { create: { id: greeting.id, role: "ASSISTANT", content: greeting.content,
                metadata: greeting.metadata as Prisma.InputJsonValue } }
            } },
            relationshipState: { create: { ...state, userId, importantEvents: [] } }
          }
        });
      }
      await tx.groupWorkspace.upsert({
        where: { id: records.group.id }, update: {},
        create: { id: records.group.id, userId, revision: records.group.revision,
          state: records.group as unknown as Prisma.InputJsonValue }
      });
    }, { maxWait: 10000, timeout: 20000 });
  }
  return { groupId: records.group.id, companionIds: records.companions.map(c => c.id) };
}
