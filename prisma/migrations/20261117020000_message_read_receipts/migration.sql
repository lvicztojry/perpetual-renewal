CREATE TABLE "MessageReadReceipt" (
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "conversationId" TEXT,
  "groupId" TEXT,
  "privateMessageId" TEXT,
  CONSTRAINT "MessageReadReceipt_pkey" PRIMARY KEY ("userId", "scope", "threadId", "messageId"),
  CONSTRAINT "MessageReadReceipt_scope_check" CHECK (
    ("scope" = 'private' AND "conversationId" IS NOT NULL AND "conversationId" = "threadId"
      AND "privateMessageId" IS NOT NULL AND "privateMessageId" = "messageId" AND "groupId" IS NULL)
    OR ("scope" = 'group' AND "groupId" IS NOT NULL AND "groupId" = "threadId"
      AND "conversationId" IS NULL AND "privateMessageId" IS NULL)
  ),
  CONSTRAINT "MessageReadReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MessageReadReceipt_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MessageReadReceipt_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GroupWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MessageReadReceipt_privateMessageId_fkey" FOREIGN KEY ("privateMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MessageReadReceipt_conversationId_idx" ON "MessageReadReceipt"("conversationId");
CREATE INDEX "MessageReadReceipt_groupId_idx" ON "MessageReadReceipt"("groupId");
CREATE INDEX "MessageReadReceipt_privateMessageId_idx" ON "MessageReadReceipt"("privateMessageId");
