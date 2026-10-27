import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const now = new Date("2026-10-26T08:00:00.000Z");
const old = "2026-10-25T08:00:00.000Z";
const plain = (value) => JSON.parse(JSON.stringify(value));
const ids = (result) => Array.from(result.results, (row) => row.companionId);

// Load actual scheduler, draft generator, repositories and fallback wrapper.
// Only external I/O is replaced: no environment files, credentials or live DB.
function fixture(count = 7, mode = "prisma") {
  const store = {
    companions: [], conversations: [], messages: [], memories: [],
    proactiveMessages: [], relationshipStates: []
  };
  for (let i = 0; i < count; i += 1) {
    const id = `c${String(i).padStart(3, "0")}`;
    store.companions.unshift({
      id, userId: "u1", name: `Companion ${i}`, relationshipKind: "FRIEND",
      customKind: null, userAddress: null, companionAddress: null,
      personality: [], speakingStyle: "温柔", background: null, boundaries: null,
      immersionEnabled: true, proactiveMessagesEnabled: true,
      proactiveFrequencyPreset: "1m", proactiveFrequencyMinutes: 1,
      createdAt: old, updatedAt: old
    });
    store.conversations.push({
      id: `conversation-${id}`, userId: "u1", companionId: id, title: null,
      createdAt: old, updatedAt: old, lastMessageAt: null
    });
    store.relationshipStates.push({
      id: `state-${id}`, companionId: id, familiarityScore: 0, closenessScore: 0,
      recentEmotion: null, importantEvents: [], lastInteractionAt: old,
      explanation: null, createdAt: old, updatedAt: old
    });
  }
  return {
    store, mode, checkpoints: new Map(), checkpointWrites: [], queries: [],
    profiles: new Map(), profileReads: [], failPrimary: false
  };
}

