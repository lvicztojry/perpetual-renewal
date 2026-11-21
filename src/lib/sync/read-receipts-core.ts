import type { ReadInput, ReadScope, InboxThread, ReadReceiptRepository, MessageReadReceiptExport } from "./read-receipts-types";

export class ReadReceiptError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 128 && id.trim() === id;
export function parseReadInput(value: unknown): ReadInput {
  const body = value as Partial<ReadInput> | null;
  if (!body || (body.scope !== "private" && body.scope !== "group") || !validId(body.threadId) ||
      !Array.isArray(body.messageIds) || body.messageIds.length > 200 || !body.messageIds.every(validId)) {
    throw new ReadReceiptError(400, "已读请求无效（每次最多 200 条）。");
  }
  return { scope: body.scope, threadId: body.threadId, messageIds: [...new Set(body.messageIds)] };
}
// Match these predicates in read-receipts-prisma.ts. No timestamps participate.
export function visibleIncoming(scope: ReadScope, message: {
  role?: string; speakerId?: string | null; metadata?: Record<string, unknown> | null;
  status?: unknown; deleted?: unknown; deletedAt?: unknown; hidden?: unknown; hiddenAt?: unknown;
}) {
  const meta = message.metadata;
  return (scope === "private" ? message.role === "assistant" : typeof message.speakerId === "string" && !!message.speakerId) &&
    ![message.status, meta?.status].some(status => status === "failed" || status === "deleted" || status === "hidden") &&
    !message.deleted && !meta?.deleted && !message.deletedAt && !meta?.deletedAt && !message.hidden && !meta?.hidden && !message.hiddenAt && !meta?.hiddenAt;
}
type Receipt = { userId: string; scope: ReadScope; threadId: string; messageId: string };
declare global { var renewalMessageReadReceipts: Map<string, Receipt> | undefined; }
const receiptKey = (row: Receipt) => JSON.stringify([row.userId, row.scope, row.threadId, row.messageId]);
const receipts = () => globalThis.renewalMessageReadReceipts ??= new Map<string, Receipt>();

/** Call before/after fallback account removal, or with thread IDs before companion removal. */
export function clearMessageReadReceipts(userId: string, scope?: ReadScope, threadIds?: readonly string[]) {
  const store = globalThis.renewalMessageReadReceipts;
  if (!store) return;
  for (const [key, row] of store) if (row.userId === userId && (!scope || row.scope === scope) && (!threadIds || threadIds.includes(row.threadId))) store.delete(key);
}

export class MemoryReadReceiptRepository implements ReadReceiptRepository {
  // Read existing shared stores directly: do not seed users/companions or copy histories.
  private threads(userId: string) {
    const source = globalThis.renewalStore;
    return [
      ...(source?.conversations ?? []).filter(c => c.userId === userId && source?.companions.some(p => p.id === c.companionId && p.userId === userId)).map(c => ({
        scope: "private" as const, threadId: c.id,
        messages: (source?.messages ?? []).filter(m => m.conversationId === c.id && visibleIncoming("private", m))
      })),
      ...[...(globalThis.renewalGroupStore?.values() ?? [])].filter(g => g.userId === userId).map(g => ({
        scope: "group" as const, threadId: g.id, messages: g.messages.filter(m => visibleIncoming("group", m))
      }))
    ];
  }
  async inbox(userId: string): Promise<InboxThread[]> {
    return this.threads(userId).map(t => ({ scope: t.scope, threadId: t.threadId,
      unreadCount: t.messages.filter(m => !globalThis.renewalMessageReadReceipts?.has(receiptKey({ userId, scope: t.scope, threadId: t.threadId, messageId: m.id }))).length
    }));
  }
  async listForExport(userId: string): Promise<MessageReadReceiptExport[]> {
    return this.threads(userId).flatMap(t => t.messages
      .filter(m => globalThis.renewalMessageReadReceipts?.has(receiptKey({ userId, scope: t.scope, threadId: t.threadId, messageId: m.id })))
      .map(m => ({ scope: t.scope, threadId: t.threadId, messageId: m.id })));
  }
  async mark(userId: string, raw: ReadInput) {
    const input = parseReadInput(raw);
    const thread = this.threads(userId).find(t => t.scope === input.scope && t.threadId === input.threadId);
    if (!thread || input.messageIds.some(id => !thread.messages.some(m => m.id === id))) throw new ReadReceiptError(404, "线程或消息不存在。");
    // No await between validation and writes: all IDs succeed or none do.
    let marked = 0;
    for (const messageId of input.messageIds) {
      const row = { userId, scope: input.scope, threadId: input.threadId, messageId }, key = receiptKey(row);
      if (!receipts().has(key)) { receipts().set(key, row); marked++; }
    }
    return marked;
  }
}
