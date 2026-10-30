import { spawnSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import { loadLocalEnv } from "./load-local-env.mjs";
import { migrationDatabaseUrl } from "./database-url.mjs";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/prisma-command.mjs <prisma command...>");
  process.exit(1);
}

loadLocalEnv();

if (usesMigrationCommand(args)) {
  const migrationUrl = migrationDatabaseUrl();
  if (migrationUrl) process.env.DATABASE_URL = migrationUrl;
}

const prismaCli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");

const result = spawnSync(process.execPath, [prismaCli, ...args], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

process.exit(result.status ?? 1);

function usesMigrationCommand(commandArgs) {
  return commandArgs[0] === "migrate" && (commandArgs[1] === "dev" || commandArgs[1] === "deploy");
}
