import type { CompanionProfile } from "@/lib/renewal/types";

export type DreamProfile = { personality: string[]; speakingStyle: string };
export type DreamScope = "always" | "context" | "occasional";
export type DreamFragment = {
  id: string; roundId: string; text: string; scope: DreamScope;
  origin: "user" | "model"; confirmed: boolean;
};
export type DreamRound = {
  id: string; message: string; mode: "compare" | "free";
  choices: Array<{ id: string; content: string }>;
  source: "local" | "model"; createdAt: string;
  feedback?: { choiceId?: string; correction?: string; scope: DreamScope };
};
export type DreamVersion = {
  id: string; profile: DreamProfile; createdAt: string; kind: "initial" | "apply" | "restore";
};
export type DreamState = {
  id: string; companionId: string; revision: number; status: "draft" | "applied" | "discarded";
  baseCompanionUpdatedAt: string; draftProfile: DreamProfile;
  fragments: DreamFragment[]; rounds: DreamRound[]; versions: DreamVersion[];
  /** Exactly what apply persists, including confirmed fragments with their scope. */
  previewProfile: DreamProfile; updatedAt: string;
};
export type DreamAction =
  | { action: "start" }
  | { action: "generate"; revision: number; message: string; mode: "compare" | "free" }
  | { action: "feedback"; revision: number; roundId: string; choiceId?: string; correction?: string; scope: DreamScope }
  /** Full list: omit to delete; existing IDs only; edited text becomes user origin. */
  | { action: "edit"; revision: number; draftProfile: DreamProfile; fragments: DreamFragment[] }
  | { action: "apply"; revision: number }
  | { action: "discard"; revision: number }
  | { action: "rebase"; revision: number; expectedCompanionUpdatedAt: string }
  | { action: "restore"; revision: number; versionId: string };
export type DreamGetResponse = { companion: CompanionProfile; state: DreamState | null };
export type DreamPostResponse = { state: DreamState; companion?: CompanionProfile; source?: "local" | "model" };
