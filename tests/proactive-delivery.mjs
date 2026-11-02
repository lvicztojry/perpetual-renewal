import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

// Node 20: transpile real repository code without experimental TS loaders.
// No environment files, live database, provider or email calls.
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const old = "2026-10-01T00:00:00.000Z";
const conflict = (code) => Object.assign(new Error(code), { code });
const input = (deliveryKey, extra = {}) => ({ kind: "DAILY_GREETING", content: "hello", deliveryKey, ...extra });

function fixture(mode) {
  const db = {
    state: {
      companions: [
        { id: "c1", userId: "u1", proactiveMessagesEnabled: true },
        { id: "c2", userId: "u2", proactiveMessagesEnabled: true },
        { id: "c3", userId: "u1", proactiveMessagesEnabled: true }
      ],
      users: [{ id: "u1", proactiveMessagesEnabled: true }, { id: "u2", proactiveMessagesEnabled: true }],
      conversations: [
        { id: "a", userId: "u1", companionId: "c1", createdAt: old, updatedAt: old, lastMessageAt: null },
        { id: "b", userId: "u1", companionId: "c1", createdAt: old, updatedAt: old, lastMessageAt: null },
        { id: "foreign", userId: "u2", companionId: "c2", createdAt: old, updatedAt: old, lastMessageAt: null }
      ],
      messages: [], proactiveMessages: [], memories: [], relationshipStates: []
    },
    serial: 0, version: 0, transactions: 0, retries: 0, failure: null, forcedConflict: null
  };
  const profiles = new Map(db.state.users.map((u) => [u.id, u]));
  const context = vm.createContext({
    console, process: { env: {} }, Date, Map, Set, setTimeout,
    renewalStore: db.state, __perpetualRenewalFallbackProfiles: profiles
  });
  function api(state, transactional = false) {
    const changed = () => { if (!transactional) db.version++; };
    const dateRow = (row) => row && ({
      ...row, createdAt: new Date(row.createdAt ?? old), updatedAt: new Date(row.updatedAt ?? old),
      ...(Object.hasOwn(row, "scheduledAt") ? { scheduledAt: row.scheduledAt && new Date(row.scheduledAt) } : {})
    });
    const matches = (row, where) => row && Object.entries(where).every(([key, val]) => {
      if (key === "companion") return state.companions.some((c) => c.id === row.companionId && c.userId === val.userId);
      return row[key] === val;
    });
    const first = (rows, where) => rows.find((row) => matches(row, where)) ?? null;
    return {
      user: { async findUnique({ where }) { return first(state.users, where); } },
      companion: { async findFirst({ where }) { return first(state.companions, where); } },
      conversation: {
        async findFirst({ where, orderBy }) {
          const rows = state.conversations.filter((c) => matches(c, where));
          if (orderBy) {
            assert.equal(JSON.stringify(orderBy), JSON.stringify([{ createdAt: "asc" }, { id: "asc" }]));
            rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
          }
          return dateRow(rows[0]);
        },
        async update({ where, data }) {
          if (db.failure === "conversation") throw new Error("injected conversation failure");
          Object.assign(first(state.conversations, where), data);
          changed();
        }
      },
      proactiveMessage: {
        async findUnique({ where }) { return dateRow(first(state.proactiveMessages, where)); },
        async findFirst({ where }) { return dateRow(first(state.proactiveMessages, where)); },
        async create({ data }) {
          if (data.deliveryKey != null && state.proactiveMessages.some((p) => p.deliveryKey === data.deliveryKey)) throw conflict("P2002");
          const row = { id: `p${++db.serial}`, ...data, safety: data.safety ?? null, createdAt: old, updatedAt: old };
          state.proactiveMessages.push(row);
          changed();
          return dateRow(row);
        },
        async update({ where, data }) {
          if (db.failure === "proactive") throw new Error("injected proactive failure");
          const row = first(state.proactiveMessages, where);
          assert.ok(row);
          Object.assign(row, data, { updatedAt: new Date().toISOString() });
          changed();
          return dateRow(row);
        }
      },
      message: {
        async findUnique({ where }) { return dateRow(first(state.messages, where)); },
        async create({ data }) {
          if (state.messages.some((m) => m.proactiveMessageId === data.proactiveMessageId)) throw conflict("P2002");
          const row = { id: `m${++db.serial}`, ...data, metadata: null, createdAt: new Date().toISOString() };
          state.messages.push(row);
          changed();
          return dateRow(row);
        }
      }
    };
  }
  const prisma = {
    ...api(db.state),
    async $transaction(operation, options) {
      assert.equal(options.isolationLevel, "Serializable");
      db.transactions++;
      const version = db.version;
      const snapshot = structuredClone(db.state);
      const result = await operation(api(snapshot, true));
      // Optimistic serializable simulator: simultaneous snapshots cannot both
      // commit. All local writes disappear on failure, including message insert.
      if (db.forcedConflict) {
        const code = db.forcedConflict;
        db.forcedConflict = null;
        db.retries++;
        db.onConflict?.();
        throw conflict(code);
      }
      if (version !== db.version) { db.retries++; throw conflict("P2034"); }
      for (const key of Object.keys(snapshot)) db.state[key] = snapshot[key];
      db.version++;
      return result;
    }
  };
  const stubs = {
    "@prisma/client": require("@prisma/client"),
    "@/lib/prisma": { prisma },
    "@/lib/persistence/memory-fallback": {
      shouldUseMemoryFallback: () => mode === "memory",
      shouldFallbackToMemoryOnPrismaError: () => false
    },
    "@/lib/logging/sanitize": { safeLogValue: () => "redacted" }
  };
  const cache = new Map();
  function moduleAt(filename) {
    if (filename.endsWith("relationship-state-adapter.ts")) return {};
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    });
    const localRequire = (name) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      assert.ok(name.startsWith(".") || name.startsWith("@/"));
      return moduleAt((name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : path.resolve(path.dirname(filename), name)) + ".ts");
    };
    new vm.Script(`(function(require,module,exports){${outputText}\n})`, { filename })
      .runInContext(context)(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  const create = moduleAt(path.join(root, "src/lib/renewal/repository.ts")).createRenewalRepository;
  return { db, repository: create(), create, profiles };
}

