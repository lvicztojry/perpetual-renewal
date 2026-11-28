import type { MemoryCandidate, MemoryType } from "./types";

export type ExtractMemoryCandidatesInput = {
  content: string;
  sourceMessageId?: string;
};

const candidateLabels: Record<MemoryType, string> = { USER_FACT: "用户事实：", EMOTIONAL_PREFERENCE: "情绪或互动偏好：", RELATIONSHIP_EVENT: "关系事件：", COMPANION_PROFILE: "人物设定：" };
const MAX_CANDIDATE_CHARS = 500;

const userFactPatterns = [
  /我(?:叫|是|住在|来自|在.+工作|在.+上学|的生日是|生日是|家在|职业是|工作是)/,
  /my name is|i am from|i live in|i work (?:at|as)|my birthday is/i,
  /我(?:已经|刚刚|刚|现在|目前|不再|曾经|以前)?(?:入职|离职|毕业|搬到|搬家|退休|开始|结束)/
];

const emotionalPreferencePatterns = [
  /我(?:喜欢|爱|偏好|更喜欢|讨厌|不喜欢|害怕|希望你|不希望你|需要你|别|不要)/,
  /i (?:like|love|prefer|hate|dislike|need|want you to|do not want|don't want)/i,
  /我(?:现在|以前|曾经|目前|已经|最近|不再|已经不再)(?:喜欢|爱|偏好|讨厌|害怕)/
];

const relationshipEventPatterns = [
  /(?:第一次|约定|纪念日|生日|见面|分开|离开|去世|想见|见不到|今天|昨天|明天|上次|下次)/,
  /(?:first time|promise|anniversary|birthday|met|left|passed away|miss|last time|next time)/i
];

export function extractMemoryCandidates({
  content,
  sourceMessageId
}: ExtractMemoryCandidatesInput): MemoryCandidate[] {
  const normalized = content.trim().replace(/[ \t\r]+/g, " ");
  if (normalized.length < 4) return [];
  if (/^(?:(?:以下|下面)(?:是|为).{0,12}(?:台词|小说|引用|例子)|小说里|故事里|(?:请|帮我)?(?:翻译|续写|改写)|(?:translate|quote|fiction|example)\s*:)/iu.test(normalized)) return [];
  // Mask quoted spans BEFORE splitting. Keep UTF-16 offsets and punctuation so
  // multiple sentences inside a quotation never become first-person self facts.
  const evidence = normalized.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/gu,
    quoted => quoted.replace(/[^。！？!?；;\n]/g, " "));

  const candidates: MemoryCandidate[] = [];
  for (const match of normalized.matchAll(/[^。！？!?；;\n]+(?:[。！？!?；;\n]|$)/gu)) {
    if (/[?？]\s*$/.test(match[0])) continue;
    const segment = match[0].replace(/[。！？!?；;\n]$/, "").trim();
    const eligible = evidence.slice(match.index, match.index + match[0].length).trim();
    if (segment.length < 4 || !eligible || /如果|假如|假设|要是|倘若|\b(?:if|suppose|imagine)\b/iu.test(eligible) ||
      /^(?:(?:我(?:的)?)?(?:他|她|朋友|同事|妈妈|爸爸|老师)(?:刚刚|刚|曾经)?(?:说|表示|提到|告诉)|(?:he|she|they|my friend)\s+(?:said|says)\b)/iu.test(eligible)) continue;
    addCandidate(candidates, segment, "USER_FACT", userFactPatterns, sourceMessageId, eligible);
    addCandidate(
      candidates,
      segment,
      "EMOTIONAL_PREFERENCE",
      emotionalPreferencePatterns,
      sourceMessageId,
      eligible
    );
    addCandidate(
      candidates,
      segment,
      "RELATIONSHIP_EVENT",
      relationshipEventPatterns,
      sourceMessageId,
      eligible
    );
  }

  return dedupeCandidates(candidates);
}

function addCandidate(
  candidates: MemoryCandidate[],
  content: string,
  type: MemoryType,
  patterns: RegExp[],
  sourceMessageId?: string,
  evidence = content
) {
  if (!patterns.some((pattern) => pattern.test(evidence))) return;
  const label = candidateLabels[type];
  if (label.length + content.length > MAX_CANDIDATE_CHARS) return;

  candidates.push({
    sourceMessageId,
    type,
    status: "PENDING",
    content: label + content,
    confidence: confidenceFor(type, content)
  });
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
