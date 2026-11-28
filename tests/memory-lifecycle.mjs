import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const context = vm.createContext({ structuredClone });
const modules = new Map();
function load(name, parent = resolve(root, "entry.ts")) {
  if (name === "node:crypto") return { randomUUID };
  const path = name.startsWith("@/") ? resolve(root, name.slice(2) + ".ts") : resolve(dirname(parent), name + ".ts");
  assert.ok(path.startsWith(root));
  if (modules.has(path)) return modules.get(path).exports;
  const compiledModule = { exports: {} }; modules.set(path, compiledModule);
  const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new vm.Script(`(function(exports,require,module){${output}\n})`, { filename: path }).runInContext(context)(compiledModule.exports, child => load(child, path), compiledModule);
  return compiledModule.exports;
}
const { planMemoryChange, applyMemoryChangeInStore, memoryRevisionStore, clearMemoryHistory, readMemoryExportSnapshotInStore } = load("@/lib/memory/lifecycle");
const { applyPrismaMemoryChange } = load("@/lib/memory/lifecycle-prisma");
const plain = value => JSON.parse(JSON.stringify(value));
const stamp = "2026-11-17T10:00:00.000Z";
const memory = (id, extra = {}) => ({ id, userId: "u", companionId: "c", sourceMessageId: `source-${id}`, type: "user_fact", status: "active", content: id === "old" ? "我正在准备面试" : "我已经入职", confidence: .8, createdAt: stamp, updatedAt: stamp, supersededById: null, ...extra });
const replace = { action: "supersede", expectedUpdatedAt: stamp, replacementId: "next", replacementUpdatedAt: stamp };
let sequence = 0;
const id = () => `revision-${++sequence}`;
const rejectsStatus = (run, status) => assert.throws(run, error => error.status === status);

test("superseding preserves source and old content, accepts new fact, and plans without mutation", () => {
  const source = [memory("old"), memory("next", { status: "pending" })], before = plain(source);
  const result = planMemoryChange(source, "u", "old", replace, id, Date.parse(stamp));
  assert.deepEqual(plain(source), before);
  assert.equal(result.memories[0].status, "archived");
  assert.equal(result.memories[0].supersededById, "next");
  assert.equal(result.memories[0].content, before[0].content);
  assert.equal(result.memories[1].status, "active");
  assert.equal(result.memories[1].sourceMessageId, "source-next");
  assert.equal(result.revisions.length, 2);
  assert.ok(result.revisions.every(row => row.before.id === row.after.id && row.memoryId === row.before.id));
  assert.ok(result.memories.every(row => Date.parse(row.updatedAt) > Date.parse(stamp)));
});

test("both versions, owner, companion, and distinct target are checked before any write", () => {
  const rows = [memory("old"), memory("next", { status: "pending" })], before = plain(rows);
  for (const change of [{ ...replace, expectedUpdatedAt: "2020-01-01" }, { ...replace, replacementUpdatedAt: "2020-01-01" }, { ...replace, replacementId: "old" }]) rejectsStatus(() => planMemoryChange(rows, "u", "old", change, id), 409);
  rejectsStatus(() => planMemoryChange(rows, "stranger", "old", replace, id), 404);
  for (const extra of [{ userId: "stranger" }, { companionId: "other" }, { status: "deleted" }]) rejectsStatus(() => planMemoryChange([rows[0], memory("next", extra)], "u", "old", replace, id), 404);
  rejectsStatus(() => planMemoryChange(rows, "u", "old", { ...replace, expectedUpdatedAt: "bad" }, id), 400);
  assert.deepEqual(plain(rows), before);
});

test("normal correction and status changes keep history; equal edits do not fabricate a version", () => {
  clearMemoryHistory("u");
  const rows = [memory("old")];
  applyMemoryChangeInStore(rows, "u", "old", { action: "edit", expectedUpdatedAt: stamp, content: "我已经入职" }, id);
  assert.equal(memoryRevisionStore().length, 1);
  assert.equal(memoryRevisionStore()[0].before.content, "我正在准备面试");
  const version = rows[0].updatedAt;
  applyMemoryChangeInStore(rows, "u", "old", { action: "edit", expectedUpdatedAt: version, content: rows[0].content }, id);
  assert.equal(rows[0].updatedAt, version);
  assert.equal(memoryRevisionStore().length, 1);
  rejectsStatus(() => applyMemoryChangeInStore(rows, "u", "old", { action: "edit", expectedUpdatedAt: stamp, status: "archived" }, id), 409);
});

