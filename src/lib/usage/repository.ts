import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { safeLogValue } from "@/lib/logging/sanitize";
import { redactSensitiveResponseText } from "@/lib/http/response-safety";
import { estimateCostUsd } from "./pricing";
import type { CreateModelUsageLogInput, ModelUsageLog } from "./types";

type UsageRepository = {
  persistence: "prisma" | "memory";
  create(input: CreateModelUsageLogInput): Promise<ModelUsageLog>;
  listSince(userId: string, since: Date, limit: number): Promise<ModelUsageLog[]>;
  listForExport(userId: string, limit: number): Promise<ModelUsageLog[]>;
};

type UsageStore = {
  logs: ModelUsageLog[];
};

declare global {
  var renewalUsageStore: UsageStore | undefined;
}

const databaseUnavailableCodes = new Set(["P1000", "P1001", "P1002", "P1003", "P2021", "P2024"]);
const makeId = () =>
  `usage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createUsageRepository(): UsageRepository {
  const fallback = new InMemoryUsageRepository();
  const isLocalFallbackAllowed = process.env.NODE_ENV !== "production";

  if (
    isLocalFallbackAllowed &&
    (process.env.RENEWAL_REPOSITORY === "memory" || !process.env.DATABASE_URL)
  ) {
    return fallback;
  }

  return new FallbackUsageRepository(new PrismaUsageRepository(), fallback);
}

class FallbackUsageRepository implements UsageRepository {
  persistence: UsageRepository["persistence"] = "prisma";
  private warned = false;

  constructor(
    private readonly primary: UsageRepository,
    private readonly fallback: UsageRepository
  ) {}

  async create(input: CreateModelUsageLogInput) {
    return this.run(
      () => this.primary.create(input),
      () => this.fallback.create(input)
    );
  }

  async listSince(userId: string, since: Date, limit: number) {
    return this.run(
      () => this.primary.listSince(userId, since, limit),
      () => this.fallback.listSince(userId, since, limit)
    );
  }

  async listForExport(userId: string, limit: number) {
    return this.run(
      () => this.primary.listForExport(userId, limit),
      () => this.fallback.listForExport(userId, limit)
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

      if (!this.warned) {
        this.warned = true;
        console.warn(
          "[usage] Prisma usage repository unavailable; falling back to in-memory store.",
          safeLogValue(error)
        );
      }
      this.persistence = "memory";
      return fallback();
    }
  }
}

class InMemoryUsageRepository implements UsageRepository {
  readonly persistence = "memory" as const;

  async create(input: CreateModelUsageLogInput) {
    const log = normalizeCreateInput(input);
    getStore().logs.unshift(log);
    return log;
  }

  async listSince(userId: string, since: Date, limit: number) {
    const sinceTime = since.getTime();
    return getStore()
      .logs.filter((log) => log.userId === userId && new Date(log.createdAt).getTime() >= sinceTime)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listForExport(userId: string, limit: number) {
    return getStore()
      .logs.filter((log) => log.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

class PrismaUsageRepository implements UsageRepository {
  readonly persistence = "prisma" as const;

  async create(input: CreateModelUsageLogInput) {
    const log = normalizeCreateInput(input);

    await prisma.$executeRaw`
      INSERT INTO "ModelUsageLog" (
        "id", "userId", "companionId", "conversationId", "messageId", "purpose",
        "provider", "model", "status", "inputTokens", "outputTokens", "totalTokens",
        "estimatedCostUsd", "latencyMs", "errorKind", "httpStatus", "fallbackReason", "createdAt"
      )
      VALUES (
        ${log.id}, ${log.userId}, ${log.companionId}, ${log.conversationId}, ${log.messageId},
        ${log.purpose}, ${log.provider}, ${log.model}, ${log.status}, ${log.inputTokens},
        ${log.outputTokens}, ${log.totalTokens}, ${log.estimatedCostUsd}, ${log.latencyMs},
        ${log.errorKind}, ${log.httpStatus}, ${log.fallbackReason}, ${new Date(log.createdAt)}
      )
    `;

    return log;
  }

  async listSince(userId: string, since: Date, limit: number) {
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        "id", "userId", "companionId", "conversationId", "messageId", "purpose",
        "provider", "model", "status", "inputTokens", "outputTokens", "totalTokens",
        "estimatedCostUsd", "latencyMs", "errorKind", "httpStatus", "fallbackReason", "createdAt"
      FROM "ModelUsageLog"
      WHERE "userId" = ${userId} AND "createdAt" >= ${since}
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `;

    return rows.map(toModelUsageLog);
  }

  async listForExport(userId: string, limit: number) {
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        "id", "userId", "companionId", "conversationId", "messageId", "purpose",
        "provider", "model", "status", "inputTokens", "outputTokens", "totalTokens",
        "estimatedCostUsd", "latencyMs", "errorKind", "httpStatus", "fallbackReason", "createdAt"
      FROM "ModelUsageLog"
      WHERE "userId" = ${userId}
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `;

    return rows.map(toModelUsageLog);
  }
}

function getStore() {
  globalThis.renewalUsageStore ??= { logs: [] };
  return globalThis.renewalUsageStore;
}

function normalizeCreateInput(input: CreateModelUsageLogInput): ModelUsageLog {
  const inputTokens = normalizeToken(input.usage?.inputTokens);
  const outputTokens = normalizeToken(input.usage?.outputTokens);
  const totalTokens =
    normalizeToken(input.usage?.totalTokens) ??
    (inputTokens !== null || outputTokens !== null ? (inputTokens ?? 0) + (outputTokens ?? 0) : null);

  return {
    id: makeId(),
    userId: input.userId,
    companionId: input.companionId ?? null,
    conversationId: input.conversationId ?? null,
    messageId: input.messageId ?? null,
    purpose: input.purpose,
    provider: input.provider,
    model: input.model?.trim() || "unknown",
    status: input.status,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: input.status === "success" ? estimateCostUsd(input.provider, input.usage) : 0,
    latencyMs: normalizeToken(input.latencyMs),
    errorKind: input.errorKind ?? null,
    httpStatus: normalizeToken(input.httpStatus),
    fallbackReason: redactSensitiveResponseText(input.fallbackReason ?? undefined) ?? null,
    createdAt: new Date().toISOString()
  };
}

function normalizeToken(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function toModelUsageLog(row: Record<string, unknown>): ModelUsageLog {
  return {
    id: String(row.id),
    userId: String(row.userId),
    companionId: nullableString(row.companionId),
    conversationId: nullableString(row.conversationId),
    messageId: nullableString(row.messageId),
    purpose: String(row.purpose) as ModelUsageLog["purpose"],
    provider: String(row.provider),
    model: String(row.model),
    status: String(row.status) as ModelUsageLog["status"],
    inputTokens: nullableNumber(row.inputTokens),
    outputTokens: nullableNumber(row.outputTokens),
    totalTokens: nullableNumber(row.totalTokens),
    estimatedCostUsd: nullableNumber(row.estimatedCostUsd) ?? 0,
    latencyMs: nullableNumber(row.latencyMs),
    errorKind: nullableString(row.errorKind),
    httpStatus: nullableNumber(row.httpStatus),
    fallbackReason: nullableString(row.fallbackReason),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt)
  };
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown) {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return null;
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
    message.includes('relation "ModelUsageLog" does not exist')
  );
}
