import { spawnSync } from "node:child_process";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const includeAudit = args.has("--audit");
const skipE2e = args.has("--skip-e2e");

const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath ? process.execPath : "npm";
const steps = [
  ["Secret scan", ["run", "secrets:check"]],
  ["Docs consistency", ["run", "docs:check"]],
  ["Next typegen", ["run", "next:typegen"]],
  ["Git boundary", ["run", "git:boundary"]],
  ["Typecheck", ["run", "typecheck"]],
  ["Lint", ["run", "lint"]],
  ["QA samples", ["run", "qa:samples"]],
  ["Prompt QA", ["run", "qa:prompt"]],
  ["Structured import QA", ["run", "qa:imports"]],
  ["Config/vault QA", ["run", "qa:vault"]],
  ["Password auth QA", ["run", "qa:auth"]],
  ["Logging sanitize QA", ["run", "qa:logging"]],
  ["Response safety QA", ["run", "qa:response"]],
  ["Provider adapters QA", ["run", "qa:providers"]],
  ["Voice shared-LLM QA", ["run", "qa:voice"]],
  ["Voice language QA", ["run", "qa:voice-language"]],
  ["Proactive scheduler QA", ["run", "qa:proactive-scheduler"]],
  ["Proactive cron contract QA", ["run", "qa:proactive-cron"]],
  ["Real provider QA fake", ["run", "qa:real-provider:fake"]],
  ["PWA check", ["run", "pwa:check"]],
  ["Environment readiness", ["run", "env:readiness"]],
  ["Prisma validate", ["run", "prisma:validate"]],
  ["DB smoke", ["run", "db:smoke"]],
  ["Smoke", ["run", "smoke"]],
  ["Build", ["run", "build"]],
  ["Production auth access", ["run", "qa:auth-access"]]
];

if (!skipE2e) {
  steps.push(["E2E", ["run", "e2e"]]);
}

if (includeAudit) {
  steps.push(["Audit high", ["--cache", "./.npm-cache", "audit", "--audit-level=high"]]);
}

const startedAt = Date.now();

console.log("Local verification");
console.log(
  `steps=${steps.length} audit=${includeAudit ? "yes" : "no"} e2e=${skipE2e ? "skipped" : "yes"}`
);
console.log("");

for (const [label, stepArgs] of steps) {
  const stepStartedAt = Date.now();
  console.log(`==> ${label}`);
  const result = spawnSync(npmCommand, npmExecPath ? [npmExecPath, ...stepArgs] : stepArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });

  const elapsedSeconds = ((Date.now() - stepStartedAt) / 1000).toFixed(1);
  if (result.status !== 0) {
    console.error("");
    if (result.error) {
      console.error(`Process error: ${result.error.message}`);
    }
    if (result.signal) {
      console.error(`Process signal: ${result.signal}`);
    }
    console.error(`Verification failed at "${label}" after ${elapsedSeconds}s.`);
    process.exit(result.status ?? 1);
  }

  console.log(`✓ ${label} passed in ${elapsedSeconds}s`);
  console.log("");
}

const totalSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`Local verification passed in ${totalSeconds}s.`);
