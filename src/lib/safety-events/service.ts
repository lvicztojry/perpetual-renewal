import type { SafetyAction, SafetyCheckStage, SafetyEventType } from "@/lib/relationship";
import { buildSafetyEventHashes } from "./hash";
import { createSafetyEventRepository } from "./repository";
import type { CreateSafetyEventInput, SafetyEventLog, SafetyEventLogResult } from "./types";

const makeId = () =>
  `safe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const MAX_EXPORT_EVENTS = 5_000;

export async function recordSafetyEvent(
  input: CreateSafetyEventInput
): Promise<SafetyEventLogResult> {
  if (input.action === "allow") {
    return { logged: false, persistence: "noop" };
  }

  const event = normalizeSafetyEvent(input);
  const repository = createSafetyEventRepository();
  const created = await repository.create(event);

  return {
    logged: true,
    persistence: repository.persistence,
    event: {
      id: created.id,
      type: created.type,
      action: created.action,
      stage: created.stage,
      severity: created.severity,
      contentHash: created.contentHash,
      riskHash: created.riskHash,
      createdAt: created.createdAt
    }
  };
}

export async function listSafetyEventsForExport(userId: string, limit = MAX_EXPORT_EVENTS) {
  const safeLimit = Math.min(MAX_EXPORT_EVENTS, Math.max(1, Math.round(limit)));
  const repository = createSafetyEventRepository();
  return repository.listForExport(userId, safeLimit);
}

function normalizeSafetyEvent(input: CreateSafetyEventInput): SafetyEventLog {
  const type = normalizeType(input.type);
  const action = normalizeAction(input.action);
  const stage = normalizeStage(input.stage);
  const severity = normalizeSeverity(input.severity);
  const hashes = buildSafetyEventHashes({
    userId: input.userId,
    type,
    action,
    stage,
    severity,
    content: input.content
  });

  return {
    id: makeId(),
    userId: input.userId,
    companionId: input.companionId ?? null,
    messageId: input.messageId ?? null,
    type,
    action,
    stage,
    severity,
    contentHash: hashes.contentHash,
    riskHash: hashes.riskHash,
    createdAt: new Date().toISOString()
  };
}

function normalizeType(type: SafetyEventType): SafetyEventLog["type"] {
  return type === "NONE" ? "OTHER" : type;
}

function normalizeAction(action: SafetyAction): SafetyEventLog["action"] {
  return action === "allow" ? "revise" : action;
}

function normalizeStage(stage: SafetyCheckStage | undefined): SafetyCheckStage {
  return stage ?? "user_input";
}

function normalizeSeverity(
  severity: CreateSafetyEventInput["severity"]
): SafetyEventLog["severity"] {
  if (!severity || severity === "none") return "medium";
  return severity;
}
