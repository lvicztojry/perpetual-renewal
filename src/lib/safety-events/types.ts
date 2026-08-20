import type { SafetyAction, SafetyCheckStage, SafetyEventType } from "@/lib/relationship";

export type SafetyEventSeverity = "none" | "low" | "medium" | "high" | "critical";

export type CreateSafetyEventInput = {
  userId: string;
  companionId?: string | null;
  messageId?: string | null;
  type: SafetyEventType;
  action: SafetyAction;
  stage?: SafetyCheckStage;
  severity?: SafetyEventSeverity;
  content: string;
};

export type SafetyEventLog = {
  id: string;
  userId: string;
  companionId: string | null;
  messageId: string | null;
  type: Exclude<SafetyEventType, "NONE"> | "OTHER";
  action: Exclude<SafetyAction, "allow">;
  stage: SafetyCheckStage;
  severity: Exclude<SafetyEventSeverity, "none">;
  contentHash: string;
  riskHash: string;
  createdAt: string;
};

export type SafetyEventLogResult = {
  logged: boolean;
  persistence: "prisma" | "memory" | "noop";
  event?: Pick<
    SafetyEventLog,
    "id" | "type" | "action" | "stage" | "severity" | "contentHash" | "riskHash" | "createdAt"
  >;
};
