import { spawn, spawnSync } from "node:child_process";

const emails = process.env.AUTH_ALLOWED_EMAILS?.split(",").map(value => value.trim()).filter(Boolean);
if (!emails?.length || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
  console.error("AUTH_ALLOWED_EMAILS must contain the invited email addresses.");
  process.exit(1);
}
if (process.env.AUTH_MODE !== "password" || process.env.RENEWAL_REPOSITORY !== "prisma") {
  console.error("Cloud sharing requires password authentication and PostgreSQL persistence.");
  process.exit(1);
}
const check = spawnSync(process.execPath, ["scripts/env-readiness.mjs", "--strict", "--server-llm-required", "--no-local-env"], { stdio: "inherit" });
if (check.status !== 0) process.exit(1);
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"], { stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Application could not start."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
