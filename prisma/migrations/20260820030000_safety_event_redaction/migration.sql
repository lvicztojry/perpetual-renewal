ALTER TYPE "SafetyEventType" ADD VALUE IF NOT EXISTS 'PUBLIC_FIGURE_AUTHORIZATION';
ALTER TYPE "SafetyEventType" ADD VALUE IF NOT EXISTS 'MINOR_SEXUAL_CONTENT';
ALTER TYPE "SafetyEventType" ADD VALUE IF NOT EXISTS 'PRIVACY_VIOLATION';
ALTER TYPE "SafetyEventType" ADD VALUE IF NOT EXISTS 'PROFESSIONAL_ADVICE';
ALTER TYPE "SafetyEventType" ADD VALUE IF NOT EXISTS 'IDENTITY_DECEPTION';

ALTER TABLE "SafetyEvent"
  ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'user_input',
  ADD COLUMN "severity" TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT 'legacy-redacted',
  ADD COLUMN "riskHash" TEXT NOT NULL DEFAULT 'legacy-redacted';

ALTER TABLE "SafetyEvent" DROP COLUMN "input";

CREATE INDEX "SafetyEvent_userId_createdAt_idx" ON "SafetyEvent"("userId", "createdAt");
CREATE INDEX "SafetyEvent_riskHash_idx" ON "SafetyEvent"("riskHash");
