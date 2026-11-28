import type { ProviderCredentialStatus } from "@/lib/credentials/types";
import type { SafetyEventLog } from "@/lib/safety-events";
import type { ModelUsageLog } from "@/lib/usage";
import type {
  CompanionRecord,
  ConversationRecord,
  MemoryRecord,
  MessageRecord,
  ProactiveMessageRecord,
  RelationshipStateRecord,
  RepositoryPersistence
} from "@/lib/renewal/types";
import type { UserProfile } from "@/lib/users/profile";
import type { DreamState } from "@/lib/dream/types";
import type { GroupState } from "@/lib/groups/types";
import type { MemoryRevisionRecord } from "@/lib/memory/lifecycle";

export type ExportCollectionLimit = {
  limit: number;
  returned: number;
  truncated: boolean;
  availableAtLeast: number;
};

export type ExportCredentialSummary = Pick<
  ProviderCredentialStatus,
  "configured" | "kind" | "provider" | "model" | "credentialSource" | "updatedAt"
>;

export type ExportCompanionSnapshot = CompanionRecord & {
  conversation: ConversationRecord | null;
  messages: MessageRecord[];
  memories: MemoryRecord[];
  relationshipState: RelationshipStateRecord;
  proactiveMessages: ProactiveMessageRecord[];
};

export type UserExportSnapshot = {
  schemaVersion: "m14-data-export-snapshot:v1";
  exportedAt: string;
  userId: string;
  persistence: {
    renewal: RepositoryPersistence;
  };
  profile: UserProfile;
  credentialSummary: {
    llm: ExportCredentialSummary;
  };
  companions: ExportCompanionSnapshot[];
  dreamWorkspaces: DreamState[];
  journey: Pick<import("@/lib/journey/types").JourneyState, "version" | "step" | "status" | "companionId" | "revision" | "courses">;
  groups: GroupState[];
  memoryRevisions: MemoryRevisionRecord[];
  messageReadReceipts: Array<{ scope: "private" | "group"; threadId: string; messageId: string }>;
  modelUsageLogs: ModelUsageLog[];
  safetyEvents: SafetyEventLog[];
  counts: {
    companions: number;
    conversations: number;
    messages: number;
    memories: number;
    proactiveMessages: number;
    modelUsageLogs: number;
    safetyEvents: number;
  };
  limits: {
    modelUsageLogs: ExportCollectionLimit;
    safetyEvents: ExportCollectionLimit;
  };
  privacy: {
    ownDataOnly: true;
    providerSecretsExcluded: true;
    vaultCiphertextExcluded: true;
    providerEndpointExcluded: true;
  };
};
