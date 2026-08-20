import { prisma } from "@/lib/prisma";
import type { SafetyEventLog } from "./types";

type SafetyEventRepository = {
  persistence: "prisma" | "memory";
  create(event: SafetyEventLog): Promise<SafetyEventLog>;
  listForExport(userId: string, limit: number): Promise<SafetyEventLog[]>;
};

type SafetyEventStore = {
  events: SafetyEventLog[];
};

declare global {
  var renewalSafetyEventStore: SafetyEventStore | undefined;
}

const databaseUnavailableCodes = new Set(["P1000", "P1001", "P1002", "P1003", "P2021", "P2024"]);

export function createSafetyEventRepository(): SafetyEventRepository {
  const fallback = new InMemorySafetyEventRepository();
  const isLocalFallbackAllowed = process.env.NODE_ENV !== "production";

  if (
    isLocalFallbackAllowed &&
    (process.env.RENEWAL_REPOSITORY === "memory" || !process.env.DATABASE_URL)
  ) {
    return fallback;
  }

  return new FallbackSafetyEventRepository(new PrismaSafetyEventRepository(), fallback);
}

class FallbackSafetyEventRepository implements SafetyEventRepository {
  persistence: SafetyEventRepository["persistence"] = "prisma";
  private warned = false;

  constructor(
    private readonly primary: SafetyEventRepository,
    private readonly fallback: SafetyEventRepository
  ) {}

  async create(event: SafetyEventLog) {
    try {
      const created = await this.primary.create(event);
      this.persistence = "prisma";
      return created;
    } catch (error) {
      if (!shouldFallbackToMemory(error)) {
        throw error;
      }

      if (!this.warned) {
        this.warned = true;
        console.warn(
          "[safety-events] Prisma repository unavailable; falling back to in-memory store.",
          error instanceof Error ? error.message : error
        );
      }

      this.persistence = "memory";
      return this.fallback.create(event);
    }
  }

  async listForExport(userId: string, limit: number) {
    try {
      const events = await this.primary.listForExport(userId, limit);
      this.persistence = "prisma";
      return events;
    } catch (error) {
      if (!shouldFallbackToMemory(error)) {
        throw error;
      }

      if (!this.warned) {
        this.warned = true;
        console.warn(
          "[safety-events] Prisma repository unavailable; falling back to in-memory store.",
          error instanceof Error ? error.message : error
        );
      }

      this.persistence = "memory";
      return this.fallback.listForExport(userId, limit);
    }
  }
}

class InMemorySafetyEventRepository implements SafetyEventRepository {
  readonly persistence = "memory" as const;

  async create(event: SafetyEventLog) {
    getStore().events.unshift(event);
    return event;
  }

  async listForExport(userId: string, limit: number) {
    return getStore()
      .events.filter((event) => event.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

class PrismaSafetyEventRepository implements SafetyEventRepository {
  readonly persistence = "prisma" as const;

  async create(event: SafetyEventLog) {
    await prisma.safetyEvent.create({
      data: {
        id: event.id,
        userId: event.userId,
        companionId: event.companionId,
        messageId: event.messageId,
        type: event.type,
        action: event.action,
        stage: event.stage,
        severity: event.severity,
        contentHash: event.contentHash,
        riskHash: event.riskHash,
        createdAt: new Date(event.createdAt)
      }
    });

    return event;
  }

  async listForExport(userId: string, limit: number) {
    const events = await prisma.safetyEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    return events.map((event) => ({
      id: event.id,
      userId: event.userId,
      companionId: event.companionId,
      messageId: event.messageId,
      type: event.type as SafetyEventLog["type"],
      action: event.action as SafetyEventLog["action"],
      stage: event.stage as SafetyEventLog["stage"],
      severity: event.severity as SafetyEventLog["severity"],
      contentHash: event.contentHash,
      riskHash: event.riskHash,
      createdAt: event.createdAt.toISOString()
    }));
  }
}

function getStore() {
  globalThis.renewalSafetyEventStore ??= { events: [] };
  return globalThis.renewalSafetyEventStore;
}

function shouldFallbackToMemory(error: unknown) {
  if (process.env.NODE_ENV === "production") return false;

  const code = typeof error === "object" && error ? (error as { code?: string }).code : undefined;
  if (code && databaseUnavailableCodes.has(code)) return true;

  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("Can't reach database server") ||
    message.includes("Environment variable not found") ||
    message.includes("does not exist in the current database") ||
    message.includes('relation "SafetyEvent" does not exist') ||
    message.includes('column "stage" of relation "SafetyEvent" does not exist')
  );
}
