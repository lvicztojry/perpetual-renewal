import type { SafetyAction, SafetyCheckStage, SafetyEventType } from "@/lib/relationship";
import { buildSafetyEventHashes, canBuildPersistentSafetyEventHashes } from "./hash";
import { createSafetyEventRepository } from "./repository";
import type {
  CreateSafetyEventInput,
  SafetyEventExportPage,
  SafetyEventLog,
  SafetyEventLogResult
} from "./types";

const makeId = () =>
  `safe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const MAX_EXPORT_EVENTS = 5_000;

export async function recordSafetyEvent(
  input: CreateSafetyEventInput
): Promise<SafetyEventLogResult> {
  if (input.action === "allow") {
    return { logged: false, persistence: "noop" };
  }

  const repository = createSafetyEventRepository();
  if (repository.persistence !== "memory" && !canBuildPersistentSafetyEventHashes()) {
    return {
      logged: false,
      persistence: "noop",
      skippedReason: "missing_persistent_hash_secret"
    };
  }

  const event = normalizeSafetyEvent(input);
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
  const page = await listSafetyEventsExportPage(userId, limit);
  return page.items;
}

export async function listSafetyEventsExportPage(
  userId: string,
  limit = MAX_EXPORT_EVENTS
): Promise<SafetyEventExportPage> {
  const safeLimit = Math.min(MAX_EXPORT_EVENTS, Math.max(1, Math.round(limit)));
  const repository = createSafetyEventRepository();
  const events = await repository.listForExport(userId, safeLimit + 1);
  const truncated = events.length > safeLimit;
  const items = truncated ? events.slice(0, safeLimit) : events;

  return {
    items,
    limit: safeLimit,
    returned: items.length,
    truncated,
    availableAtLeast: truncated ? events.length : items.length
  };
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
