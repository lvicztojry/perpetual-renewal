-- Store all-user cron continuation independently of any serverless process.
CREATE TABLE "ProactiveSchedulerCheckpoint" (
    "scope" TEXT NOT NULL,
    "cursor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProactiveSchedulerCheckpoint_pkey" PRIMARY KEY ("scope")
);