for (const mode of ["memory", "prisma"]) {
  test(`${mode}: concurrent keyed creation preserves owned record and every existing status`, async () => {
    const { db, repository: r, create } = fixture(mode);
    const records = await Promise.all(Array.from({ length: 6 }, () => create().createProactiveMessage("u1", "c1", input("key"))));
    assert.equal(new Set(records.map((p) => p.id)).size, 1);
    assert.equal(records[0].deliveryKey, "key");
    assert.equal(db.state.proactiveMessages.length, 1);
    const id = records[0].id;
    for (const status of ["sent", "draft", "dismissed", "blocked"]) {
      await r.updateProactiveMessage("u1", id, { status });
      const before = JSON.stringify(db.state.proactiveMessages);
      const p = await r.createProactiveMessage("u1", "c1", input("key", { content: "overwrite", status: "draft" }));
      assert.equal(p.status, status);
      assert.equal(p.content, "hello");
      assert.equal(JSON.stringify(db.state.proactiveMessages), before);
    }
    await assert.rejects(r.createProactiveMessage("u2", "c2", input("key")), /unavailable/);
    await assert.rejects(r.createProactiveMessage("u1", "c3", input("key")), /unavailable/);
    await assert.rejects(r.createProactiveMessage("u2", "c1", input("other")), /not found/);
    const empty = await r.createProactiveMessage("u1", "c1", input(""));
    assert.equal((await r.createProactiveMessage("u1", "c1", input(""))).id, empty.id);
    const a = await r.createProactiveMessage("u1", "c1", input(null));
    const b = await r.createProactiveMessage("u1", "c1", input(undefined));
    assert.notEqual(a.id, b.id);
    assert.equal(a.deliveryKey, null);
  });

  test(`${mode}: concurrent delivery and manual sent share one assistant message; restore never duplicates`, async () => {
    const { db, repository: r, create } = fixture(mode);
    const p = await r.createProactiveMessage("u1", "c1", input("once"));
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => i % 2
      ? create().updateProactiveMessage("u1", p.id, { status: "sent" })
      : create().deliverProactiveMessage("u1", p.id)));
    assert.ok(results.every(Boolean));
    assert.equal(db.state.messages.length, 1);
    const delivered = await r.deliverProactiveMessage("u1", p.id);
    assert.equal(delivered.message.role, "assistant");
    assert.equal(delivered.message.content, "hello");
    assert.equal(delivered.message.conversationId, "a");
    assert.equal(delivered.message.proactiveMessageId, p.id);
    const timestamp = new Date(db.state.conversations[0].lastMessageAt).toISOString();
    assert.equal(timestamp, delivered.message.createdAt);
    assert.equal(db.state.conversations[1].lastMessageAt, null);
    await r.updateProactiveMessage("u1", p.id, { status: "draft", content: "new draft text" });
    const restored = await r.deliverProactiveMessage("u1", p.id);
    assert.equal(restored.message.id, delivered.message.id);
    assert.equal(restored.message.content, "hello");
    assert.equal(restored.proactiveMessage.status, "sent");
    assert.equal(db.state.messages.length, 1);
    assert.equal(new Date(db.state.conversations[0].lastMessageAt).toISOString(), timestamp);
    if (mode === "prisma") assert.ok(db.retries > 0, "concurrent snapshots exercise serialization retry");
  });

  test(`${mode}: ownership, blocked/dismissed, and missing conversation leave all state unchanged`, async () => {
    const { db, repository: r } = fixture(mode);
    const p = await r.createProactiveMessage("u1", "c1", input("owned"));
    const noChat = await r.createProactiveMessage("u1", "c3", input("missing-conversation"));
    for (const status of ["draft", "blocked", "dismissed"]) {
      await r.updateProactiveMessage("u1", p.id, { status });
      const before = JSON.stringify(db.state);
      assert.equal(await r.deliverProactiveMessage("u2", p.id), null);
      assert.equal(await r.updateProactiveMessage("u2", p.id, { status: "sent" }), null);
      assert.equal(await r.deliverProactiveMessage("u1", "missing"), null);
      assert.equal(await r.deliverProactiveMessage("u1", noChat.id), null);
      if (status !== "draft") {
        assert.equal(await r.deliverProactiveMessage("u1", p.id), null);
        assert.equal(await r.updateProactiveMessage("u1", p.id, { status: "sent", content: "unsafe edit" }), null);
      }
      assert.equal(JSON.stringify(db.state), before);
    }
  });

  test(`${mode}: automatic delivery rechecks both opt-outs; explicit manual send still works`, async () => {
    const { db, repository: r, profiles } = fixture(mode);
    const p = await r.createProactiveMessage("u1", "c1", input("toggle"));
    for (const target of ["user", "companion"]) {
      const row = target === "user" ? db.state.users[0] : db.state.companions[0];
      row.proactiveMessagesEnabled = false;
      if (target === "user") profiles.set("u1", row);
      assert.equal(await r.deliverProactiveMessage("u1", p.id, { automatic: true }), null);
      assert.equal(db.state.messages.length, 0);
      // A read-only transaction may replace the mock state arrays.
      (target === "user" ? db.state.users[0] : db.state.companions[0]).proactiveMessagesEnabled = true;
      profiles.get("u1").proactiveMessagesEnabled = true;
    }
    db.state.companions[0].proactiveMessagesEnabled = false;
    const sent = await r.updateProactiveMessage("u1", p.id, { status: "sent", content: "manual edit" });
    assert.equal(sent.status, "sent");
    assert.equal(db.state.messages.length, 1);
    assert.equal(db.state.messages[0].content, "manual edit");
  });

  test(`${mode}: corrupt companion ownership or foreign linked conversation cannot leak a message`, async () => {
    const { db, repository: r } = fixture(mode);
    const p = await r.createProactiveMessage("u1", "c1", input("corrupt"));
    db.state.messages.push({ id: "foreign-link", conversationId: "foreign", proactiveMessageId: p.id, role: "ASSISTANT", content: "private", createdAt: old });
    const before = JSON.stringify(db.state);
    assert.equal(await r.deliverProactiveMessage("u1", p.id), null);
    assert.equal(JSON.stringify(db.state), before);
    db.state.companions[0].userId = "u2";
    assert.equal(await r.deliverProactiveMessage("u1", p.id), null);
  });
}

