ALTER TABLE "Companion"
ADD COLUMN "proactiveMessagesEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "proactiveFrequencyPreset" TEXT NOT NULL DEFAULT '24h',
ADD COLUMN "proactiveFrequencyMinutes" INTEGER NOT NULL DEFAULT 1440;
