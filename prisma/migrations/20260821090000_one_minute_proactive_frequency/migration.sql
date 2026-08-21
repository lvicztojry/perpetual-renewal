ALTER TABLE "Companion"
ALTER COLUMN "proactiveFrequencyPreset" SET DEFAULT '1m',
ALTER COLUMN "proactiveFrequencyMinutes" SET DEFAULT 1;

UPDATE "Companion"
SET "proactiveFrequencyPreset" = '1m',
    "proactiveFrequencyMinutes" = 1
WHERE "proactiveFrequencyPreset" = '24h'
  AND "proactiveFrequencyMinutes" = 1440;
