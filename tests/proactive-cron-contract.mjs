import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const ROOT_URL = "https://deploy.example";
const STRONG_SECRET = "cron-contract-secret-private-32-bytes";

const checks = [];

try {
  checkPackageDeployGate();
  checkVercelCronContract();
  checkProactiveRunRouteContract();
  checkSchedulerGuards();
  checkCronAliasReadiness();
  checkDeploymentDocs();
  printSummary();
} catch (error) {
  console.error("\nProactive cron contract failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function checkPackageDeployGate() {
  const packageJson = JSON.parse(readText("package.json"));
  const scripts = packageJson.scripts ?? {};

  assert(
    scripts["qa:proactive-cron"] === "node tests/proactive-cron-contract.mjs",
    "package.json should expose qa:proactive-cron"
  );
  assert(
    scripts["verify:deploy"]?.includes("npm run env:readiness -- --strict"),
    "verify:deploy should run strict environment readiness"
  );
  assert(
    scripts["verify:deploy"]?.includes("npm run qa:proactive-cron"),
    "verify:deploy should include the proactive cron contract gate"
  );
  assert(
    scripts["verify:deploy"]?.includes("npm run prisma:validate") &&
      scripts["verify:deploy"]?.includes("npm run db:smoke"),
    "verify:deploy should still validate Prisma and the target database"
  );
  pass("package deploy gate includes proactive cron contract");
}

function checkVercelCronContract() {
  const vercel = JSON.parse(readText("vercel.json"));
  const cron = (vercel.crons ?? []).find((item) =>
    typeof item.path === "string" && item.path.startsWith("/api/proactive/run")
  );

  assert(cron, "vercel.json should define a proactive scheduler cron");
  assert(cron.schedule === "* * * * *", "Vercel cron should run every minute");

  const url = new URL(cron.path, ROOT_URL);
  assert(url.pathname === "/api/proactive/run", "Vercel cron should call the GET proactive route");
  assert(url.searchParams.get("limit") === "20", "Vercel cron should pin limit=20");
  assert(url.searchParams.get("maxDrafts") === "50", "Vercel cron should pin maxDrafts=50");
  assert(
    !url.searchParams.has("dryRun"),
    "production Vercel cron should rely on GET dryRun=false by default"
  );

  pass("vercel.json pins GET proactive scheduler cadence and guards");
}

function checkProactiveRunRouteContract() {
  const route = readText("src/app/api/proactive/run/route.ts");
  const getBlock = sliceBetween(
    route,
    "export async function GET(request: Request)",
    "export async function POST(request: Request)"
  );

  assert(getBlock.includes("!isCronAuthorized(request)"), "GET should require cron authorization");
  assert(
    getBlock.indexOf("!isCronAuthorized(request)") < getBlock.indexOf("runProactiveScheduler"),
    "GET should authorize before running the scheduler"
  );
  assert(
    getBlock.includes('dryRun: readBooleanQuery(url.searchParams.get("dryRun")) ?? false'),
    "GET should default dryRun to false while allowing explicit dry-run rehearsal"
  );
  assert(
    getBlock.includes('limit: readNumberQuery(url.searchParams.get("limit"))'),
    "GET should read limit from the Vercel cron query"
  );
  assert(
    getBlock.includes('maxDrafts: readNumberQuery(url.searchParams.get("maxDrafts"))'),
    "GET should read maxDrafts from the Vercel cron query"
  );
  assert(getBlock.includes('authMode: "cron-secret"'), "GET should report cron-secret auth mode");

  assert(route.includes("process.env.PROACTIVE_CRON_SECRET"), "route should read PROACTIVE_CRON_SECRET");
  assert(route.includes("process.env.CRON_SECRET"), "route should read Vercel CRON_SECRET alias");
  assert(route.includes("auth === `Bearer ${expected}`"), "route should accept Bearer cron tokens");
  assert(
    route.includes('request.headers.get("x-proactive-cron-secret")'),
    "route should retain the explicit scheduler header for non-Vercel callers"
  );

  pass("GET /api/proactive/run enforces Bearer or cron-secret authorization");
}

function checkSchedulerGuards() {
  const scheduler = readText("src/lib/relationship/proactive-scheduler.ts");

  assert(
    scheduler.includes("const DEFAULT_SCHEDULER_LIMIT = 20"),
    "scheduler default limit should match Vercel cron limit"
  );
  assert(
    scheduler.includes("const MAX_SCHEDULER_LIMIT = 100"),
    "scheduler should cap oversized scan limits"
  );
  assert(
    scheduler.includes("const DEFAULT_SCHEDULER_MAX_DRAFTS = 50"),
    "scheduler default maxDrafts should match Vercel cron maxDrafts"
  );
  assert(
    scheduler.includes("const MAX_SCHEDULER_MAX_DRAFTS = 200"),
    "scheduler should cap oversized draft limits"
  );
  assert(scheduler.includes("const dryRun = input.dryRun ?? true"), "scheduler library default should be dry-run");
  assert(
    scheduler.includes("Math.min(MAX_SCHEDULER_LIMIT, Math.max(1, Math.floor(value)))"),
    "scheduler should clamp limit to the supported range"
  );
  assert(
    scheduler.includes("Math.min(MAX_SCHEDULER_MAX_DRAFTS, Math.max(1, Math.floor(value)))"),
    "scheduler should clamp maxDrafts to the supported range"
  );

  pass("proactive scheduler clamps limit/maxDrafts and defaults safely");
}

function checkCronAliasReadiness() {
  const output = execFileSync(process.execPath, ["scripts/env-readiness.mjs", "--strict", "--no-local-env"], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://user:password@localhost:5432/perpetual_renewal",
      DATABASE_URL_UNPOOLED: "",
      USER_KEY_VAULT_SECRET: STRONG_SECRET,
      SESSION_COOKIE_SECRET: STRONG_SECRET,
      PROACTIVE_CRON_SECRET: "",
      CRON_SECRET: STRONG_SECRET,
      LLM_PROVIDER: "compatible",
      LLM_API_KEY: "",
      LLM_BASE_URL: "https://api.tryanotherone.com/v1",
      LLM_MODEL: "",
      VOICE_PROVIDER: "shared-llm"
    }
  });

  assert(
    output.includes("Vercel Cron CRON_SECRET alias is configured with sufficient length."),
    "env readiness should accept CRON_SECRET as the production cron alias"
  );
  assert(!output.includes(STRONG_SECRET), "env readiness should not print cron secret values");

  let strictFailed = false;
  try {
    execFileSync(process.execPath, ["scripts/env-readiness.mjs", "--strict", "--no-local-env"], {
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://user:password@localhost:5432/perpetual_renewal",
        USER_KEY_VAULT_SECRET: STRONG_SECRET,
        SESSION_COOKIE_SECRET: STRONG_SECRET,
        PROACTIVE_CRON_SECRET: "",
        CRON_SECRET: "short",
        LLM_PROVIDER: "compatible",
        VOICE_PROVIDER: "shared-llm"
      }
    });
  } catch {
    strictFailed = true;
  }

  assert(strictFailed, "strict env readiness should reject a short CRON_SECRET alias");
  pass("env readiness accepts strong CRON_SECRET alias and rejects weak alias");
}

