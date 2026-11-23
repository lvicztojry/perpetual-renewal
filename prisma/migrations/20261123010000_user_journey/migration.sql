-- Existing accounts intentionally receive no row (legacy, explicit opt-in).
CREATE TABLE "UserJourney" (
    "userId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL,
    CONSTRAINT "UserJourney_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "UserJourney_revision_check" CHECK ("revision" >= 0)
);
ALTER TABLE "UserJourney" ADD CONSTRAINT "UserJourney_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
