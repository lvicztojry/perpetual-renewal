-- CreateEnum
CREATE TYPE "RelationshipKind" AS ENUM ('REAL_PERSON_SUBSTITUTE', 'MEMORIAL', 'EX_PARTNER', 'LOVER', 'FRIEND', 'FAMILY', 'MENTOR', 'PUBLIC_FIGURE_IMAGINED', 'FICTIONAL_CHARACTER', 'ORIGINAL_CHARACTER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('USER_FACT', 'RELATIONSHIP_EVENT', 'COMPANION_PROFILE', 'EMOTIONAL_PREFERENCE');

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('PENDING', 'ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "ProactiveMessageStatus" AS ENUM ('DRAFT', 'SENT', 'DISMISSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ProactiveMessageKind" AS ENUM ('DAILY_GREETING', 'LAST_CONVERSATION_FOLLOWUP', 'ANNIVERSARY', 'EMOTION_CARE', 'PLAYFUL_MISS_YOU');

-- CreateEnum
CREATE TYPE "SafetyEventType" AS ENUM ('SELF_HARM', 'HARM_TO_OTHERS', 'COERCIVE_ATTACHMENT', 'REAL_WORLD_COMMITMENT', 'MONEY_OR_LEGAL_IDENTITY', 'RELATIONAL_PRESSURE', 'SAFETY_OVERRIDE', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "language" TEXT NOT NULL DEFAULT 'zh-CN',
    "proactiveMessagesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "proactiveFrequencyHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Companion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationshipKind" "RelationshipKind" NOT NULL,
    "customKind" TEXT,
    "userAddress" TEXT,
    "companionAddress" TEXT,
    "personality" TEXT[],
    "speakingStyle" TEXT NOT NULL,
    "background" TEXT,
    "boundaries" TEXT,
    "immersionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Companion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "type" "MemoryType" NOT NULL,
    "status" "MemoryStatus" NOT NULL DEFAULT 'PENDING',
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "familiarityScore" INTEGER NOT NULL DEFAULT 0,
    "closenessScore" INTEGER NOT NULL DEFAULT 0,
    "recentEmotion" TEXT,
    "importantEvents" JSONB,
    "lastInteractionAt" TIMESTAMP(3),
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelationshipState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProactiveMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "kind" "ProactiveMessageKind" NOT NULL DEFAULT 'DAILY_GREETING',
    "content" TEXT NOT NULL,
    "reason" TEXT,
    "safety" JSONB,
    "status" "ProactiveMessageStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProactiveMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companionId" TEXT,
    "messageId" TEXT,
    "type" "SafetyEventType" NOT NULL,
    "input" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Companion_userId_idx" ON "Companion"("userId");

-- CreateIndex
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

-- CreateIndex
CREATE INDEX "Conversation_companionId_idx" ON "Conversation"("companionId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Memory_userId_companionId_status_idx" ON "Memory"("userId", "companionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipState_companionId_key" ON "RelationshipState"("companionId");

-- CreateIndex
CREATE INDEX "RelationshipState_userId_idx" ON "RelationshipState"("userId");

-- CreateIndex
CREATE INDEX "ProactiveMessage_userId_status_idx" ON "ProactiveMessage"("userId", "status");

-- CreateIndex
CREATE INDEX "ProactiveMessage_companionId_idx" ON "ProactiveMessage"("companionId");

-- CreateIndex
CREATE INDEX "SafetyEvent_userId_type_idx" ON "SafetyEvent"("userId", "type");

-- AddForeignKey
ALTER TABLE "Companion" ADD CONSTRAINT "Companion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipState" ADD CONSTRAINT "RelationshipState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipState" ADD CONSTRAINT "RelationshipState_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProactiveMessage" ADD CONSTRAINT "ProactiveMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProactiveMessage" ADD CONSTRAINT "ProactiveMessage_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
