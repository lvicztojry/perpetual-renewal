import type { RelationshipKind } from "@/lib/renewal/types";

export type CharacterDraft = {
  name: string;
  relationshipKind: RelationshipKind;
  customKind: string;
  userAddress: string;
  personality: string[];
  speakingStyle: string;
  background: string;
  toneExamples: string[];
  sharedMemories: string[];
};

export type CharacterImportAnalysis = {
  draft: CharacterDraft;
  source: "model" | "local";
  warnings: string[];
  stats: { totalMessages: number; sampledMessages: number };
};

export type CharacterPreviewMessage = { role: "user" | "assistant"; content: string };
