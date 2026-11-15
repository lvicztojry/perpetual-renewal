import { listGroupsForExport } from "@/lib/groups/repository";
import { redactSensitiveResponseText } from "@/lib/http/response-safety";

export type GroupMemoryPrivateContext = { groupId: string; groupName: string; content: string };

/** Read-only shared context. Never promote a group statement into a private fact. */
export async function getGroupMemoriesForCompanion(userId: string, companionId: string): Promise<GroupMemoryPrivateContext[]> {
  const groups = await listGroupsForExport(userId);
  const candidates = groups
    .filter(group => group.userId === userId)
    .flatMap(group => group.memories
      // Ownership is checked by the caller. Leaving a group preserves known experiences;
      // joining does not grant knowledge of memories absent from knownBy.
      .filter(memory => memory.confirmed === true && memory.knownBy.includes(companionId))
      .map(memory => ({ group, memory, text: (redactSensitiveResponseText(memory.content) ?? "").trim() })))
    .filter(candidate => candidate.text)
    .sort((a, b) => (Date.parse(b.memory.createdAt) || 0) - (Date.parse(a.memory.createdAt) || 0));
  return candidates.slice(0, 6).map(({ group, text }) => ({
    groupId: group.id,
    groupName: Array.from(redactSensitiveResponseText(group.name) ?? "").slice(0, 80).join(""),
    content: Array.from(`【来源：群聊共享记忆，非私人既定事实】${text}`).slice(0, 300).join("")
  }));
}
