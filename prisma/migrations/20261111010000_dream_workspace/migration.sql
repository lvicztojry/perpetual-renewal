CREATE TABLE "DreamWorkspace" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "state" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DreamWorkspace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DreamWorkspace_companionId_key" ON "DreamWorkspace"("companionId");
CREATE INDEX "DreamWorkspace_userId_idx" ON "DreamWorkspace"("userId");
ALTER TABLE "DreamWorkspace" ADD CONSTRAINT "DreamWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DreamWorkspace" ADD CONSTRAINT "DreamWorkspace_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
