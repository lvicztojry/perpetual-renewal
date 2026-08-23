import { getLlmCredentialStatus } from "@/lib/credentials/repository";
import { createRenewalRepository } from "@/lib/renewal/repository";
import type {
  ConversationRecord,
  MemoryRecord,
  MessageRecord,
  ProactiveMessageRecord,
  RelationshipStateRecord
} from "@/lib/renewal/types";
import { listSafetyEventsExportPage } from "@/lib/safety-events";
import { listModelUsageLogsExportPage } from "@/lib/usage";
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
    pattern: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
    replacement: "[REDACTED_KEY]"
  },
  {
    pattern: /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"',;<>]+["']?/gi,
    replacement: "[REDACTED_SECRET]"
  },
  {
    pattern: /\b(?:prompt|rawPayload|raw_payload|stack)\s*[:=]\s*["']?[^\s"',;<>]+["']?/gi,
    replacement: "[REDACTED_DEBUG_FIELD]"
  },
  {
    pattern: /\bat\s+[A-Za-z0-9_.$<>]+\s*\([^)"']+\)/g,
    replacement: "[REDACTED_STACK]"
  },
  {
    pattern: /https?:\/\/[^\s"'<>]*(?:\/v1|\/v1beta|\/chat\/completions)[^\s"'<>]*/gi,
    replacement: "[REDACTED_PROVIDER_ENDPOINT]"
  },
  {
    pattern: /https?:\/\/[^\s"'<>]*(?:gateway|provider|tryanotherone|openai|anthropic|gemini|api\.)[^\s"'<>]*/gi,
    replacement: "[REDACTED_PROVIDER_ENDPOINT]"
  }
];

export async function buildUserExportSnapshot(userId: string): Promise<UserExportSnapshot> {
  const repository = createRenewalRepository();
  const [profile, credentialStatus, companions, modelUsagePage, safetyEventPage] = await Promise.all([
    getUserProfile(userId),
    getLlmCredentialStatus(userId),
    repository.listCompanions(userId),
    listModelUsageLogsExportPage(userId, EXPORT_LIMIT),
    listSafetyEventsExportPage(userId, EXPORT_LIMIT)
  ]);
  const modelUsageLogs = modelUsagePage.items;
  const safetyEvents = safetyEventPage.items;

  const companionSnapshots: ExportCompanionSnapshot[] = [];
  for (const companion of companions) {
    const [conversation, messages, memories, proactiveMessages] = await Promise.all([
      repository.getConversation(userId, companion.conversationId),
      repository.listMessages(userId, companion.conversationId),
      repository.listMemories(userId, companion.id),
      repository.listProactiveMessages(userId, companion.id)
    ]);

    companionSnapshots.push(scrubSensitiveValue({
      ...companion,
      conversation: scrubConversation(conversation),
      messages: messages.map(scrubMessage),
      memories: memories.map(scrubMemory),
      relationshipState: scrubRelationshipState(companion.relationshipState),
      proactiveMessages: proactiveMessages.map(scrubProactiveMessage)
    }) as ExportCompanionSnapshot);
  }

  return {
    schemaVersion: "m14-data-export-snapshot:v1",
    exportedAt: new Date().toISOString(),
    userId,
    persistence: {
      renewal: repository.persistence
    },
    profile: scrubSensitiveValue(profile) as typeof profile,
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
    limits: {
      modelUsageLogs: toCollectionLimit(modelUsagePage),
      safetyEvents: toCollectionLimit(safetyEventPage)
    },
    privacy: {
      ownDataOnly: true,
      providerSecretsExcluded: true,
      vaultCiphertextExcluded: true,
      providerEndpointExcluded: true
    }
  };
}

function toCollectionLimit(page: {
  limit: number;
  returned: number;
  truncated: boolean;
  availableAtLeast: number;
}) {
  return {
    limit: page.limit,
    returned: page.returned,
    truncated: page.truncated,
    availableAtLeast: page.availableAtLeast
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
  return scrubSensitiveValue(message) as MessageRecord;
}

function scrubMemory(memory: MemoryRecord): MemoryRecord {
  return scrubSensitiveValue(memory) as MemoryRecord;
}

function scrubProactiveMessage(message: ProactiveMessageRecord): ProactiveMessageRecord {
  return scrubSensitiveValue(message) as ProactiveMessageRecord;
}

function scrubRelationshipState(state: RelationshipStateRecord): RelationshipStateRecord {
  return scrubSensitiveValue(state) as RelationshipStateRecord;
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
