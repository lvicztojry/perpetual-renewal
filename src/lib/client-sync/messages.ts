import type { MessageRecord } from "@/lib/renewal/types";

export function reconcileMessageSnapshot(server: MessageRecord[], local: MessageRecord[], conversationId: string) {
  const canonical = server.filter(row => row.conversationId === conversationId);
  const confirmed = new Set(canonical.map(row => row.metadata?.clientMessageId).filter(Boolean));
  const overlays = local.filter(row => row.conversationId === conversationId && !confirmed.has(row.metadata?.clientMessageId));
  return [...new Map([...overlays, ...canonical].map(row => [row.id, row])).values()]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
