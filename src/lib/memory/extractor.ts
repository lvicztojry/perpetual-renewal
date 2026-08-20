import type { MemoryCandidate, MemoryType } from "./types";

export type ExtractMemoryCandidatesInput = {
  content: string;
  sourceMessageId?: string;
};

const userFactPatterns = [
  /我(?:叫|是|住在|来自|在.+工作|在.+上学|的生日是|生日是|家在|职业是|工作是)/,
  /my name is|i am from|i live in|i work (?:at|as)|my birthday is/i
];

const emotionalPreferencePatterns = [
  /我(?:喜欢|爱|偏好|更喜欢|讨厌|不喜欢|害怕|希望你|不希望你|需要你|别|不要)/,
  /i (?:like|love|prefer|hate|dislike|need|want you to|do not want|don't want)/i
];

const relationshipEventPatterns = [
  /(?:第一次|约定|纪念日|生日|见面|分开|离开|去世|想见|见不到|今天|昨天|明天|上次|下次)/,
  /(?:first time|promise|anniversary|birthday|met|left|passed away|miss|last time|next time)/i
];

export function extractMemoryCandidates({
  content,
  sourceMessageId
}: ExtractMemoryCandidatesInput): MemoryCandidate[] {
  const normalized = content.trim().replace(/\s+/g, " ");
  if (normalized.length < 4) return [];

  const candidates: MemoryCandidate[] = [];
  for (const segment of splitMemorySegments(normalized)) {
    addCandidate(candidates, segment, "USER_FACT", userFactPatterns, sourceMessageId);
    addCandidate(
      candidates,
      segment,
      "EMOTIONAL_PREFERENCE",
      emotionalPreferencePatterns,
      sourceMessageId
    );
    addCandidate(
      candidates,
      segment,
      "RELATIONSHIP_EVENT",
      relationshipEventPatterns,
      sourceMessageId
    );
  }

  return dedupeCandidates(candidates);
}

function splitMemorySegments(content: string) {
  const segments = content
    .split(/[。！？!?；;\n]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 4);

  return segments.length ? segments : [content];
}

function addCandidate(
  candidates: MemoryCandidate[],
  content: string,
  type: MemoryType,
  patterns: RegExp[],
  sourceMessageId?: string
) {
  if (!patterns.some((pattern) => pattern.test(content))) return;

  candidates.push({
    sourceMessageId,
    type,
    status: "PENDING",
    content: summarizeCandidate(content, type),
    confidence: confidenceFor(type, content)
  });
}

function summarizeCandidate(content: string, type: MemoryType) {
  const clipped = content.length > 96 ? `${content.slice(0, 96)}...` : content;

  if (type === "USER_FACT") return `用户事实：${clipped}`;
  if (type === "EMOTIONAL_PREFERENCE") return `情绪或互动偏好：${clipped}`;
  return `关系事件：${clipped}`;
}

function confidenceFor(type: MemoryType, content: string) {
  const explicitSignal = /我(?:叫|是|喜欢|讨厌|生日是|希望你|不希望你)|my name is|i like|i prefer/i.test(
    content
  );
  if (explicitSignal) return type === "RELATIONSHIP_EVENT" ? 0.68 : 0.74;
  return type === "RELATIONSHIP_EVENT" ? 0.62 : 0.58;
}

function dedupeCandidates(candidates: MemoryCandidate[]) {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = `${candidate.type}:${candidate.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
