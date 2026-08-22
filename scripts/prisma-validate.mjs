import { spawnSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import { loadLocalEnv } from "./load-local-env.mjs";

const fallbackDatabaseUrl =
  "postgresql://postgres:postgres@localhost:5432/perpetual_renewal?schema=public";

loadLocalEnv();

const prismaCli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");

const result = spawnSync(process.execPath, [prismaCli, "validate"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || fallbackDatabaseUrl
  },
  stdio: "inherit"
});

process.exit(result.status ?? 1);
