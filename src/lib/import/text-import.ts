import type { MemoryType } from "@/lib/renewal/types";
import {
  type BatchTextImportItem,
  type BatchTextImportPlan,
  textImportSourceKinds,
  type TextImportPlan,
  type TextImportSourceKind
} from "./types";

const MAX_IMPORT_CHARS = 12_000;
const MAX_BATCH_ITEMS = 25;
const MAX_BATCH_ITEM_CHARS = 1_200;
const MAX_CANDIDATES = 12;
const MIN_SEGMENT_CHARS = 6;
const MAX_SEGMENT_CHARS = 420;

const secretPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/gi,
  /\b(sk|pk|rk|xox[baprs]|gh[pousr])_[A-Za-z0-9_=-]{12,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g,
  /\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s,;，。]{8,}/gi
];

export function createTextImportPlan(input: {
  text: string;
  sourceKind?: string | null;
}): TextImportPlan {
  const sourceKind = normalizeSourceKind(input.sourceKind);
  const limitedText = input.text.trim().slice(0, MAX_IMPORT_CHARS);
  const { text: sanitizedText, redactionCount } = redactSecrets(limitedText);
  const segments = splitText(sanitizedText);
  let skippedCount = 0;

  const candidates = segments
    .map((segment, index) => {
      const content = normalizeSegment(segment);
      if (content.length < MIN_SEGMENT_CHARS || content === "[已移除疑似密钥]") {
        skippedCount += 1;
        return null;
      }

      return {
        sourceKind,
        sourceIndex: index,
        type: memoryTypeForSource(sourceKind),
        content: formatImportedMemory(content, sourceKind),
        confidence: confidenceForSource(sourceKind)
      };
    })
    .filter((candidate) => candidate !== null)
    .slice(0, MAX_CANDIDATES);

  skippedCount += Math.max(0, segments.length - candidates.length);

  return {
    candidates,
    redactionCount,
    skippedCount
  };
}

export function createBatchTextImportPlan(input: {
  items: BatchTextImportItem[];
  defaultSourceKind?: string | null;
}): BatchTextImportPlan {
  const defaultSourceKind = normalizeSourceKind(input.defaultSourceKind);
  const acceptedItems = input.items.slice(0, MAX_BATCH_ITEMS);
  let redactionCount = 0;
  let skippedCount = Math.max(0, input.items.length - acceptedItems.length);
  let truncatedCount = 0;

  const candidates = acceptedItems.flatMap((item, itemIndex) => {
    const rawText = item.text.trim();
    if (!rawText) {
      skippedCount += 1;
      return [];
    }

    const limitedText = rawText.slice(0, MAX_BATCH_ITEM_CHARS);
    if (rawText.length > limitedText.length) {
      truncatedCount += 1;
    }

    const plan = createTextImportPlan({
      text: limitedText,
      sourceKind: item.sourceKind ?? defaultSourceKind
    });

    redactionCount += plan.redactionCount;
    skippedCount += plan.skippedCount;

    return plan.candidates.map((candidate) => ({
      ...candidate,
      sourceIndex: itemIndex
    }));
  });

  const limitedCandidates = candidates.slice(0, MAX_CANDIDATES);
  skippedCount += Math.max(0, candidates.length - limitedCandidates.length);

  return {
    candidates: limitedCandidates,
    redactionCount,
    skippedCount,
    inputCount: input.items.length,
    acceptedCount: acceptedItems.length,
    truncatedCount,
    limit: {
      maxItems: MAX_BATCH_ITEMS,
      maxItemChars: MAX_BATCH_ITEM_CHARS,
      maxCandidates: MAX_CANDIDATES
    }
  };
}

export function parseJsonLinesImport(text: string): {
  items: BatchTextImportItem[];
  skippedCount: number;
} {
  const items: BatchTextImportItem[] = [];
  let skippedCount = 0;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const item = normalizeJsonLineItem(parsed);
      if (item) {
        items.push(item);
      } else {
        skippedCount += 1;
      }
    } catch {
      skippedCount += 1;
    }
  }

  return { items, skippedCount };
}

function normalizeSourceKind(value: string | null | undefined): TextImportSourceKind {
  const normalized = value?.trim();
  if (normalized && textImportSourceKinds.includes(normalized as TextImportSourceKind)) {
    return normalized as TextImportSourceKind;
  }

  return "memory_candidate";
}

function normalizeJsonLineItem(value: unknown): BatchTextImportItem | null {
  if (typeof value === "string") {
    return value.trim() ? { text: value } : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const text = readImportText(record.text) ?? readImportText(record.content) ?? readImportText(record.message);
  if (!text) return null;

  const sourceKind = normalizeOptionalSourceKind(record.sourceKind);
  return sourceKind ? { text, sourceKind } : { text };
}

function normalizeOptionalSourceKind(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return textImportSourceKinds.includes(normalized as TextImportSourceKind)
    ? (normalized as TextImportSourceKind)
    : undefined;
}

function readImportText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function redactSecrets(text: string) {
  let redactionCount = 0;
  let redacted = text;

  for (const pattern of secretPatterns) {
    redacted = redacted.replace(pattern, () => {
      redactionCount += 1;
      return "[已移除疑似密钥]";
    });
  }

  return {
    text: redacted,
    redactionCount
  };
}

function splitText(text: string) {
  const lines = text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const chunks = lines.length > 1 ? lines : text.split(/[。！？!?；;]/);
  return chunks
    .flatMap((chunk) => chunkText(chunk.trim(), MAX_SEGMENT_CHARS))
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function chunkText(text: string, maxLength: number) {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += maxLength) {
    chunks.push(text.slice(start, start + maxLength));
  }

  return chunks;
}

function normalizeSegment(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function memoryTypeForSource(sourceKind: TextImportSourceKind): MemoryType {
  if (sourceKind === "tone_sample") return "emotional_preference";
  if (sourceKind === "material") return "relationship_event";
  return "user_fact";
}

function confidenceForSource(sourceKind: TextImportSourceKind) {
  if (sourceKind === "tone_sample") return 0.72;
  if (sourceKind === "material") return 0.68;
  return 0.76;
}

function formatImportedMemory(content: string, sourceKind: TextImportSourceKind) {
  const labels: Record<TextImportSourceKind, string> = {
    material: "导入素材",
    tone_sample: "导入语气样例",
    memory_candidate: "导入记忆候选"
  };

  return `${labels[sourceKind]}：${content}`;
}
