import { createUsageRepository } from "./repository";
import { safeLogValue } from "@/lib/logging/sanitize";
import type { CreateModelUsageLogInput, ModelUsageLog, UsageDashboard } from "./types";

const usageRepository = createUsageRepository();
const MAX_DASHBOARD_LOGS = 2_000;
const MAX_EXPORT_LOGS = 5_000;

export async function recordModelUsage(input: CreateModelUsageLogInput) {
  try {
    return await usageRepository.create(input);
  } catch (error) {
    console.warn("[usage] Failed to record model usage.", safeLogValue(error));
    return null;
  }
}

export async function getUsageDashboard(userId: string, rangeDays = 7): Promise<UsageDashboard> {
  const safeRangeDays = Math.min(90, Math.max(1, Math.round(rangeDays)));
  const since = new Date(Date.now() - safeRangeDays * 24 * 60 * 60 * 1000);
  const logs = await usageRepository.listSince(userId, since, MAX_DASHBOARD_LOGS);

  return {
    persistence: usageRepository.persistence,
    rangeDays: safeRangeDays,
    summary: summarize(logs),
    byProviderModel: summarizeByProviderModel(logs),
    recent: logs.slice(0, 20)
  };
}

export async function listModelUsageLogsForExport(
  userId: string,
  limit = MAX_EXPORT_LOGS
): Promise<ModelUsageLog[]> {
  const safeLimit = Math.min(MAX_EXPORT_LOGS, Math.max(1, Math.round(limit)));
  return usageRepository.listForExport(userId, safeLimit);
}

function summarize(logs: ModelUsageLog[]): UsageDashboard["summary"] {
  const successful = logs.filter((log) => log.status === "success");
  const totalLatency = successful.reduce((sum, log) => sum + (log.latencyMs ?? 0), 0);
  const latencyCount = successful.filter((log) => log.latencyMs !== null).length;

  return {
    calls: logs.length,
    successfulCalls: successful.length,
    failedCalls: logs.length - successful.length,
    inputTokens: sum(logs, "inputTokens"),
    outputTokens: sum(logs, "outputTokens"),
    totalTokens: sum(logs, "totalTokens"),
    estimatedCostUsd: roundUsd(logs.reduce((total, log) => total + log.estimatedCostUsd, 0)),
    averageLatencyMs: latencyCount ? Math.round(totalLatency / latencyCount) : null
  };
}

function summarizeByProviderModel(logs: ModelUsageLog[]): UsageDashboard["byProviderModel"] {
  const grouped = new Map<string, UsageDashboard["byProviderModel"][number]>();

  for (const log of logs) {
    const key = `${log.provider}\u0000${log.model}`;
    const item =
      grouped.get(key) ??
      ({
        provider: log.provider,
        model: log.model,
        calls: 0,
        totalTokens: 0,
        estimatedCostUsd: 0
      } satisfies UsageDashboard["byProviderModel"][number]);

    item.calls += 1;
    item.totalTokens += log.totalTokens ?? 0;
    item.estimatedCostUsd = roundUsd(item.estimatedCostUsd + log.estimatedCostUsd);
    grouped.set(key, item);
  }

  return [...grouped.values()]
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.totalTokens - a.totalTokens)
    .slice(0, 8);
}

function sum(logs: ModelUsageLog[], key: "inputTokens" | "outputTokens" | "totalTokens") {
  return logs.reduce((total, log) => total + (log[key] ?? 0), 0);
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
