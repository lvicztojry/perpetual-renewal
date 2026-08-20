import { spawnSync } from "node:child_process";
import process from "node:process";

const fallbackDatabaseUrl =
  "postgresql://postgres:postgres@localhost:5432/perpetual_renewal?schema=public";

const result = spawnSync("npx", ["prisma", "validate"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || fallbackDatabaseUrl
  },
  shell: process.platform === "win32",
  stdio: "inherit"
});

process.exit(result.status ?? 1);