function load(db) {
  const context = vm.createContext({
    console: { warn() {} }, process: { env: {} }, Date, Map, Set,
    renewalStore: db.store
  });
  const cache = new Map();
  const dates = (row) => ({
    ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt)
  });
  const dbProfile = (row) => row && ({
    ...dates(row),
    conversations: db.store.conversations.filter((c) => c.companionId === row.id).map(dates),
    relationshipState: (() => {
      const state = db.store.relationshipStates.find((s) => s.companionId === row.id);
      return { ...dates(state), lastInteractionAt: state.lastInteractionAt && new Date(state.lastInteractionAt) };
    })(),
    memories: []
  });
  const prisma = {
    async $queryRaw(strings, scope) {
      if (db.checkpointReadError) throw db.checkpointReadError;
      assert.match(strings.join("?"), /SELECT "cursor" FROM "ProactiveSchedulerCheckpoint"/);
      return db.checkpoints.has(scope) ? [{ cursor: db.checkpoints.get(scope) }] : [];
    },
    async $executeRaw(strings, scope, cursor, expectedCursor) {
      if (db.checkpointWriteError) throw db.checkpointWriteError;
      await db.beforeCheckpointWrite?.(cursor);
      assert.match(strings.join("?"), /ON CONFLICT \("scope"\) DO UPDATE/);
      assert.match(strings.join("?"), /IS NOT DISTINCT FROM/);
      if (db.checkpoints.has(scope) && db.checkpoints.get(scope) !== expectedCursor) return 0;
      db.checkpointWrites.push({ scope, cursor });
      db.checkpoints.set(scope, cursor);
      return 1;
    },
    user: { async findUnique({ where }) { return { id: where.id }; } },
    companion: {
      async findMany(query) {
        db.queries.push(plain(query));
        if (db.failPrimary) throw Object.assign(new Error("test database unavailable"), { code: "P1001" });
        assert.deepEqual(plain(query.orderBy), { id: "asc" });
        assert.equal(query.where.proactiveMessagesEnabled, true);
        if (query.take !== undefined) assert.ok(query.take >= 1 && query.take <= 100);
        return db.store.companions.filter((row) =>
          row.proactiveMessagesEnabled &&
          (!query.where.userId || row.userId === query.where.userId) &&
          (!query.where.id || row.id > query.where.id.gt)
        ).sort((a, b) => a.id < b.id ? -1 : 1).slice(0, query.take).map(dbProfile);
      },
      async findFirst({ where }) {
        return dbProfile(db.store.companions.find((c) => c.id === where.id && c.userId === where.userId));
      }
    },
    conversation: {
      async findFirst({ where }) {
        const row = db.store.conversations.find((c) => c.id === where.id && c.userId === where.userId);
        return row ? dates(row) : null;
      }
    },
    message: { async findMany() { return []; } },
    proactiveMessage: {
      async findMany({ where }) {
        return db.store.proactiveMessages.filter((m) => m.userId === where.userId && m.companionId === where.companionId)
          .map((m) => ({ ...dates(m), status: m.status.toUpperCase(), scheduledAt: m.scheduledAt && new Date(m.scheduledAt) }));
      },
      async create({ data }) {
        const row = {
          ...data, id: `draft-${db.store.proactiveMessages.length}`,
          createdAt: now.toISOString(), updatedAt: now.toISOString(),
          scheduledAt: data.scheduledAt?.toISOString() ?? null, status: data.status.toLowerCase()
        };
        db.store.proactiveMessages.push(row);
        return { ...dates(row), status: data.status, scheduledAt: data.scheduledAt };
      }
    }
  };
  const stubs = {
    "@prisma/client": nodeRequire("@prisma/client"),
    "@/lib/prisma": { prisma },
    "@/lib/users/profile": {
      async getUserProfile(userId) {
        db.profileReads.push(userId);
        return { proactiveMessagesEnabled: true, proactiveFrequencyHours: 24, ...db.profiles.get(userId) };
      }
    },
    "@/lib/persistence/memory-fallback": {
      shouldUseMemoryFallback: () => db.mode === "memory",
      shouldFallbackToMemoryOnPrismaError: (error) => db.failPrimary && error.code === "P1001"
    }
  };
  function moduleAt(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    // Relationship evolution is unrelated to scans and must never run here.
    if (filename.endsWith("relationship-state-adapter.ts")) {
      return { updateRelationshipRecordAfterMessage() { throw new Error("Unexpected relationship mutation"); } };
    }
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const source = readFileSync(filename, "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    });
    const require = (specifier) => {
      if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
      const base = specifier.startsWith("@/")
        ? path.join(root, "src", specifier.slice(2))
        : path.resolve(path.dirname(filename), specifier);
      assert.ok(specifier.startsWith("@/") || specifier.startsWith("."), `Unexpected import ${specifier}`);
      return moduleAt(`${base}.ts`);
    };
    new vm.Script(`(function(require,module,exports){${outputText}\n})`, { filename })
      .runInContext(context)(require, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  const scheduler = moduleAt(path.join(root, "src/lib/relationship/proactive-scheduler.ts"));
  const repositories = moduleAt(path.join(root, "src/lib/renewal/repository.ts"));
  return { run: (input = {}) => scheduler.runProactiveScheduler({ now, ...input }), repository: repositories.createRenewalRepository() };
}

for (const mode of ["memory", "prisma"]) {
  test(`${mode}: cold scans pass a not-due first page and cover more than limit`, async () => {
    const db = fixture(7, mode);
    for (const state of db.store.relationshipStates.slice(0, 2)) state.lastInteractionAt = now.toISOString();
    const first = await load(db).run({ dryRun: false, limit: 2 });
    assert.deepEqual(ids(first), ["c000", "c001"]);
    assert.equal(first.generatedCount, 0);
    const seen = [...ids(first)];
    for (let i = 0; i < 3; i += 1) {
      const result = await load(db).run({ dryRun: false, limit: 2 });
      assert.ok(result.scannedCount <= 2);
      seen.push(...ids(result));
    }
    assert.deepEqual(seen, Array.from({ length: 7 }, (_, i) => `c00${i}`));
    assert.equal(db.store.proactiveMessages.length, 10);
    assert.equal((await load(db).run({ dryRun: false, limit: 2 })).results[0].companionId, "c000");
  });

  test(`${mode}: globally disabled first page still advances`, async () => {
    const db = fixture(5, mode);
    db.store.companions.filter((c) => c.id < "c002").forEach((c) => { c.userId = "disabled"; });
    db.store.conversations.filter((c) => c.companionId < "c002").forEach((c) => { c.userId = "disabled"; });
    db.profiles.set("disabled", { proactiveMessagesEnabled: false });
    const first = await load(db).run({ dryRun: false, limit: 2 });
    assert.equal(first.skippedCount, 2);
    assert.equal(first.savedCount, 0);
    assert.ok(first.results.every((r) => r.reason === "主动回响已关闭。"));
    assert.equal(db.profileReads.length, 1, "profile reads are cached per user within a run");
    assert.deepEqual(ids(await load(db).run({ dryRun: false, limit: 2 })), ["c002", "c003"]);
  });

  test(`${mode}: dry runs neither save drafts nor advance the live checkpoint`, async () => {
    const db = fixture(5, mode);
    const app = load(db);
    const before = JSON.stringify(db.store);
    const preview = await app.run({ limit: 2 });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.savedCount, 0);
    assert.equal(preview.nextCursor, "c001");
    assert.equal(JSON.stringify(db.store), before);
    assert.equal(db.checkpointWrites.length, 0);
    assert.deepEqual(ids(await app.run({ dryRun: false, limit: 2 })), ids(preview));
    const writes = db.checkpointWrites.length;
    const next = await load(db).run({ dryRun: true, limit: 2 });
    assert.deepEqual(ids(next), ["c002", "c003"]);
    assert.equal(db.checkpointWrites.length, writes);
    assert.deepEqual(ids(await load(db).run({ dryRun: false, limit: 2 })), ids(next));
  });

  test(`${mode}: maxDrafts resumes after the last examined row, not the fetched page`, async () => {
    const db = fixture(5, mode);
    const seen = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await load(db).run({ dryRun: false, limit: 4, maxDrafts: 1 });
      assert.equal(result.scannedCount, 1);
      assert.equal(result.generatedCount, 1);
      assert.equal(result.savedCount, 1);
      assert.equal(result.results.length, 1);
      seen.push(...ids(result));
    }
    assert.deepEqual(seen, ["c000", "c001", "c002", "c003", "c004"]);
  });

  test(`${mode}: deleted cursor, changing updatedAt, new rows and companion opt-outs`, async () => {
    const db = fixture(6, mode);
    await load(db).run({ dryRun: false, limit: 2 });
    db.store.companions = db.store.companions.filter((c) => c.id !== "c001");
    db.store.companions.find((c) => c.id === "c002").proactiveMessagesEnabled = false;
    db.store.companions.find((c) => c.id === "c005").updatedAt = "2099-01-01T00:00:00.000Z";
    const template = db.store.companions.find((c) => c.id === "c000");
    db.store.companions.push({ ...template, id: "b-new" });
    db.store.conversations.push({ ...db.store.conversations[0], id: "conversation-new", companionId: "b-new" });
    db.store.relationshipStates.push({ ...db.store.relationshipStates[0], id: "state-new", companionId: "b-new" });
    assert.deepEqual(ids(await load(db).run({ dryRun: false, limit: 2 })), ["c003", "c004"]);
    assert.deepEqual(ids(await load(db).run({ dryRun: false, limit: 2 })), ["c005"]);
    assert.deepEqual(ids(await load(db).run({ dryRun: false, limit: 2 })), ["b-new", "c000"]);
  });

  test(`${mode}: exact-sized tail wraps with bounded queries and handles empty scope`, async () => {
    const db = fixture(4, mode);
    await load(db).run({ dryRun: false, limit: 2 });
    await load(db).run({ dryRun: false, limit: 2 });
    const before = db.queries.length;
    assert.deepEqual(ids(await load(db).run({ dryRun: false, limit: 2 })), ["c000", "c001"]);
    if (mode === "prisma") assert.equal(db.queries.length - before, 2);
    db.store.companions.forEach((c) => { c.proactiveMessagesEnabled = false; });
    const empty = await load(db).run({ dryRun: false, limit: 2 });
    assert.equal(empty.scannedCount, 0);
    assert.equal(empty.nextCursor, null);
  });

  test(`${mode}: current-user scans are isolated from the all-user checkpoint`, async () => {
    const db = fixture(5, mode);
    const app = load(db);
    await app.run({ dryRun: false, limit: 2 });
    const before = db.checkpointWrites.length;
    assert.deepEqual(ids(await app.run({ userId: "u1", limit: 1 })), ["c000"]);
    assert.deepEqual(ids(await app.run({ userId: "u1", dryRun: false, limit: 1 })), ["c000"]);
    assert.deepEqual(ids(await app.run({ userId: "u1", limit: 1 })), ["c001"]);
    assert.equal(db.checkpointWrites.length, before);
    assert.equal((await app.run({ userId: "other", dryRun: false, limit: 2 })).scannedCount, 0);
    assert.deepEqual(ids(await load(db).run({ dryRun: false, limit: 2 })), ["c002", "c003"]);
  });
}

