import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import * as ts from "typescript";
import { loadLocalEnv } from "../scripts/load-local-env.mjs";
import { migrationDatabaseUrl } from "../scripts/database-url.mjs";

if (process.env.DREAM_DATABASE_QA !== "1") {
  console.log("Dream PostgreSQL QA skipped: set DREAM_DATABASE_QA=1 to opt in.");
  process.exit(0);
}
loadLocalEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const schema = `renewal_dream_qa_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^renewal_dream_qa_[a-f0-9]{32}$/);
const url = new URL(migrationDatabaseUrl());
const bootstrap = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
url.searchParams.set("schema", schema);
const newClient = () => new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
let prisma = newClient(), created = false, step = "create isolated schema";
try {
  await bootstrap.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  step = "apply versioned migrations";
  const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 120_000,
    env: { ...process.env, DATABASE_URL: url.toString() }
  });
  assert.equal(migration.status, 0, "Isolated migrations failed.");
  console.log("ok - all versioned migrations applied in an isolated schema");
  const modules = new Map();
  const forbidden = () => { throw new Error("Unexpected provider operation"); };
  function load(filename) {
    if (!existsSync(filename) && filename.endsWith(".ts")) filename = resolve(filename.slice(0, -3), "index.ts");
    if (modules.has(filename)) return modules.get(filename).exports;
    const compiledModule = { exports: {} }; modules.set(filename, compiledModule);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    const scopedRequire = id => {
      if (id === "@/lib/prisma") return { get prisma() { return prisma; } };
      if (id === "@/lib/persistence/memory-fallback") return { shouldUseMemoryFallback: () => false, shouldFallbackToMemoryOnPrismaError: () => false };
      if (id === "@/lib/llm/user-provider") return { createUserLlmProvider: forbidden };
      if (id === "@/lib/usage") return { recordModelUsage: async () => null };
      if (id.startsWith("@/")) return load(resolve(root, "src", `${id.slice(2)}.ts`));
      if (id.startsWith(".")) return load(resolve(dirname(filename), `${id}.ts`));
      return require(id);
    };
    new Function("exports", "require", "module", output)(compiledModule.exports, scopedRequire, compiledModule);
    return compiledModule.exports;
  }
  const { PrismaRenewalRepository } = load(resolve(root, "src/lib/renewal/prisma-repository.ts"));
  const { PrismaDreamRepository } = load(resolve(root, "src/lib/dream/repository.ts"));
  const { DreamService } = load(resolve(root, "src/lib/dream/service.ts"));
  const userId = randomUUID(), strangerId = randomUUID();
  await prisma.user.createMany({ data: [userId, strangerId].map(id => ({ id, email: `${id}@example.invalid`, nickname: "梦境隔离验收" })) });
  const renewal = new PrismaRenewalRepository();
  const companion = await renewal.createCompanion(userId, { name: "隔离梦境", relationshipKind: "FRIEND", personality: ["直接"], speakingStyle: "原始表达", proactiveMessagesEnabled: false });
  const service = new DreamService({ provider: { name: "mock", complete: forbidden } });
  step = "persist and reconnect";
  let state = (await service.post(userId, companion.id, { action: "start" })).state;
  step = "generate isolated sample";
  state = (await service.post(userId, companion.id, { action: "generate", revision: state.revision, mode: "compare", message: "我有点累。" })).state;
  step = "record isolated correction";
  state = (await service.post(userId, companion.id, { action: "feedback", revision: state.revision, roundId: state.rounds[0].id, correction: "先关心吃饭，不连续追问。", scope: "context" })).state;
  step = "save isolated confirmed draft";
  state = (await service.post(userId, companion.id, { action: "edit", revision: state.revision, draftProfile: state.draftProfile, fragments: state.fragments.map(fragment => ({ ...fragment, confirmed: true })) })).state;
  step = "reconnect and compare stored draft";
  await prisma.$disconnect(); prisma = newClient();
  assert.deepEqual((await new DreamService().get(userId, companion.id)).state, state);
  assert.equal((await renewal.getCompanion(userId, companion.id)).speakingStyle, "原始表达");
  console.log("ok - draft survives a fresh PostgreSQL connection without changing official profile");
  step = "apply, restore and stale revision";
  const applied = await service.post(userId, companion.id, { action: "apply", revision: state.revision });
  assert.equal(applied.companion.speakingStyle, state.previewProfile.speakingStyle);
  await assert.rejects(() => service.post(userId, companion.id, { action: "apply", revision: state.revision }), error => error.status === 409);
  await assert.rejects(() => service.get(strangerId, companion.id), error => error.status === 404);
  const restored = await service.post(userId, companion.id, { action: "restore", revision: applied.state.revision, versionId: applied.state.versions[0].id });
  assert.equal(restored.companion.speakingStyle, "原始表达");
  assert.equal(await prisma.message.count({ where: { conversationId: companion.conversationId } }), 0);
  assert.equal(await prisma.memory.count({ where: { companionId: companion.id } }), 0);
  console.log("ok - confirmed apply, actual restore, ownership and stale-revision checks");
  step = "transaction rollback";
  const beforeRollback = (await service.get(userId, companion.id)).state;
  await assert.rejects(() => new PrismaDreamRepository().mutate(userId, companion.id, (current, draft) => ({
    state: { ...draft, revision: Number.MAX_SAFE_INTEGER }, profile: { personality: current.personality, speakingStyle: "MUST_NOT_PERSIST" }
  })));
  assert.equal((await renewal.getCompanion(userId, companion.id)).speakingStyle, "原始表达");
  assert.deepEqual((await service.get(userId, companion.id)).state, beforeRollback);
  console.log("ok - failing snapshot write rolls back the accompanying profile write");
  step = "cascade cleanup";
  await prisma.user.delete({ where: { id: userId } });
  assert.equal(await prisma.dreamWorkspace.count({ where: { userId } }), 0);
  console.log("ok - account deletion cascades dream snapshots");
} catch (error) {
  // Raw Prisma errors can include connection details and query data.
  console.error(`Dream PostgreSQL QA failed at ${step}; type=${error?.constructor?.name ?? "unknown"}; code=${typeof error?.code === "string" ? error.code : "check_failed"}; status=${typeof error?.status === "number" ? error.status : "none"}.`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  if (created) {
    assert.match(schema, /^renewal_dream_qa_[a-f0-9]{32}$/);
    await bootstrap.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    console.log("ok - own temporary schema removed");
  }
  await bootstrap.$disconnect();
}
