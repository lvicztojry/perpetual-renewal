import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import ts from "typescript";
import { loadLocalEnv } from "../scripts/load-local-env.mjs";
import { migrationDatabaseUrl } from "../scripts/database-url.mjs";

if (process.env.MEMORY_DATABASE_QA !== "1") { console.log("Memory PostgreSQL QA skipped; opt in with MEMORY_DATABASE_QA=1."); process.exit(0); }
loadLocalEnv();
const configured = migrationDatabaseUrl();
if (!configured) throw new Error("Database configuration is required.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = `renewal_memory_qa_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^renewal_memory_qa_[a-f0-9]{32}$/);
const url = new URL(configured);
const bootstrap = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
url.searchParams.set("schema", schema);
const isolatedUrl = url.toString();
function client() { assert.equal(new URL(isolatedUrl).searchParams.get("schema"), schema); return new PrismaClient({ datasources: { db: { url: isolatedUrl } }, log: [] }); }
let prisma = client(), peer, created = false, step = "create own isolated schema";
const require = createRequire(import.meta.url), cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  assert.ok(filename.startsWith(resolve(root, "src")) && existsSync(filename));
  const mod = { exports: {} }; cache.set(filename, mod);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("exports", "require", "module", output)(mod.exports, name => name.startsWith("@/") ? load(resolve(root, "src", name.slice(2) + ".ts")) : name.startsWith(".") ? load(resolve(dirname(filename), name + ".ts")) : require(name), mod);
  return mod.exports;
}
try {
  await bootstrap.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
  step = "migrate only isolated schema";
  const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: root, windowsHide: true, encoding: "utf8", timeout: 120000, env: { ...process.env, DATABASE_URL: isolatedUrl, DATABASE_URL_UNPOOLED: isolatedUrl } });
  if (migration.status !== 0) console.error(`Migration failed; codes=${[...new Set(`${migration.stdout}\n${migration.stderr}`.match(/\bP\d{4}\b/g) ?? [])].join(",") || "none"}.`);
  assert.equal(migration.status, 0);
  assert.equal(await prisma.memoryRevision.count(), 0);
  console.log("ok - additive migration applied in isolated schema");
  const { applyPrismaMemoryChange, readPrismaMemoryHistory, readPrismaMemoryExportSnapshot } = load(resolve(root, "src/lib/memory/lifecycle-prisma.ts"));
  const userId = randomUUID(), stranger = randomUUID();
  await prisma.user.createMany({ data: [userId, stranger].map(id => ({ id, email: `${id}@example.invalid`, nickname: "临时记忆验收" })) });
  const companion = await prisma.companion.create({ data: { userId, name: "临时人物", relationshipKind: "FRIEND", speakingStyle: "自然", personality: [] } });
  const make = (content, status = "ACTIVE") => prisma.memory.create({ data: { userId, companionId: companion.id, content, type: "USER_FACT", status } });
  const old = await make("正在准备面试"), next = await make("已经入职", "PENDING");
  const change = { action: "supersede", expectedUpdatedAt: old.updatedAt.toISOString(), replacementId: next.id, replacementUpdatedAt: next.updatedAt.toISOString() };
  step = "supersede and reconnect";
  await applyPrismaMemoryChange(prisma, userId, old.id, change);
  await prisma.$disconnect(); prisma = client();
  assert.equal((await prisma.memory.findUnique({ where: { id: old.id } })).status, "ARCHIVED");
  assert.equal((await prisma.memory.findUnique({ where: { id: next.id } })).status, "ACTIVE");
  assert.equal((await readPrismaMemoryHistory(prisma, userId, old.id)).items[0].before.content, "正在准备面试");
  assert.equal(await prisma.memoryRevision.count({ where: { userId } }), 2);
  console.log("ok - source facts and history persist after reconnect");
  step = "ownership and stale versions";
  await assert.rejects(readPrismaMemoryHistory(prisma, stranger, old.id), error => error.status === 404);
  await assert.rejects(applyPrismaMemoryChange(prisma, userId, old.id, { action: "edit", expectedUpdatedAt: old.updatedAt.toISOString(), content: "stale" }), error => error.status === 409);
  await assert.rejects(applyPrismaMemoryChange(prisma, userId, old.id, { action: "edit", status: "active" }), error => error.status === 409);
  console.log("ok - foreign access, stale writes and accidental restore are blocked");
  step = "real transaction rollback";
  const a = await make("rollback-old"), b = await make("rollback-next", "PENDING");
  const sabotage = { $transaction: (run, options) => prisma.$transaction(tx => run(new Proxy(tx, { get(target, property) {
    return property === "memoryRevision" ? { createMany: async () => { throw new Error("fixture-audit-failure"); } } : Reflect.get(target, property);
  } })), options) };
  await assert.rejects(applyPrismaMemoryChange(sabotage, userId, a.id, { action: "supersede", expectedUpdatedAt: a.updatedAt.toISOString(), replacementId: b.id, replacementUpdatedAt: b.updatedAt.toISOString() }));
  assert.equal((await prisma.memory.findUnique({ where: { id: a.id } })).status, "ACTIVE");
  assert.equal((await prisma.memory.findUnique({ where: { id: b.id } })).status, "PENDING");
  console.log("ok - failed audit really rolls back both database updates");
  step = "two-client CAS";
  peer = client(); const race = await make("race-original");
  const results = await Promise.allSettled([prisma, peer].map((db, index) => applyPrismaMemoryChange(db, userId, race.id, { action: "edit", expectedUpdatedAt: race.updatedAt.toISOString(), content: `winner-${index}` })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.status, 409);
  assert.equal(await prisma.memoryRevision.count({ where: { memoryId: race.id } }), 1);
  console.log("ok - concurrent devices accept one version without lost updates");
  step = "concurrent export and forget";
  const exportedMemory = await make("export-before");
  await applyPrismaMemoryChange(prisma, userId, exportedMemory.id, { action: "edit", content: "export-after" });
  let interleaved = false;
  const exportDuringForget = { $transaction: (run, options) => prisma.$transaction(tx => run(new Proxy(tx, { get(target, property) {
    return property === "memory" ? { findMany: async args => {
      const rows = await target.memory.findMany(args);
      await applyPrismaMemoryChange(peer, userId, exportedMemory.id, { action: "edit", status: "deleted" });
      interleaved = true;
      return rows;
    } } : Reflect.get(target, property);
  } })), options) };
  const concurrentSnapshot = await readPrismaMemoryExportSnapshot(exportDuringForget, userId);
  assert.equal(interleaved, true);
  assert.equal(concurrentSnapshot.memories.find(row => row.id === exportedMemory.id).content, "export-after");
  assert.equal(concurrentSnapshot.revisions.find(row => row.memoryId === exportedMemory.id).after.content, "export-after");
  const afterForget = await readPrismaMemoryExportSnapshot(prisma, userId);
  assert.equal(afterForget.memories.some(row => row.id === exportedMemory.id), false);
  assert.equal(afterForget.revisions.some(row => row.memoryId === exportedMemory.id), false);
  assert.equal(JSON.stringify(await readPrismaMemoryExportSnapshot(prisma, stranger)).includes("export-after"), false);
  console.log("ok - concurrent export is one consistent point in time; fresh exports exclude forgotten history");
  step = "forget and cascade";
  await applyPrismaMemoryChange(prisma, userId, old.id, { action: "edit", status: "deleted" });
  assert.equal((await prisma.memory.findUnique({ where: { id: old.id } })).content, "[已遗忘]");
  assert.equal((await readPrismaMemoryHistory(prisma, userId, old.id)).items.length, 0);
  await prisma.user.delete({ where: { id: userId } });
  assert.equal(await prisma.memoryRevision.count({ where: { userId } }), 0);
  console.log("ok - forgotten history purged and account deletion cascades");
} catch (error) {
  console.error(`Memory PostgreSQL QA failed at ${step}; code=${typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "none"}.`); process.exitCode = 1;
} finally {
  await peer?.$disconnect(); await prisma.$disconnect();
  if (created) { assert.match(schema, /^renewal_memory_qa_[a-f0-9]{32}$/); await bootstrap.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); console.log("ok - own temporary schema removed"); }
  await bootstrap.$disconnect();
}