test("scan and draft limits stay clamped at the repository boundary", async () => {
  const db = fixture(205);
  db.store.relationshipStates.forEach((s) => { s.lastInteractionAt = now.toISOString(); });
  assert.equal((await load(db).run({ limit: Infinity })).scannedCount, 20);
  const large = await load(db).run({ limit: 1000, maxDrafts: 1000 });
  assert.equal(large.scannedCount, 100);
  assert.equal(large.maxDrafts, 200);
  const small = await load(db).run({ limit: -2, maxDrafts: -3 });
  assert.equal(small.scannedCount, 1);
  assert.equal(small.maxDrafts, 1);
  assert.equal((await load(db).run({ limit: 2.9, maxDrafts: NaN })).scannedCount, 2);
  assert.equal(db.checkpointWrites.length, 0);
});

test("default all-user cron scans traverse 45 companions across cold starts", async () => {
  const db = fixture(45);
  db.store.relationshipStates.slice(0, 20).forEach((s) => { s.lastInteractionAt = now.toISOString(); });
  const first = await load(db).run({ dryRun: false });
  assert.equal(first.scannedCount, 20);
  assert.equal(first.savedCount, 0);
  assert.equal(db.checkpoints.get("all"), "c019");
  const second = await load(db).run({ dryRun: false });
  assert.equal(second.scannedCount, 20);
  assert.equal(second.savedCount, 40);
  const third = await load(db).run({ dryRun: false });
  assert.equal(third.scannedCount, 5);
  assert.equal(third.savedCount, 10);
  assert.equal(db.checkpoints.get("all"), null);
  assert.equal(new Set([...ids(first), ...ids(second), ...ids(third)]).size, 45);
  assert.ok(db.queries.every((query) => query.take === 20));
});

