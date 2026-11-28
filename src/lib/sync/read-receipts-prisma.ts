import { Prisma, type PrismaClient } from "@prisma/client";
import { parseReadInput, ReadReceiptError } from "./read-receipts-core";
import type { InboxThread, ReadInput, ReadReceiptRepository, MessageReadReceiptExport } from "./read-receipts-types";

// Prisma's URL schema qualifies ORM queries, but does not set raw SQL search_path.
// Quote identifiers separately; all data values still use Prisma.sql parameters.
export function postgresSchemaFromDatabaseUrl(configured: string | undefined): string {
  try {
    const url = new URL(configured ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
    const schema = url.searchParams.get("schema") ?? "public";
    quotedIdentifier(schema);
    return schema;
  } catch {
    throw new Error("Invalid message sync database configuration.");
  }
}
function quotedIdentifier(value: string): string {
  if (!value || value.includes("\0") || new TextEncoder().encode(value).length > 63) {
    throw new Error("Invalid message sync SQL identifier.");
  }
  return '"' + value.replaceAll('"', '""') + '"';
}
const truthy = (value: Prisma.Sql) => Prisma.sql`COALESCE(${value}, 'null'::jsonb) NOT IN ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb)`;
const visible = (value: Prisma.Sql) => Prisma.sql`
  COALESCE(${value}->>'status', '') NOT IN ('failed', 'deleted', 'hidden')
  AND NOT (${truthy(Prisma.sql`${value}->'deleted'`)})
  AND NOT (${truthy(Prisma.sql`${value}->'deletedAt'`)})
  AND NOT (${truthy(Prisma.sql`${value}->'hidden'`)})
  AND NOT (${truthy(Prisma.sql`${value}->'hiddenAt'`)})`;
const privateIncoming = Prisma.sql`m."role" = 'ASSISTANT' AND ${visible(Prisma.sql`m."metadata"`)}`;
const groupIncoming = Prisma.sql`jsonb_typeof(msg->'id') = 'string' AND COALESCE(msg->>'id', '') <> ''
  AND jsonb_typeof(msg->'speakerId') = 'string' AND COALESCE(msg->>'speakerId', '') <> ''
  AND ${visible(Prisma.sql`msg`)} AND ${visible(Prisma.sql`msg->'metadata'`)}`;
const groupMessages = Prisma.sql`jsonb_array_elements(CASE WHEN jsonb_typeof(g."state"->'messages') = 'array' THEN g."state"->'messages' ELSE '[]'::jsonb END) AS items(msg)`;

export class PrismaReadReceiptRepository implements ReadReceiptRepository {
  private readonly tables;
  constructor(private readonly db: PrismaClient, schema: string) {
    const qualified = (name: string) => Prisma.raw(`${quotedIdentifier(schema)}.${quotedIdentifier(name)}`);
    this.tables = {
      conversation: qualified("Conversation"), companion: qualified("Companion"),
      message: qualified("Message"), receipt: qualified("MessageReadReceipt"), group: qualified("GroupWorkspace")
    };
  }
  async inbox(userId: string): Promise<InboxThread[]> {
    const rows = await this.db.$queryRaw<Array<{ scope: "private" | "group"; threadId: string; unreadCount: bigint }>>(Prisma.sql`
      SELECT 'private' AS scope, c."id" AS "threadId", COUNT(m."id") AS "unreadCount"
      FROM ${this.tables.conversation} c JOIN ${this.tables.companion} p ON p."id" = c."companionId" AND p."userId" = ${userId}
      LEFT JOIN ${this.tables.message} m ON m."conversationId" = c."id" AND ${privateIncoming}
        AND NOT EXISTS (SELECT 1 FROM ${this.tables.receipt} r WHERE r."userId" = ${userId}
          AND r."scope" = 'private' AND r."threadId" = c."id" AND r."messageId" = m."id")
      WHERE c."userId" = ${userId} GROUP BY c."id"
      UNION ALL
      SELECT 'group' AS scope, g."id" AS "threadId", (
        SELECT COUNT(DISTINCT msg->>'id') FROM ${groupMessages} WHERE ${groupIncoming}
        AND NOT EXISTS (SELECT 1 FROM ${this.tables.receipt} r WHERE r."userId" = ${userId}
          AND r."scope" = 'group' AND r."threadId" = g."id" AND r."messageId" = msg->>'id')
      ) AS "unreadCount" FROM ${this.tables.group} g WHERE g."userId" = ${userId}
    `);
    return rows.map(row => ({ scope: row.scope, threadId: row.threadId, unreadCount: Number(row.unreadCount) }));
  }
  async listForExport(userId: string): Promise<MessageReadReceiptExport[]> {
    return this.db.$queryRaw<MessageReadReceiptExport[]>(Prisma.sql`
      SELECT r."scope", r."threadId", r."messageId" FROM ${this.tables.receipt} r
      JOIN ${this.tables.conversation} c ON c."id" = r."threadId" AND c."id" = r."conversationId" AND c."userId" = ${userId}
      JOIN ${this.tables.companion} p ON p."id" = c."companionId" AND p."userId" = ${userId}
      JOIN ${this.tables.message} m ON m."id" = r."messageId" AND m."id" = r."privateMessageId" AND m."conversationId" = c."id"
      WHERE r."userId" = ${userId} AND r."scope" = 'private' AND ${privateIncoming}
      UNION ALL
      SELECT r."scope", r."threadId", r."messageId" FROM ${this.tables.receipt} r
      JOIN ${this.tables.group} g ON g."id" = r."threadId" AND g."id" = r."groupId" AND g."userId" = ${userId}
      WHERE r."userId" = ${userId} AND r."scope" = 'group' AND EXISTS (
        SELECT 1 FROM ${groupMessages} WHERE msg->>'id' = r."messageId" AND ${groupIncoming}
      )
      ORDER BY "scope", "threadId", "messageId"
    `);
  }
  async mark(userId: string, raw: ReadInput): Promise<number> {
    const input = parseReadInput(raw), { scope, threadId, messageIds } = input;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(async tx => {
          // Block deletion/ownership change and snapshot mutation until commit.
          const threads = scope === "private"
            ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT c."id" FROM ${this.tables.conversation} c
                JOIN ${this.tables.companion} p ON p."id" = c."companionId" AND p."userId" = ${userId}
                WHERE c."id" = ${threadId} AND c."userId" = ${userId} FOR SHARE OF c, p`)
            : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT g."id" FROM ${this.tables.group} g
                WHERE g."id" = ${threadId} AND g."userId" = ${userId} FOR SHARE`);
          if (threads.length !== 1) throw new ReadReceiptError(404, "线程或消息不存在。");
          const idsJson = JSON.stringify(messageIds);
          const found = scope === "private"
            ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT m."id" FROM ${this.tables.message} m
                WHERE m."conversationId" = ${threadId} AND ${privateIncoming}
                AND m."id" IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb)) FOR SHARE OF m`)
            : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT DISTINCT msg->>'id' AS id
                FROM ${this.tables.group} g CROSS JOIN LATERAL ${groupMessages}
                WHERE g."id" = ${threadId} AND g."userId" = ${userId} AND ${groupIncoming}
                AND msg->>'id' IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`);
          if (found.length !== messageIds.length) throw new ReadReceiptError(404, "线程或消息不存在。");
          const inserted = await tx.$queryRaw<Array<{ messageId: string }>>(Prisma.sql`
            INSERT INTO ${this.tables.receipt} ("userId", "scope", "threadId", "messageId", "conversationId", "groupId", "privateMessageId")
            SELECT ${userId}, ${scope}, ${threadId}, id,
              ${scope === "private" ? threadId : null}::text, ${scope === "group" ? threadId : null}::text,
              CASE WHEN ${scope} = 'private' THEN id ELSE NULL END
            FROM jsonb_array_elements_text(${idsJson}::jsonb) AS ids(id)
            ON CONFLICT ("userId", "scope", "threadId", "messageId") DO NOTHING RETURNING "messageId"
          `);
          return inserted.length;
        }, { isolationLevel: "Serializable", timeout: 20000, maxWait: 5000 });
      } catch (error) {
        const failure = error as { code?: string; meta?: { code?: string } } | null;
        const retryable = failure?.code === "P2034" ||
          (failure?.code === "P2010" && failure.meta?.code === "40001");
        if (attempt < 2 && retryable) continue;
        throw error;
      }
    }
  }
}
