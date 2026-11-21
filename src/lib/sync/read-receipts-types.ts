export type ReadScope = "private" | "group";
export type ReadInput = { scope: ReadScope; threadId: string; messageIds: string[] };
export type InboxThread = { scope: ReadScope; threadId: string; unreadCount: number };
export type Inbox = { userId: string; threads: InboxThread[]; checkedAt: string };
export type MessageReadReceiptExport = { scope: ReadScope; threadId: string; messageId: string };
export interface ReadReceiptRepository {
  inbox(userId: string): Promise<InboxThread[]>;
  mark(userId: string, input: ReadInput): Promise<number>;
  listForExport(userId: string): Promise<MessageReadReceiptExport[]>;
}
