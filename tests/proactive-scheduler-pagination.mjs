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
const generation = {
  intent: "interest", length: "short", memoryIds: ["fixture-memory-1"],
  topicKey: "memory:fixture-memory-1", attempts: 1, actualChars: 20
};

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
    profiles: new Map(), profileReads: [], personalizations: [], personalizationResults: new Map(), failPrimary: false,
    transactionTail: Promise.resolve(), deliveryTransactions: 0
  };
}

function load(db) {
  class FixtureDate extends Date {
    constructor(value = now) { super(value); }
    static now() { return now.getTime(); }
  }
  const context = vm.createContext({
    console: { warn() {} }, process: { env: {} }, Date: FixtureDate, Map, Set,
    renewalStore: db.store, __perpetualRenewalFallbackProfiles: db.profiles
  });
  const cache = new Map();
  const dates = (row) => ({
    ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt),
    ...(Object.hasOwn(row, "lastMessageAt") ? { lastMessageAt: row.lastMessageAt && new Date(row.lastMessageAt) } : {})
  });
  const proactiveRow = (row) => row && ({
    ...dates(row), status: row.status.toUpperCase(),
    scheduledAt: row.scheduledAt && new Date(row.scheduledAt)
  });
  const messageRow = (row) => row && ({ ...row, role: row.role.toUpperCase(), createdAt: new Date(row.createdAt) });
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
    proactiveSchedulerCheckpoint: {
      async findUnique({ where, select }) {
        if (db.checkpointReadError) throw db.checkpointReadError;
        assert.deepEqual(plain(select), { cursor: true });
        return db.checkpoints.has(where.scope) ? { cursor: db.checkpoints.get(where.scope) } : null;
      },
      createMany({ data, skipDuplicates }) {
        assert.equal(skipDuplicates, true);
        assert.equal(data.length, 1);
        return () => {
          if (db.checkpointWriteError) throw db.checkpointWriteError;
          const { scope, cursor } = data[0];
          if (db.checkpoints.has(scope)) return { count: 0 };
          db.checkpoints.set(scope, cursor);
          return { count: 1 };
        };
      },
      updateMany({ where, data }) {
        const operation = () => {
          if (db.checkpointUpdateError) throw db.checkpointUpdateError;
          if (!db.checkpoints.has(where.scope) || db.checkpoints.get(where.scope) !== where.cursor) return { count: 0 };
          db.checkpointWrites.push({ scope: where.scope, cursor: data.cursor });
          db.checkpoints.set(where.scope, data.cursor);
          return { count: 1 };
        };
        operation.cursor = data.cursor;
        return operation;
      }
    },
    async $transaction(operations, options) {
      const interactive = typeof operations === "function";
      if (interactive) {
        assert.equal(options.isolationLevel, "Serializable");
        db.deliveryTransactions += 1;
      } else assert.equal(operations.length, 2);
      // Delay before acquiring the mock transaction's atomic section so a
      // competing scan can commit while this writer is waiting.
      if (!interactive) await db.beforeCheckpointWrite?.(operations[1].cursor);
      const previous = db.transactionTail;
      let release;
      db.transactionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      const before = new Map(db.checkpoints);
      const writes = db.checkpointWrites.length;
      const store = plain(db.store);
      try {
        return interactive ? await operations(prisma) : operations.map((operation) => operation());
      } catch (error) {
        db.checkpoints = before;
        db.checkpointWrites.length = writes;
        Object.assign(db.store, store);
        throw error;
      } finally {
        release();
      }
    },
    user: { async findUnique({ where }) {
      return { id: where.id, proactiveMessagesEnabled: db.profiles.get(where.id)?.proactiveMessagesEnabled ?? true };
    } },
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
        const row = db.store.conversations.filter((c) =>
          (!where.id || c.id === where.id) && c.userId === where.userId &&
          (!where.companionId || c.companionId === where.companionId)
        ).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
        return row ? dates(row) : null;
      },
      async update({ where, data }) {
        const row = db.store.conversations.find((c) => c.id === where.id);
        row.lastMessageAt = data.lastMessageAt.toISOString();
        row.updatedAt = now.toISOString();
        return dates(row);
      }
    },
    message: {
      async findMany({ where }) {
        return db.store.messages.filter((m) => m.conversationId === where.conversationId).map(messageRow);
      },
      async findUnique({ where }) {
        return messageRow(db.store.messages.find((m) => m.proactiveMessageId === where.proactiveMessageId)) ?? null;
      },
      async create({ data }) {
        assert.ok(!db.store.messages.some((m) => m.proactiveMessageId === data.proactiveMessageId), "unique proactive message link");
        const row = { ...data, id: `message-${db.store.messages.length}`, role: data.role.toLowerCase(),
          metadata: null, createdAt: now.toISOString() };
        db.store.messages.push(row);
        return messageRow(row);
      }
    },
    proactiveMessage: {
      async findMany({ where }) {
        return db.store.proactiveMessages.filter((m) => m.userId === where.userId && m.companionId === where.companionId)
          .map(proactiveRow);
      },
      async findFirst({ where }) {
        return proactiveRow(db.store.proactiveMessages.find((m) => m.id === where.id && m.userId === where.userId &&
          db.store.companions.some((c) => c.id === m.companionId && c.userId === where.companion.userId))) ?? null;
      },
      async findUnique({ where }) {
        return proactiveRow(db.store.proactiveMessages.find((m) => m.deliveryKey === where.deliveryKey)) ?? null;
      },
      async create({ data }) {
        if (data.deliveryKey && db.store.proactiveMessages.some((m) => m.deliveryKey === data.deliveryKey)) {
          throw Object.assign(new Error("Unique delivery key"), { code: "P2002" });
        }
        const row = {
          ...data, id: `draft-${db.store.proactiveMessages.length}`,
          createdAt: now.toISOString(), updatedAt: now.toISOString(),
          scheduledAt: data.scheduledAt?.toISOString() ?? null, status: data.status.toLowerCase()
        };
        db.store.proactiveMessages.push(row);
        return proactiveRow(row);
      },
      async update({ where, data }) {
        if (db.deliveryWriteError) throw db.deliveryWriteError;
        const row = db.store.proactiveMessages.find((m) => m.id === where.id && m.userId === where.userId);
        Object.assign(row, data, { status: data.status.toLowerCase(), updatedAt: now.toISOString() });
        return proactiveRow(row);
      }
    }
  };
  const stubs = {
    "node:crypto": nodeRequire("node:crypto"),
    "./proactive-model": {
      async personalizeProactiveDraft(companion, draft, history, provider, options) {
        db.personalizations.push({ companionId: companion.id, history: plain(history), provider,
          options: options && plain(options) });
        await db.beforePersonalize?.(companion);
        if (db.personalizationResults.has(companion.id)) return db.personalizationResults.get(companion.id);
        return { draft: { ...draft, content: `为 ${companion.name} 生成的问候。` }, source: "model", generation };
      }
    },
    "@prisma/client": nodeRequire("@prisma/client"),
    "@/lib/prisma": { prisma },
    "@/lib/users/profile": {
      async getUserProfile(userId) {
        db.profileReads.push(userId);
        return { proactiveMessagesEnabled: true, proactiveFrequencyHours: 24, timezone: "Asia/Shanghai", ...db.profiles.get(userId) };
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
    assert.equal(db.store.proactiveMessages.length, 5);
    assert.equal(db.store.messages.length, 5);
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
    assert.equal(first.deliveredCount, 0);
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
    assert.equal(preview.deliveredCount, 0);
    assert.equal(db.personalizations.length, 0, "dry runs must not invoke the model helper");
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
      assert.equal(result.deliveredCount, 1);
      assert.equal(result.results.length, 1);
      seen.push(...ids(result));
    }
    assert.deepEqual(seen, ["c000", "c001", "c002", "c003", "c004"]);
  });

  test(`${mode}: due cadence delivers one personalized assistant message and cold retries do not duplicate it`, async () => {
    const db = fixture(1, mode);
    db.profiles.set("u1", { timezone: "America/New_York" });
    const first = await load(db).run({ dryRun: false });
    assert.equal(first.generatedCount, 1);
    assert.equal(first.savedCount, 1);
    assert.equal(first.deliveredCount, 1);
    assert.equal(db.personalizations.length, 1);
    assert.equal(db.personalizations[0].provider, undefined);
    assert.deepEqual(db.personalizations[0].options, {
      previous: [], now: now.toISOString(), timeZone: "America/New_York"
    });
    const [draft] = db.store.proactiveMessages;
    const [message] = db.store.messages;
    assert.equal(draft.status, "sent");
    assert.match(draft.deliveryKey, /^[a-f0-9]{64}$/);
    assert.equal(draft.safety.generator, "model");
    assert.deepEqual(plain(draft.safety.generation), generation);
    assert.equal(message.role, "assistant");
    assert.equal(message.proactiveMessageId, draft.id);
    assert.equal(message.content, "为 Companion 0 生成的问候。");
    assert.equal(message.content, draft.content);
    assert.equal(message.conversationId, "conversation-c000");
    assert.equal(db.store.conversations[0].lastMessageAt, message.createdAt);
    const before = plain(db.store);
    const retry = await load(db).run({ dryRun: false });
    assert.equal(retry.generatedCount, 0);
    assert.equal(retry.savedCount, 0);
    assert.equal(retry.deliveredCount, 0);
    assert.deepEqual(plain(db.store), before);
    assert.equal(db.personalizations.length, 1);

    const next = await load(db).run({ dryRun: false, now: new Date(now.getTime() + 60_000) });
    assert.equal(next.deliveredCount, 1, "a new cadence can publish again");
    assert.equal(db.store.messages.length, 2);
    assert.equal(new Set(db.store.proactiveMessages.map((m) => m.deliveryKey)).size, 2);
    assert.equal(db.personalizations[1].history.length, 1, "the helper receives the prior delivered history");
    assert.deepEqual(db.personalizations[1].options, {
      previous: before.proactiveMessages, now: new Date(now.getTime() + 60_000).toISOString(),
      timeZone: "America/New_York"
    });
  });

  for (const reason of ["主动回响生成暂不可用，请稍后重试。", "主动回响未通过质量检查，请稍后重试。"]) {
    test(`${mode}: null generation saves and delivers nothing, exposes a safe reason and can retry (${reason})`, async () => {
      const db = fixture(1, mode);
      db.personalizationResults.set("c000", { draft: null, source: "unavailable", reason,
        generation: { ...generation, attempts: 2, rawPayload: "fixture-secret-provider-failure" } });
      const before = plain(db.store);
      const failed = await load(db).run({ dryRun: false });
      assert.equal(failed.savedCount, 0);
      assert.equal(failed.deliveredCount, 0);
      assert.equal(failed.results[0].savedCount, 0);
      assert.equal(failed.results[0].reason, reason);
      for (const [collection, records] of Object.entries(before)) {
        assert.deepEqual(plain(db.store[collection]), records, `failed generation must not mutate ${collection}`);
      }
      assert.doesNotMatch(JSON.stringify(failed), /fixture-secret|rawPayload|stack|authorization/);
      db.personalizationResults.delete("c000");
      const retry = await load(db).run({ dryRun: false });
      assert.equal(retry.savedCount, 1, "a failed generation must not leave a cadence anchor that suppresses retries");
      assert.equal(retry.deliveredCount, 1);
      assert.equal(db.store.proactiveMessages.length, 1);
      assert.equal(db.store.messages.length, 1);
    });
  }

  test(`${mode}: a failed companion does not prevent the next from generating or advancing pagination`, async () => {
    const db = fixture(3, mode);
    const reason = "主动回响生成暂不可用，请稍后重试。";
    db.personalizationResults.set("c000", { draft: null, source: "unavailable", reason });
    const result = await load(db).run({ dryRun: false, limit: 2 });
    assert.deepEqual(ids(result), ["c000", "c001"]);
    assert.deepEqual(db.personalizations.map((call) => call.companionId), ["c000", "c001"]);
    assert.equal(result.results[0].reason, reason);
    assert.equal(result.results[0].savedCount, 0);
    assert.equal(result.results[1].savedCount, 1);
    assert.equal(result.savedCount, 1);
    assert.equal(result.deliveredCount, 1);
    assert.deepEqual(db.store.proactiveMessages.map((record) => record.companionId), ["c001"]);
    assert.deepEqual(db.store.messages.map((message) => message.conversationId), ["conversation-c001"]);
    assert.equal(db.store.conversations.find((conversation) => conversation.companionId === "c000").lastMessageAt, null);
    assert.equal(result.nextCursor, "c001");
    assert.equal(await load(db).repository.getProactiveSchedulerCheckpoint("all"), "c001");
    assert.deepEqual(ids(await load(db).run({ dryRun: false, limit: 2 })), ["c002"]);
  });

  test(`${mode}: concurrent repository delivery and delivery-key retries retain one message`, async () => {
    const db = fixture(1, mode);
    const left = load(db).repository;
    const right = load(db).repository;
    const input = { deliveryKey: "same-cadence-key", kind: "DAILY_GREETING", content: "你好，星星亮了。" };
    const [a, b] = await Promise.all([
      left.createProactiveMessage("u1", "c000", input), right.createProactiveMessage("u1", "c000", input)
    ]);
    assert.equal(a.id, b.id);
    assert.equal(db.store.proactiveMessages.length, 1);
    const delivered = await Promise.all([
      left.deliverProactiveMessage("u1", a.id, { automatic: true }),
      right.deliverProactiveMessage("u1", b.id, { automatic: true })
    ]);
    assert.ok(delivered.every(Boolean));
    assert.equal(delivered[0].message.id, delivered[1].message.id);
    assert.equal(db.store.messages.length, 1);
    assert.equal(db.store.proactiveMessages[0].status, "sent");
    assert.equal(await left.deliverProactiveMessage("other-user", a.id, { automatic: true }), null);
    if (mode === "prisma") assert.ok(db.deliveryTransactions >= 3);
  });

  for (const optout of ["user", "companion"]) {
    test(`${mode}: ${optout} opt-out during personalization prevents automatic delivery`, async () => {
      const db = fixture(1, mode);
      db.beforePersonalize = () => {
        if (optout === "user") db.profiles.set("u1", { proactiveMessagesEnabled: false });
        else db.store.companions[0].proactiveMessagesEnabled = false;
      };
      const result = await load(db).run({ dryRun: false });
      assert.equal(result.generatedCount, 1);
      assert.equal(result.savedCount, 1);
      assert.equal(result.deliveredCount, 0);
      assert.equal(db.store.proactiveMessages[0].status, "draft");
      assert.equal(db.store.messages.length, 0);
      assert.equal(db.store.conversations[0].lastMessageAt, null);
      assert.equal((await load(db).run({ dryRun: false })).deliveredCount, 0);
      assert.equal(db.personalizations.length, 1, "disabled companions/users are not personalized on later scans");
    });
  }

  test(`${mode}: blocked and dismissed records cannot be delivered`, async () => {
    const db = fixture(1, mode);
    const { repository } = load(db);
    for (const status of ["blocked", "dismissed"]) {
      const draft = await repository.createProactiveMessage("u1", "c000", {
        kind: "DAILY_GREETING", content: "不应发布的草稿。", status
      });
      assert.equal(await repository.deliverProactiveMessage("u1", draft.id, { automatic: true }), null);
    }
    assert.equal(db.store.messages.length, 0);
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
  assert.equal(second.savedCount, 20);
  assert.equal(second.deliveredCount, 20);
  const third = await load(db).run({ dryRun: false });
  assert.equal(third.scannedCount, 5);
  assert.equal(third.savedCount, 5);
  assert.equal(third.deliveredCount, 5);
  assert.equal(db.store.messages.length, 25);
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
  assert.equal(db.store.proactiveMessages.length, 1);
  assert.equal(db.store.messages.length, 1);
  assert.equal(db.checkpoints.size, 0);
  delete db.checkpointWriteError;
  db.checkpointUpdateError = new Error("checkpoint update unavailable");
  await assert.rejects(load(db).run({ dryRun: false, limit: 1 }), /checkpoint update unavailable/);
  assert.equal(db.checkpoints.size, 0, "a failed CAS update rolls back missing-row initialization");
  delete db.checkpointUpdateError;
  const retry = await load(db).run({ dryRun: false, limit: 1 });
  assert.deepEqual(ids(retry), ["c000"]);
  assert.equal(retry.generatedCount, 0, "saved drafts still suppress duplicates after a failed checkpoint write");
  assert.equal(db.checkpoints.get("all"), "c000");
  assert.deepEqual(ids(await load(db).run({ dryRun: false, limit: 1 })), ["c001"]);
});

