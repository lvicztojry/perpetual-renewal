import { listGroupsForExport } from "@/lib/groups/repository";
import { redactSensitiveResponseText } from "@/lib/http/response-safety";

export type GroupMemoryPrivateContext = { groupId: string; groupName: string; content: string; createdAt: string; sourceMessageIds: string[] };

function terms(value: string) {
  const result = new Set<string>();
  for (const part of value.normalize("NFKC").toLowerCase().match(/[\p{Script=Han}]+|[\p{Script=Latin}\p{N}]+/gu) ?? []) {
    if (/^\p{Script=Han}+$/u.test(part)) {
      const chars = Array.from(part);
      for (let i = 0; i + 1 < chars.length; i++) result.add(chars[i] + chars[i + 1]);
      if (chars.length === 1) result.add(part);
    } else if (part.length > 1 && !/^(the|and|about|remember|please|you|your|this|that|does|what|when)$/.test(part)) result.add(part);
  }
  return result;
}
function relevance(text: string, query: Set<string>) {
  const words = terms(text);
  return [...query].filter(word => words.has(word)).length;
}
function excerpt(text: string, query: Set<string>, limit: number) {
  if (Array.from(text).length <= limit) return text;
  const sentences = text.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) ?? [text];
  const ranked = sentences.map((value, index) => ({ value, index, score: relevance(value, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0];
  const selected = best?.score ? best.value.trim() : text;
  const clipped = Array.from(selected).slice(0, limit - 7).join("");
  return `${best?.score && best.index > 0 ? "…" : ""}${clipped}〔摘录〕`;
}

/** Read-only shared context. Never promote a group statement into a private fact. */
export async function getGroupMemoriesForCompanion(userId: string, companionId: string, query = ""): Promise<GroupMemoryPrivateContext[]> {
  const groups = await listGroupsForExport(userId);
  const queryTerms = terms(query);
  const candidates = groups
    .filter(group => group.userId === userId)
    .flatMap(group => group.memories
      // Ownership is checked by the caller. Leaving a group preserves known experiences;
      // joining does not grant knowledge of memories absent from knownBy.
      .filter(memory => memory.confirmed === true && memory.knownBy.includes(companionId))
      .map(memory => ({ group, memory, text: (redactSensitiveResponseText(memory.content) ?? "").trim() })))
    .filter(candidate => candidate.text)
    .map(candidate => ({ ...candidate, score: relevance(candidate.text, queryTerms) }))
    .sort((a, b) => b.score - a.score || (Date.parse(b.memory.createdAt) || 0) - (Date.parse(a.memory.createdAt) || 0));
  return candidates.slice(0, 6).map(({ group, memory, text }) => ({
    groupId: group.id,
    createdAt: memory.createdAt,
    sourceMessageIds: Array.isArray(memory.sourceMessageIds) ? [...memory.sourceMessageIds] : [],
    groupName: Array.from(redactSensitiveResponseText(group.name) ?? "").slice(0, 80).join(""),
    content: `【来源：群聊共享记忆，非私人既定事实】${excerpt(text, queryTerms, 270)}`
  }));
}
