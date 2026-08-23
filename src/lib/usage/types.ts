import type { LlmProviderErrorKind, LlmProviderName, LlmTokenUsage } from "@/lib/llm/types";

export type ModelUsageStatus = "success" | "error";

export type ModelUsagePurpose =
  | "chat_reply"
  | "chat_regenerate"
  | "chat_complete_api"
  | "proactive_draft"
  | "safety_check"
  | "other";

export type ModelUsageLog = {
  id: string;
  userId: string;
  companionId: string | null;
  conversationId: string | null;
  messageId: string | null;
  purpose: ModelUsagePurpose;
  provider: LlmProviderName | string;
  model: string;
  status: ModelUsageStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number;
  latencyMs: number | null;
  errorKind: LlmProviderErrorKind | string | null;
  httpStatus: number | null;
  fallbackReason: string | null;
  createdAt: string;
};

export type CreateModelUsageLogInput = {
  userId: string;
  companionId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  purpose: ModelUsagePurpose;
  provider: LlmProviderName | string;
  model?: string | null;
  status: ModelUsageStatus;
  usage?: LlmTokenUsage;
  latencyMs?: number | null;
  errorKind?: LlmProviderErrorKind | string | null;
  httpStatus?: number | null;
  fallbackReason?: string | null;
};

export type UsageDashboard = {
  persistence: "prisma" | "memory";
  rangeDays: number;
  summary: {
    calls: number;
    successfulCalls: number;
    failedCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    averageLatencyMs: number | null;
  };
  byProviderModel: Array<{
    provider: string;
    model: string;
    calls: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>;
  recent: ModelUsageLog[];
};

export type ModelUsageExportPage = {
  items: ModelUsageLog[];
  limit: number;
  returned: number;
  truncated: boolean;
  availableAtLeast: number;
};
