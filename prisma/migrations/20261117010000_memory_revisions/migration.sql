ALTER TABLE "Memory" ADD COLUMN "supersededById" TEXT;
CREATE TABLE "MemoryRevision" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memoryId" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "relatedMemoryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemoryRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MemoryRevision_userId_memoryId_createdAt_idx" ON "MemoryRevision"("userId", "memoryId", "createdAt");
CREATE INDEX "MemoryRevision_userId_companionId_idx" ON "MemoryRevision"("userId", "companionId");
ALTER TABLE "MemoryRevision" ADD CONSTRAINT "MemoryRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryRevision" ADD CONSTRAINT "MemoryRevision_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
