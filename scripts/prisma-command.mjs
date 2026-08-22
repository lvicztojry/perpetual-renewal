import { spawnSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import { loadLocalEnv } from "./load-local-env.mjs";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/prisma-command.mjs <prisma command...>");
  process.exit(1);
}

loadLocalEnv();

if (usesMigrationCommand(args) && process.env.DATABASE_URL_UNPOOLED?.trim()) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED.trim();
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