test("memory: insertion failure leaves draft edits and conversation timestamps untouched", async () => {
  const { db, repository: r } = fixture("memory");
  const p = await r.createProactiveMessage("u1", "c1", input("memory-rollback"));
  Object.freeze(db.state.messages);
  const before = JSON.stringify(db.state);
  await assert.rejects(r.updateProactiveMessage("u1", p.id, { status: "sent", content: "edit" }));
  assert.equal(JSON.stringify(db.state), before);
});

for (const target of ["user", "companion", "dismissed"]) {
  test(`prisma: serialization retry rechecks a newly disabled ${target}`, async () => {
    const { db, repository: r } = fixture("prisma");
    const p = await r.createProactiveMessage("u1", "c1", input("changed-after-read"));
    db.forcedConflict = "P2034";
    db.onConflict = () => {
      if (target === "dismissed") db.state.proactiveMessages[0].status = "DISMISSED";
      else (target === "user" ? db.state.users[0] : db.state.companions[0]).proactiveMessagesEnabled = false;
    };
    assert.equal(await r.deliverProactiveMessage("u1", p.id, { automatic: true }), null);
    assert.equal(db.state.messages.length, 0);
    assert.equal(db.state.conversations[0].lastMessageAt, null);
    assert.equal(db.transactions, 2);
  });
}