test("Prisma delivery failure rolls back message, conversation timestamp and sent status together", async () => {
  const db = fixture(1);
  const { repository } = load(db);
  const draft = await repository.createProactiveMessage("u1", "c000", {
    kind: "DAILY_GREETING", content: "星星亮了，来打个招呼。", deliveryKey: "atomic-delivery-key"
  });
  const before = plain(db.store);
  db.deliveryWriteError = new Error("sent-status write unavailable");
  await assert.rejects(repository.deliverProactiveMessage("u1", draft.id, { automatic: true }), /sent-status write unavailable/);
  assert.deepEqual(plain(db.store), before, "a failed final write must undo the earlier message and timestamp writes");
  delete db.deliveryWriteError;
  const retry = await load(db).repository.deliverProactiveMessage("u1", draft.id, { automatic: true });
  assert.ok(retry);
  assert.equal(db.store.messages.length, 1);
  assert.equal(db.store.proactiveMessages[0].status, "sent");
  assert.equal(db.store.conversations[0].lastMessageAt, retry.message.createdAt);
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

  const { repository } = load(db);
  assert.equal(await repository.getProactiveSchedulerCheckpoint("isolated"), null);
  await repository.setProactiveSchedulerCheckpoint("isolated", "c010", "c009");
  assert.equal(await repository.getProactiveSchedulerCheckpoint("isolated"), "c010",
    "a missing row can initialize from a non-null expected cursor");
  await repository.setProactiveSchedulerCheckpoint("isolated", "stale", "c009");
  await repository.setProactiveSchedulerCheckpoint("isolated", "stale", null);
  assert.equal(db.checkpoints.get("isolated"), "c010", "stale writers cannot overwrite an existing cursor");
  await repository.setProactiveSchedulerCheckpoint("isolated", null, "c010");
  assert.equal(await repository.getProactiveSchedulerCheckpoint("isolated"), null);
  await repository.setProactiveSchedulerCheckpoint("isolated", "stale", "c010");
  assert.equal(db.checkpoints.get("isolated"), null, "stale writers cannot overwrite a wrap to null");
  assert.equal(db.checkpoints.get("all"), "c003", "CAS writes stay scoped");
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
