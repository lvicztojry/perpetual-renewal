import { prisma } from "@/lib/prisma";
import { shouldUseMemoryFallback } from "@/lib/persistence/memory-fallback";
import { MemoryReadReceiptRepository, parseReadInput } from "./read-receipts-core";
import { postgresSchemaFromDatabaseUrl, PrismaReadReceiptRepository } from "./read-receipts-prisma";
import type { Inbox, ReadReceiptRepository, MessageReadReceiptExport } from "./read-receipts-types";

export class ReadReceiptService {
  constructor(private readonly repository: ReadReceiptRepository) {}
  async inbox(userId: string): Promise<Inbox> {
    const threads = await this.repository.inbox(userId);
    return { userId, threads, checkedAt: new Date().toISOString() };
  }
  async mark(userId: string, body: unknown) {
    return { markedCount: await this.repository.mark(userId, parseReadInput(body)) };
  }
  listForExport(userId: string): Promise<MessageReadReceiptExport[]> {
    return this.repository.listForExport(userId);
  }
}
export function createReadReceiptService() {
  // Choose once from explicit configuration. Database errors must propagate.
  return new ReadReceiptService(shouldUseMemoryFallback() ? new MemoryReadReceiptRepository() :
    new PrismaReadReceiptRepository(prisma, postgresSchemaFromDatabaseUrl(process.env.DATABASE_URL)));
}

/** Account export: current owned visible incoming IDs only; database errors propagate. */
export function listMessageReadReceiptsForExport(userId: string): Promise<MessageReadReceiptExport[]> {
  return createReadReceiptService().listForExport(userId);
}
