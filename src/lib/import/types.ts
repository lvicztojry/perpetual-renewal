import type { MemoryType } from "@/lib/renewal/types";

export const textImportSourceKinds = ["material", "tone_sample", "memory_candidate"] as const;

export type TextImportSourceKind = (typeof textImportSourceKinds)[number];

export type TextImportCandidate = {
  sourceKind: TextImportSourceKind;
  sourceIndex: number;
  type: MemoryType;
  content: string;
  confidence: number;
};

export type TextImportPlan = {
  candidates: TextImportCandidate[];
  redactionCount: number;
  skippedCount: number;
};

export type BatchTextImportItem = {
  text: string;
  sourceKind?: TextImportSourceKind;
};

export type BatchTextImportPlan = TextImportPlan & {
  inputCount: number;
  acceptedCount: number;
  truncatedCount: number;
  limit: {
    maxItems: number;
    maxItemChars: number;
    maxCandidates: number;
  };
};
