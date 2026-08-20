import type { LlmMessage } from "@/lib/llm/types";

export type PromptMemoryStatus = "pending" | "active" | "archived" | "deleted";

export type PromptMemoryType =
  | "user_fact"
  | "relationship_event"
  | "companion_profile"
  | "emotional_preference";

export type PromptCompanionProfile = {
  name: string;
  relationshipKind: string;
  customRelationship?: string | null;
  userAddress?: string | null;
  companionAddress?: string | null;
  personality?: string[];
  speakingStyle?: string | null;
  background?: string | null;
  boundaries?: string | null;
  immersionEnabled?: boolean;
};

export type PromptUserProfile = {
  nickname?: string | null;
  timezone?: string | null;
  language?: string | null;
  communicationPreference?: string | null;
};

export type PromptMemory = {
  type: PromptMemoryType | string;
  content: string;
  status: PromptMemoryStatus | string;
  confidence?: number | null;
  importance?: number | null;
  important?: boolean | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type PromptRecentMessage = LlmMessage & {
  id?: string;
  createdAt?: Date | string | null;
  metadata?: Record<string, unknown> | null;
};

export type PromptRelationshipState = {
  familiarityScore?: number | null;
  closenessScore?: number | null;
  recentEmotion?: string | null;
  importantEvents?: string[] | null;
  lastInteractionAt?: Date | string | null;
  explanation?: string | null;
};

export type BuildPromptInput = {
  companion: PromptCompanionProfile;
  user?: PromptUserProfile;
  userBoundaries?: string[];
  memories?: PromptMemory[];
  relationshipState?: PromptRelationshipState | null;
  recentMessages?: PromptRecentMessage[];
  highRiskRules?: string[];
  contextBudget?: Partial<PromptContextBudget>;
};

export type BuiltPrompt = {
  messages: LlmMessage[];
  activeMemoryCount: number;
  contextStats: PromptContextStats;
};

export type PromptContextBudget = {
  maxActiveMemories: number;
  maxMemoryChars: number;
  maxSingleMemoryChars: number;
  maxRecentMessages: number;
  maxMessageChars: number;
  maxSingleMessageChars: number;
};

export type PromptContextStats = {
  budget: PromptContextBudget;
  protectedSystemChars: number;
  totalPromptChars: number;
  activeMemories: {
    available: number;
    selected: number;
    dropped: number;
    inactiveExcluded: number;
    truncated: number;
    estimatedChars: number;
  };
  recentMessages: {
    available: number;
    selected: number;
    dropped: number;
    systemExcluded: number;
    truncated: number;
    estimatedChars: number;
  };
};
