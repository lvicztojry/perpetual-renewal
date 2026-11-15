import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Real error mapping, private headers and proactive GET/POST routes; the only
// scheduler is an injected failure. No .env files, databases or providers.
const root = fileURLToPath(new URL("../src/", import.meta.url));
const secret = "fixture-transaction-secret";
const privateDatabaseUrl = ["postgres://", "private", ":", "password", "@db.invalid/app"].join("");
const timeoutError = () => Object.assign(new Error(`Transaction already closed: ${secret}; ${privateDatabaseUrl}; elapsed 20001ms`), {
  code: "P2028", meta: { raw: secret }, clientVersion: "fixture-version"
});
const expectedBody = {
  error: "数据库暂时不可用，本次关系、消息或记忆操作没有保存成功。请稍后重试。",
  errorType: "database_unavailable", retryable: true, persistence: "prisma"
};
function fixture(extraEnv = {}) {
  const env = { NODE_ENV: "production", DATABASE_URL: "postgresql://fixture.invalid/app", PROACTIVE_CRON_SECRET: "fixture-cron-secret", ...extraEnv };
  const calls = [];
  const context = vm.createContext({ process: { env }, URL, Headers, Response, Error });
  const stubs = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth/session": { getCurrentSession: async () => ({ userId: "fixture-user", provider: "fixture" }) },
    "@/lib/relationship/proactive-scheduler": { runProactiveScheduler: async options => { calls.push(options); throw timeoutError(); } }
  };
  const cache = new Map();
  function load(specifier, parent = path.join(root, "entry.ts")) {
    if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
    const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(parent), specifier) : null;
    assert.ok(base?.startsWith(root), `Blocked import ${specifier}`);
    const filename = [`${base}.ts`, path.join(base, "index.ts")].find(existsSync);
    assert.ok(filename, `Missing import ${specifier}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const compiledModule = { exports: {} }; cache.set(filename, compiledModule);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename });
    new vm.Script(`(function(exports,require,module){${outputText}\n})`, { filename }).runInContext(context)(compiledModule.exports, child => load(child, filename), compiledModule);
    return compiledModule.exports;
  }
  return { load, env, calls };
}
async function assertPrivateUnavailable(response) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0, must-revalidate");
  assert.equal(response.headers.get("Pragma"), "no-cache");
  assert.equal(response.headers.get("Expires"), "0");
  assert.equal(response.headers.get("Surrogate-Control"), "no-store");
  assert.match(response.headers.get("Vary"), /Cookie/);
  assert.match(response.headers.get("Vary"), /Authorization/);
  const body = await response.json();
  assert.deepEqual(body, expectedBody);
  assert.doesNotMatch(JSON.stringify(body), /fixture-transaction-secret|private:password|postgres:|P2028|Transaction already closed|20001|raw|clientVersion|stack/);
}

test("P2028 maps to fixed private 503 independently of exception text/metadata", async () => {
  const { load } = fixture();
  const { persistenceUnavailableResponse, isConfiguredDatabaseUnavailable } = load("@/lib/http/persistence-errors");
  for (const error of [timeoutError(), { code: "P2028", message: secret }, { code: "P2028" }]) {
    assert.equal(isConfiguredDatabaseUnavailable(error), true);
    await assertPrivateUnavailable(persistenceUnavailableResponse(error, "renewal"));
  }
  assert.equal(persistenceUnavailableResponse(new Error("unrelated failure"), "renewal"), null);
  assert.equal(persistenceUnavailableResponse({ code: "P2002" }, "renewal"), null);
});

for (const mode of ["production", "development"]) test(`configured ${mode}: transaction errors never trigger memory fallback`, async () => {
  const { load } = fixture({ NODE_ENV: mode });
  const policy = load("@/lib/persistence/memory-fallback");
  assert.equal(policy.shouldUseMemoryFallback(), false);
  assert.equal(policy.shouldFallbackToMemoryOnPrismaError(timeoutError()), false);
  await assertPrivateUnavailable(load("@/lib/http/persistence-errors").persistenceUnavailableResponse(timeoutError(), "renewal"));
});

for (const env of [{ DATABASE_URL: "" }, { RENEWAL_REPOSITORY: "memory" }]) test(`unconfigured/explicit memory keeps existing classification policy: ${JSON.stringify(env)}`, () => {
  const { load } = fixture(env);
  assert.equal(load("@/lib/http/persistence-errors").isConfiguredDatabaseUnavailable(timeoutError()), false);
});

for (const mode of ["GET cron", "POST current-user", "POST all-users"]) test(`${mode} /api/proactive/run returns private sanitized 503 on P2028, without retry`, async () => {
  const f = fixture();
  const route = f.load("@/app/api/proactive/run/route");
  const method = mode.startsWith("GET") ? "GET" : "POST";
  const headers = { "Content-Type": "application/json" };
  if (mode !== "POST current-user") headers.authorization = ["Bearer", "fixture-cron-secret"].join(" ");
  const request = new Request("https://fixture.invalid/api/proactive/run?dryRun=false", {
    method, headers,
    ...(method === "POST" ? { body: JSON.stringify({ dryRun: false, scope: mode === "POST all-users" ? "all" : "current-user" }) } : {})
  });
  await assertPrivateUnavailable(await route[method](request));
  assert.equal(f.calls.length, 1, "HTTP mapping must not rerun a failed scheduler");
  assert.equal(f.calls[0].dryRun, false);
  assert.equal(f.calls[0].userId, mode === "POST current-user" ? "fixture-user" : undefined);
});

test("unauthorized cron remains private 401 and never starts the scheduler", async () => {
  const f = fixture(), route = f.load("@/app/api/proactive/run/route");
  const response = await route.GET(new Request("https://fixture.invalid/api/proactive/run"));
  assert.equal(response.status, 401); assert.match(response.headers.get("Cache-Control"), /private, no-store/);
  assert.equal(f.calls.length, 0);
});