test("superseded facts cannot be restored accidentally but explicit reverse replacement is possible", () => {
  const rows = [memory("old"), memory("next", { status: "pending" })];
  applyMemoryChangeInStore(rows, "u", "old", replace, id);
  rejectsStatus(() => applyMemoryChangeInStore(rows, "u", "old", { action: "edit", status: "active" }, id), 409);
  applyMemoryChangeInStore(rows, "u", "next", { action: "supersede", expectedUpdatedAt: rows[1].updatedAt, replacementId: "old", replacementUpdatedAt: rows[0].updatedAt }, id);
  assert.equal(rows[0].status, "active"); assert.equal(rows[0].supersededById, null);
  assert.equal(rows[1].status, "archived"); assert.equal(rows[1].supersededById, "old");
});

test("forgetting purges that subject's history and content and cannot restore it", () => {
  clearMemoryHistory("u");
  const rows = [memory("old")];
  applyMemoryChangeInStore(rows, "u", "old", { action: "edit", content: "sensitive-personal-fact" }, id);
  applyMemoryChangeInStore(rows, "u", "old", { action: "edit", status: "deleted" }, id);
  assert.equal(rows[0].content, "[已遗忘]"); assert.equal(rows[0].sourceMessageId, null);
  assert.equal(memoryRevisionStore().length, 0);
  rejectsStatus(() => applyMemoryChangeInStore(rows, "u", "old", { action: "edit", status: "active" }, id), 409);
  applyMemoryChangeInStore(rows, "u", "old", { action: "edit", status: "deleted" }, id);
  assert.equal(memoryRevisionStore().length, 0);
});

test("memory export snapshots facts and history together and excludes forgotten, foreign and orphan rows", () => {
  clearMemoryHistory("u"); clearMemoryHistory("other");
  const rows = [memory("old"), memory("next"), memory("foreign", { userId: "other" })];
  applyMemoryChangeInStore(rows, "u", "old", { action: "edit", content: "新的事实" }, id);
  const revision = memoryRevisionStore()[0];
  memoryRevisionStore().push({ ...structuredClone(revision), id: "orphan", memoryId: "missing" }, { ...structuredClone(revision), id: "foreign-history", userId: "other" });
  const snapshot = readMemoryExportSnapshotInStore(rows, "u");
  assert.equal(snapshot.memories.length, 2);
  assert.equal(snapshot.revisions.length, 1);
  applyMemoryChangeInStore(rows, "u", "old", { action: "edit", status: "deleted" }, id);
  assert.equal(snapshot.revisions[0].after.content, "新的事实", "already taken snapshot remains an immutable point in time");
  const afterForget = readMemoryExportSnapshotInStore(rows, "u");
  assert.deepEqual(plain(afterForget.memories.map(row => row.id)), ["next"]);
  assert.equal(afterForget.revisions.length, 0);
});

function database({ failLog = false, failSecond = false } = {}) {
  let state = { memories: [memory("old"), memory("next", { status: "pending" })], history: [] };
  const db = { get state() { return plain(state); }, async $transaction(run, options) {
    assert.equal(options.isolationLevel, "Serializable");
    const copy = structuredClone(state); let updates = 0;
    const result = await run({ memory: {
      findMany: async ({ where }) => copy.memories.filter(row => row.userId === where.userId && where.id.in.includes(row.id)).map(row => ({ ...row, status: row.status.toUpperCase(), type: row.type.toUpperCase(), createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) })),
      updateMany: async ({ where, data }) => {
        updates++; if (failSecond && updates === 2) return { count: 0 };
        const row = copy.memories.find(row => row.id === where.id && row.userId === where.userId && Date.parse(row.updatedAt) === where.updatedAt.getTime());
        if (!row) return { count: 0 };
        Object.assign(row, data, { status: data.status.toLowerCase(), type: data.type.toLowerCase(), updatedAt: data.updatedAt.toISOString() }); return { count: 1 };
      }
    }, memoryRevision: {
      deleteMany: async ({ where }) => { copy.history = copy.history.filter(row => row.userId !== where.userId || !where.memoryId.in.includes(row.memoryId)); },
      createMany: async ({ data }) => { if (failLog) throw new Error("fixture-history-write-failed"); copy.history.push(...data); }
    } });
    state = copy; return result;
  } };
  return db;
}

test("Prisma path rolls back both memories if the second CAS or audit write fails", async () => {
  for (const options of [{ failSecond: true }, { failLog: true }]) {
    const db = database(options), before = db.state;
    await assert.rejects(applyPrismaMemoryChange(db, "u", "old", replace));
    assert.deepEqual(db.state, before);
  }
});

test("Prisma path commits the pair and both histories together, then purges only forgotten subject", async () => {
  const db = database();
  await applyPrismaMemoryChange(db, "u", "old", replace);
  assert.equal(db.state.history.length, 2);
  assert.equal(db.state.memories.filter(row => row.status === "active").length, 1);
  await applyPrismaMemoryChange(db, "u", "old", { action: "edit", status: "deleted" });
  assert.equal(db.state.history.length, 1);
  assert.equal(db.state.history[0].memoryId, "next");
  assert.ok(!JSON.stringify(db.state).includes("我正在准备面试"));
});
