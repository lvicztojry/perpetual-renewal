import { getLlmCredentialStatus } from "@/lib/credentials/repository";
import { createRenewalRepository } from "@/lib/renewal/repository";
import type {
  ConversationRecord,
  MemoryRecord,
  MessageRecord,
  ProactiveMessageRecord
} from "@/lib/renewal/types";
import { listSafetyEventsForExport } from "@/lib/safety-events";
import { listModelUsageLogsForExport } from "@/lib/usage";
import { getUserProfile } from "@/lib/users/profile";
import type {
  ExportCompanionSnapshot,
  ExportCredentialSummary,
  UserExportSnapshot
} from "./types";

const EXPORT_LIMIT = 5_000;
const sensitiveKeyNames = new Set([
  "apikey",
  "api_key",
  "authorization",
  "bearer",
  "baseurl",
  "base_url",
  "ciphertext",
  "encryptedapikey",
  "encrypted_api_key",
  "keyauthtag",
  "key_auth_tag",
  "keyiv",
  "key_iv",
  "password",
  "secret",
  "token",
  "vaultciphertext",
  "vault_ciphertext"
]);

const sensitiveStringPatterns: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /postgres(?:ql)?:\/\/[^\s"'<>]+/gi,
    replacement: "[REDACTED_DATABASE_URL]"
  },
  {
    pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replacement: "Bearer [REDACTED]"
  },
  {
    pattern: /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[REDACTED_JWT]"
  },
  {
    pattern: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g,
    replacement: "[REDACTED_KEY]"
  },
  {
    pattern: /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"',;<>]+["']?/gi,
    replacement: "[REDACTED_SECRET]"
  },
  {
    pattern: /https?:\/\/[^\s"'<>]*(?:\/v1|\/v1beta|\/chat\/completions)[^\s"'<>]*/gi,
    replacement: "[REDACTED_PROVIDER_ENDPOINT]"
  }
];

export async function buildUserExportSnapshot(userId: string): Promise<UserExportSnapshot> {
  const repository = createRenewalRepository();
  const [profile, credentialStatus, companions, modelUsageLogs, safetyEvents] = await Promise.all([
    getUserProfile(userId),
    getLlmCredentialStatus(userId),
    repository.listCompanions(userId),
    listModelUsageLogsForExport(userId, EXPORT_LIMIT),
    listSafetyEventsForExport(userId, EXPORT_LIMIT)
  ]);

  const companionSnapshots: ExportCompanionSnapshot[] = [];
  for (const companion of companions) {
    const [conversation, messages, memories, proactiveMessages] = await Promise.all([
      repository.getConversation(userId, companion.conversationId),
      repository.listMessages(userId, companion.conversationId),
      repository.listMemories(userId, companion.id, true),
      repository.listProactiveMessages(userId, companion.id)
    ]);

    companionSnapshots.push({
      ...companion,
      conversation: scrubConversation(conversation),
      messages: messages.map(scrubMessage),
      memories: memories.map(scrubMemory),
      relationshipState: companion.relationshipState,
      proactiveMessages: proactiveMessages.map(scrubProactiveMessage)
    });
  }

  return {
    schemaVersion: "m14-data-export-snapshot:v1",
    exportedAt: new Date().toISOString(),
    userId,
    persistence: {
      renewal: repository.persistence
    },
    profile,
    credentialSummary: {
      llm: toCredentialSummary(credentialStatus)
    },
    companions: companionSnapshots,
    modelUsageLogs: scrubSensitiveValue(modelUsageLogs) as typeof modelUsageLogs,
    safetyEvents: scrubSensitiveValue(safetyEvents) as typeof safetyEvents,
    counts: {
      companions: companionSnapshots.length,
      conversations: companionSnapshots.filter((companion) => companion.conversation).length,
      messages: companionSnapshots.reduce((count, companion) => count + companion.messages.length, 0),
      memories: companionSnapshots.reduce((count, companion) => count + companion.memories.length, 0),
      proactiveMessages: companionSnapshots.reduce(
        (count, companion) => count + companion.proactiveMessages.length,
        0
      ),
      modelUsageLogs: modelUsageLogs.length,
      safetyEvents: safetyEvents.length
    },
    privacy: {
      ownDataOnly: true,
      providerSecretsExcluded: true,
      vaultCiphertextExcluded: true,
      providerEndpointExcluded: true
    }
  };
}

function toCredentialSummary(status: Awaited<ReturnType<typeof getLlmCredentialStatus>>) {
  return {
    configured: status.configured,
    kind: status.kind,
    provider: status.provider,
    model: status.model,
    credentialSource: status.credentialSource,
    updatedAt: status.updatedAt
  } satisfies ExportCredentialSummary;
}

function scrubConversation(conversation: ConversationRecord | null) {
  return conversation ? (scrubSensitiveValue(conversation) as ConversationRecord) : null;
}

function scrubMessage(message: MessageRecord): MessageRecord {
  return {
    ...message,
    metadata: scrubSensitiveRecord(message.metadata)
  };
}

function scrubMemory(memory: MemoryRecord): MemoryRecord {
  return scrubSensitiveValue(memory) as MemoryRecord;
}

function scrubProactiveMessage(message: ProactiveMessageRecord): ProactiveMessageRecord {
  return {
    ...message,
    safety: scrubSensitiveRecord(message.safety)
  };
}

function scrubSensitiveRecord(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  return scrubSensitiveValue(value) as Record<string, unknown>;
}

function scrubSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrubSensitiveValue);
  }

  if (typeof value === "string") {
    return scrubSensitiveString(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      isSensitiveKey(key) ? [] : [[key, scrubSensitiveValue(item)]]
    )
  );
}

function isSensitiveKey(key: string) {
  const normalized = key.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
  return (
    sensitiveKeyNames.has(normalized) ||
    normalized.includes("apikey") ||
    normalized.includes("authorization") ||
    normalized.includes("credential") ||
    normalized.includes("ciphertext") ||
    normalized.includes("password") ||
    normalized.includes("privatekey") ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("baseurl") ||
    normalized.includes("endpointurl")
  );
}

function scrubSensitiveString(value: string) {
  return sensitiveStringPatterns.reduce(
    (text, { pattern, replacement }) => text.replace(pattern, replacement),
    value
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