for (const failure of ["conversation", "proactive"]) {
  test(`prisma: ${failure} failure rolls back message, status, edits and lastMessageAt`, async () => {
    const { db, repository: r } = fixture("prisma");
    const p = await r.createProactiveMessage("u1", "c1", input("rollback"));
    const before = JSON.stringify(db.state);
    db.failure = failure;
    await assert.rejects(r.updateProactiveMessage("u1", p.id, { status: "sent", content: "edit" }), /injected/);
    assert.equal(JSON.stringify(db.state), before);
    db.failure = null;
    assert.ok(await r.deliverProactiveMessage("u1", p.id));
    assert.equal(db.state.messages.length, 1);
  });
}

for (const code of ["P2002", "P2034"]) {
  test(`prisma: ${code} retries entire transaction with no partial delivery`, async () => {
    const { db, repository: r } = fixture("prisma");
    const p = await r.createProactiveMessage("u1", "c1", input(code));
    db.forcedConflict = code;
    const result = await r.deliverProactiveMessage("u1", p.id);
    assert.equal(result.proactiveMessage.status, "sent");
    assert.equal(db.state.messages.length, 1);
    assert.equal(db.transactions, 2);
  });
}

test("schema and additive migration encode nullable uniqueness and SetNull without changing cascade ownership", () => {
  const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const sql = readFileSync(path.join(root, "prisma/migrations/20261031120000_proactive_chat_delivery/migration.sql"), "utf8");
  assert.match(schema, /deliveryKey\s+String\?\s+@unique/);
  assert.match(schema, /proactiveMessageId\s+String\?\s+@unique/);
  assert.match(sql, /ON DELETE SET NULL ON UPDATE CASCADE/);
  assert.equal((sql.match(/CREATE UNIQUE INDEX/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /DROP|DELETE FROM|NOT NULL/);
});
