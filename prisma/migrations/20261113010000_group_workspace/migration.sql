CREATE TABLE "GroupWorkspace" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "state" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupWorkspace_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GroupWorkspace_userId_idx" ON "GroupWorkspace"("userId");
ALTER TABLE "GroupWorkspace" ADD CONSTRAINT "GroupWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
