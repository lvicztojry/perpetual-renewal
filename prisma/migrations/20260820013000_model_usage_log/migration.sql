-- CreateTable
CREATE TABLE "ModelUsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companionId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "errorKind" TEXT,
    "httpStatus" INTEGER,
    "fallbackReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelUsageLog_userId_createdAt_idx" ON "ModelUsageLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelUsageLog_provider_model_idx" ON "ModelUsageLog"("provider", "model");

-- CreateIndex
CREATE INDEX "ModelUsageLog_status_createdAt_idx" ON "ModelUsageLog"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ModelUsageLog" ADD CONSTRAINT "ModelUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelUsageLog" ADD CONSTRAINT "ModelUsageLog_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelUsageLog" ADD CONSTRAINT "ModelUsageLog_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelUsageLog" ADD CONSTRAINT "ModelUsageLog_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
