export type RelationshipKind =
  | "REAL_PERSON_SUBSTITUTE"
  | "MEMORIAL"
  | "EX_PARTNER"
  | "LOVER"
  | "FRIEND"
  | "FAMILY"
  | "MENTOR"
  | "PUBLIC_FIGURE_IMAGINED"
  | "FICTIONAL_CHARACTER"
  | "ORIGINAL_CHARACTER"
  | "CUSTOM";

export type RelationshipTone = "daily" | "tender" | "playful" | "concerned" | "boundary";

export type CompanionProfile = {
  id: string;
  name: string;
  relationshipKind: RelationshipKind;
  customKind?: string;
  userAddress?: string;
  companionAddress?: string;
  personality: string[];
  speakingStyle: string;
  background?: string;
  boundaries?: string;
  immersionEnabled: boolean;
};

export type ImportantEvent = {
  id: string;
  title: string;
  date?: string;
  source?: string;
  explanation: string;
};

export type RelationshipStateSnapshot = {
  companionId: string;
  familiarityScore: number;
  closenessScore: number;
  recentEmotion?: string;
  importantEvents: ImportantEvent[];
  lastInteractionAt?: string;
  explanation: string;
};

export type RelationshipSignal = {
  userMessage: string;
  assistantMessage?: string;
  sourceMessageId?: string;
  createdAt?: string;
};

export type RelationshipStateUpdate = {
  state: RelationshipStateSnapshot;
  changes: {
    familiarityDelta: number;
    closenessDelta: number;
    recentEmotion?: string;
    importantEventsAdded: ImportantEvent[];
    explanation: string;
    signalsUsed: string[];
  };
};

export type ProactiveMessageKind =
  | "DAILY_GREETING"
  | "LAST_CONVERSATION_FOLLOWUP"
  | "ANNIVERSARY"
  | "EMOTION_CARE"
  | "PLAYFUL_MISS_YOU";

export type ProactiveMessageDraft = {
  id: string;
  companionId: string;
  kind: ProactiveMessageKind;
  content: string;
  reason: string;
  scheduledAt?: string;
  nextCandidateAt?: string;
  frequency?: {
    preset: string;
    everyMinutes: number;
    label: string;
  };
  safety: SafetyCheckResult;
  preflightSafety?: SafetyCheckResult;
  postflightSafety?: SafetyCheckResult;
};

export type SafetyEventType =
  | "SELF_HARM"
  | "HARM_TO_OTHERS"
  | "COERCIVE_ATTACHMENT"
  | "REAL_WORLD_COMMITMENT"
  | "MONEY_OR_LEGAL_IDENTITY"
  | "PUBLIC_FIGURE_AUTHORIZATION"
  | "MINOR_SEXUAL_CONTENT"
  | "PRIVACY_VIOLATION"
  | "PROFESSIONAL_ADVICE"
  | "IDENTITY_DECEPTION"
  | "RELATIONAL_PRESSURE"
  | "SAFETY_OVERRIDE"
  | "NONE";

export type SafetyAction = "allow" | "revise" | "block" | "boundary_response";

export type SafetyCheckStage =
  | "user_input"
  | "assistant_output"
  | "proactive_context"
  | "proactive_draft";

export type SafetyCheckResult = {
  ok: boolean;
  type: SafetyEventType;
  action: SafetyAction;
  stage?: SafetyCheckStage;
  severity?: "none" | "low" | "medium" | "high" | "critical";
  reason: string;
  revisedText?: string;
};