function checkDeploymentDocs() {
  const deployment = readText("docs/DEPLOYMENT.md");
  const handoff = readText("docs/RELEASE_HANDOFF.md");

  for (const snippet of [
    "GET /api/proactive/run",
    "Vercel Cron 使用 GET 请求",
    '"path": "/api/proactive/run?limit=20&maxDrafts=50"',
    "必须携带 Bearer cron secret",
    "默认 `dryRun:false`",
    "`CRON_SECRET`",
    "`PROACTIVE_CRON_SECRET`",
    "`limit` 控制本轮扫描关系对象数量",
    "`maxDrafts` 控制本轮最多生成或保存的草稿数量",
    "npm run qa:proactive-cron"
  ]) {
    assert(deployment.includes(snippet), `docs/DEPLOYMENT.md should document: ${snippet}`);
  }

  assert(
    handoff.includes("npm run qa:proactive-cron") &&
      handoff.includes("Vercel Cron") &&
      handoff.includes("CRON_SECRET"),
    "release handoff should mention the proactive cron gate and Vercel alias"
  );
  pass("deployment docs describe Vercel Cron production scheduler boundary");
}

function sliceBetween(content, start, end) {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end);
  assert(startIndex >= 0, `source should include ${start}`);
  assert(endIndex > startIndex, `source should include ${end} after ${start}`);
  return content.slice(startIndex, endIndex);
}

function readText(file) {
  return readFileSync(file, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pass(message) {
  checks.push(message);
  console.log(`[ok] ${message}`);
}

function printSummary() {
  console.log(`Proactive cron contract passed: ${checks.length} checks.`);
}