test("checkpoint failures propagate rather than silently using a process cursor", async () => {
  const db = fixture(3);
  db.checkpointReadError = new Error("checkpoint read unavailable");
  await assert.rejects(load(db).run({ dryRun: false, limit: 1 }), /checkpoint read unavailable/);
  assert.equal(db.queries.length, 0);
  delete db.checkpointReadError;
  db.checkpointWriteError = new Error("checkpoint write unavailable");
  await assert.rejects(load(db).run({ dryRun: false, limit: 1 }), /checkpoint write unavailable/);
  assert.equal(db.store.proactiveMessages.length, 2);
  assert.equal(db.checkpoints.size, 0);
  delete db.checkpointWriteError;
  const retry = await load(db).run({ dryRun: false, limit: 1 });
  assert.deepEqual(ids(retry), ["c000"]);
  assert.equal(retry.generatedCount, 0, "saved drafts still suppress duplicates after a failed checkpoint write");
  assert.equal(db.checkpoints.get("all"), "c000");
  assert.deepEqual(ids(await load(db).run({ dryRun: false, limit: 1 })), ["c001"]);
});

test("a slower overlapping scan cannot move the durable checkpoint backwards", async () => {
  const db = fixture(5);
  db.store.relationshipStates.forEach((s) => { s.lastInteractionAt = now.toISOString(); });
  let releaseSlow;
  const gate = new Promise((resolve) => { releaseSlow = resolve; });
  db.beforeCheckpointWrite = async (cursor) => { if (cursor === "c000") await gate; };
  const slow = load(db).run({ dryRun: false, limit: 1 });
  const faster = await load(db).run({ dryRun: false, limit: 2 });
  assert.equal(faster.nextCursor, "c001");
  releaseSlow();
  await slow;
  assert.equal(db.checkpoints.get("all"), "c001");
  delete db.beforeCheckpointWrite;
  assert.deepEqual(ids(await load(db).run({ dryRun: false, limit: 2 })), ["c002", "c003"]);
});

test("explicit dry-run continuation survives reloads without mutating the live cursor", async () => {
  const db = fixture(5);
  const first = await load(db).run({ limit: 2 });
  const second = await load(db).run({ limit: 2, cursor: first.nextCursor });
  assert.deepEqual(ids(second), ["c002", "c003"]);
  assert.deepEqual(ids(await load(db).run({ limit: 2, cursor: null })), ["c000", "c001"]);
  assert.equal(db.checkpoints.size, 0);
});

test("fallback repository forwards the exclusive cursor to the memory repository", async () => {
  const db = fixture(5);
  db.failPrimary = true;
  const { repository } = load(db);
  const page = await repository.listCompanionsForProactive("u1", 2, "c001");
  assert.deepEqual(Array.from(page, (c) => c.id), ["c002", "c003"]);
  assert.equal(repository.persistence, "memory");
});
