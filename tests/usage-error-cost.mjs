import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function offlineRepository() {
  // Only these two production modules execute. No real process, network or DB is exposed.
  const context = vm.createContext({
    process: { env: { LLM_INPUT_COST_USD_PER_1M: "2", LLM_OUTPUT_COST_USD_PER_1M: "3" } }
  });
  const forbidden = () => { throw new Error("External access is forbidden in this test"); };
  const modules = new Map([
    ["@prisma/client", { Prisma: { Decimal: class {} } }],
    ["@/lib/prisma", { prisma: new Proxy({}, { get: forbidden }) }],
    ["@/lib/logging/sanitize", { safeLogValue: forbidden }],
    ["@/lib/http/response-safety", { redactSensitiveResponseText: value => value }],
    ["@/lib/persistence/memory-fallback", {
      shouldUseMemoryFallback: () => true,
      shouldFallbackToMemoryOnPrismaError: forbidden
    }]
  ]);
  function compile(filename) {
    const source = readFileSync(new URL(`../src/lib/usage/${filename}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    });
    const compiledModule = { exports: {} };
    const requireStub = specifier => {
      if (!modules.has(specifier)) throw new Error(`Blocked import: ${specifier}`);
      return modules.get(specifier);
    };
    new vm.Script(`(function(exports, require, module) {${outputText}\n})`, { filename })
      .runInContext(context)(compiledModule.exports, requireStub, compiledModule);
    return compiledModule.exports;
  }
  modules.set("./pricing", compile("pricing"));
  return compile("repository").createUsageRepository();
}

const base = { userId: "offline-user", provider: "compatible", model: "offline-fixture", purpose: "dream_candidates" };

test("failed response with usage retains its status and records nonzero configured cost", async () => {
  const repository = offlineRepository();
  const usage = { inputTokens: 1000, outputTokens: 2000 };
  const log = await repository.create({ ...base, status: "error", errorKind: "provider_response", usage });
  assert.equal(log.status, "error");
  assert.equal(log.errorKind, "provider_response");
  assert.equal(log.estimatedCostUsd, 0.008);
  assert.equal(log.totalTokens, 3000);
  assert.deepEqual(usage, { inputTokens: 1000, outputTokens: 2000 });
  const [stored] = await repository.listForExport(base.userId, 10);
  assert.equal(stored.status, "error");
  assert.equal(stored.estimatedCostUsd, 0.008);
});

for (const status of ["error", "success"]) {
  test(`${status}: absent or total-only usage does not invent billable tokens`, async () => {
    const repository = offlineRepository();
    for (const usage of [undefined, {}, { totalTokens: 9000 }]) {
      const log = await repository.create({ ...base, status, usage });
      assert.equal(log.status, status);
      assert.equal(log.estimatedCostUsd, 0);
      assert.equal(log.inputTokens, null);
      assert.equal(log.outputTokens, null);
    }
  });

  test(`${status}: cost uses normalized tokens, preserving any valid side`, async () => {
    const repository = offlineRepository();
    const cases = [
      { input: -1000, output: -2000, normalized: [0, 0], cost: 0 },
      { input: NaN, output: Infinity, normalized: [null, null], cost: 0 },
      { input: -Infinity, output: "2000", normalized: [null, null], cost: 0 },
      { input: -1000, output: 2000, normalized: [0, 2000], cost: 0.006 },
      { input: 1000, output: NaN, normalized: [1000, null], cost: 0.002 },
      { input: NaN, output: 2000, normalized: [null, 2000], cost: 0.006 },
      { input: 1000.6, output: 2000.4, normalized: [1001, 2000], cost: 0.008002 }
    ];
    for (const row of cases) {
      const log = await repository.create({
        ...base, status, usage: { inputTokens: row.input, outputTokens: row.output, totalTokens: NaN }
      });
      assert.equal(log.status, status);
      assert.deepEqual([log.inputTokens, log.outputTokens], row.normalized);
      assert.equal(log.estimatedCostUsd, row.cost);
      assert.ok(Number.isFinite(log.estimatedCostUsd) && log.estimatedCostUsd >= 0);
    }
  });
}

test("successful response retains status and existing configured cost", async () => {
  const log = await offlineRepository().create({
    ...base, status: "success", usage: { inputTokens: 1000, outputTokens: 2000, totalTokens: 3000 }
  });
  assert.equal(log.status, "success");
  assert.equal(log.inputTokens, 1000);
  assert.equal(log.outputTokens, 2000);
  assert.equal(log.totalTokens, 3000);
  assert.equal(log.estimatedCostUsd, 0.008);
});
