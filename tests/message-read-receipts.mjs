import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { Prisma } from "@prisma/client";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  let session = { userId: "u" }, memory = true, authError;
  const db = {};
  const context = vm.createContext({ structuredClone, Request, Response, Headers, TextDecoder, TextEncoder, URL, process: { env: { DATABASE_URL: "postgresql://invalid.test/db?schema=qa_unit" } } });
  const modules = new Map();
  function load(name, parent = resolve(root, "entry.ts")) {
    if (name === "@prisma/client") return { Prisma };
    if (name === "@/lib/prisma") return { prisma: db };
    if (name === "@/lib/persistence/memory-fallback") return { shouldUseMemoryFallback: () => memory };
    if (name === "@/lib/auth/session") return { getOptionalSession: async () => { if (authError) throw authError; return session; } };
    if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    const path = name.startsWith("@/") ? resolve(root, name.slice(2) + ".ts") : resolve(dirname(parent), name + ".ts");
    assert.ok(path.startsWith(root));
    if (modules.has(path)) return modules.get(path).exports;
    const compiledModule = { exports: {} }; modules.set(path, compiledModule);
    const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new vm.Script(`(function(exports,require,module){${output}\n})`, { filename: path }).runInContext(context)(compiledModule.exports, child => load(child, path), compiledModule);
    return compiledModule.exports;
  }
  const stamp = "2026-11-17T00:00:00.000Z";
  const incoming = (id, extra = {}) => ({ id, conversationId: "c", role: "assistant", metadata: null, createdAt: stamp, content: "must never leak", ...extra });
  context.renewalStore = {
    companions: [{ id: "p", userId: "u" }, { id: "foreign-p", userId: "v" }],
    conversations: [{ id: "c", userId: "u", companionId: "p" }, { id: "c2", userId: "u", companionId: "p" }, { id: "foreign", userId: "v", companionId: "foreign-p" }],
    messages: [incoming("a"), incoming("b"), incoming("out", { role: "user" }), incoming("system", { role: "system" }), incoming("foreign-m", { conversationId: "foreign" }), incoming("other-thread", { conversationId: "c2" })]
  };
  context.renewalGroupStore = new Map([
    ["g", { id: "g", userId: "u", messages: [{ id: "ga", speakerId: "p", createdAt: stamp }, { id: "gb", speakerId: "p", createdAt: stamp }, { id: "own", speakerId: null }] }],
    ["foreign-g", { id: "foreign-g", userId: "v", messages: [{ id: "foreign-gm", speakerId: "foreign-p" }] }]
  ]);
  const core = load("@/lib/sync/read-receipts-core");
  const service = load("@/lib/sync/read-receipts-service");
  const client = () => new service.ReadReceiptService(new core.MemoryReadReceiptRepository());
  const count = async (api, scope = "private", id = "c", userId = "u") => (await api.inbox(userId)).threads.find(t => t.scope === scope && t.threadId === id)?.unreadCount;
  const mark = (api, ids, scope = "private", threadId = "c", userId = "u") => api.mark(userId, { scope, threadId, messageIds: ids });
  return { context, load, core, client, incoming, count, mark, db,
    setEnv: values => { for (const [key, value] of Object.entries(values)) { if (value === undefined) delete context.process.env[key]; else context.process.env[key] = value; } },
    setSession: value => { session = value; }, databaseMode: () => { memory = false; }, failAuth: () => { authError = new Error("secret auth database failure"); } };
}

test("two independent clients share exact seen IDs in both scopes; repeated confirmations are idempotent", async () => {
  const f = fixture(), a = f.client(), b = f.client();
  for (const [scope, id, messages] of [["private", "c", ["a", "b"]], ["group", "g", ["ga", "gb"]]]) {
    assert.equal(await f.count(b, scope, id), 2);
    assert.equal((await f.mark(a, [messages[0], messages[0]], scope, id)).markedCount, 1);
    assert.equal(await f.count(b, scope, id), 1);
    assert.equal((await f.mark(b, [messages[0]], scope, id)).markedCount, 0);
    assert.equal((await f.mark(b, messages, scope, id)).markedCount, 1);
    assert.equal(await f.count(a, scope, id), 0);
  }
});

test("out-of-order confirmations, same-millisecond late arrivals, and backdated messages remain unread", async () => {
  const f = fixture(), a = f.client(), b = f.client();
  await f.mark(b, ["b"]);
  f.context.renewalStore.messages.push(f.incoming("late"), f.incoming("backdated", { createdAt: "1900-01-01T00:00:00Z" }));
  await f.mark(a, ["a"]);
  assert.equal(await f.count(b), 2);
  await f.mark(b, ["b", "a"]);
  assert.equal(await f.count(a), 2);
  const body = { scope: "private", threadId: "c", messageIds: ["late"], readAt: "9999-01-01T00:00:00Z" };
  await a.mark("u", body);
  assert.equal(await f.count(b), 1, "future client time cannot consume backdated unseen ID");
  await Promise.all([f.mark(a, ["backdated"]), f.mark(b, ["backdated"])]).then(results => assert.equal(results.reduce((sum, r) => sum + r.markedCount, 0), 1));
});

test("group late arrivals and snapshot trimming never turn old acknowledgements into watermarks", async () => {
  const f = fixture(), a = f.client(), g = f.context.renewalGroupStore.get("g");
  await f.mark(a, ["gb"], "group", "g");
  g.messages.push({ id: "late", speakerId: "p", createdAt: g.messages[0].createdAt });
  g.messages = g.messages.filter(m => m.id !== "gb");
  await f.mark(a, ["ga"], "group", "g");
  assert.equal(await f.count(a, "group", "g"), 1);
  await assert.rejects(f.mark(a, ["late", "gb"], "group", "g"), e => e.status === 404);
  assert.equal(await f.count(a, "group", "g"), 1, "missing ID rejects entire batch");
});

test("foreign, cross-thread, outgoing, nonexistent IDs and foreign threads reject without partial writes", async () => {
  const f = fixture(), a = f.client();
  for (const invalid of ["foreign-m", "other-thread", "out", "system", "missing"]) {
    await assert.rejects(f.mark(a, ["a", invalid]), e => e.status === 404);
    assert.equal(await f.count(a), 2);
  }
  for (const args of [[["foreign-m"], "private", "foreign"], [["a"], "private", "c", "v"], [["foreign-gm"], "group", "foreign-g"], [["ga", "own"], "group", "g"]]) await assert.rejects(f.mark(a, ...args), e => e.status === 404);
  assert.equal(await f.count(a, "group", "g"), 2);
  assert.equal((await a.inbox("u")).threads.some(t => t.threadId.startsWith("foreign")), false);
});

test("failed, hidden and deleted messages do not count and cannot be acknowledged", async () => {
  const f = fixture(), a = f.client();
  const states = [{ status: "failed" }, { deleted: true }, { deletedAt: "today" }, { hidden: true }, { hiddenAt: "today" }, { status: "deleted" }, { status: "hidden" }];
  for (const [i, state] of states.entries()) {
    f.context.renewalStore.messages.push(f.incoming(`excluded-${i}`, { metadata: state }));
    f.context.renewalGroupStore.get("g").messages.push({ id: `excluded-${i}`, speakerId: "p", ...state });
    f.context.renewalGroupStore.get("g").messages.push({ id: `meta-excluded-${i}`, speakerId: "p", metadata: state });
    await assert.rejects(f.mark(a, ["ga", `meta-excluded-${i}`], "group", "g"), e => e.status === 404);
    for (const [scope, threadId] of [["private", "c"], ["group", "g"]]) await assert.rejects(f.mark(a, [`excluded-${i}`], scope, threadId), e => e.status === 404);
  }
  assert.equal(await f.count(a), 2); assert.equal(await f.count(a, "group", "g"), 2);
  f.context.renewalStore.messages.find(m => m.id === "a").metadata = { deletedAt: "today" };
  await assert.rejects(f.mark(a, ["a", "b"]), e => e.status === 404);
  assert.equal(await f.count(a), 1);
});

test("deleted false/null do not hide messages; changing deleted true hides them without consuming other IDs", async () => {
  const f = fixture(), a = f.client();
  for (const deleted of [false, null, 0, ""]) {
    const privateMessage = f.context.renewalStore.messages.find(m => m.id === "a");
    privateMessage.metadata = { deleted };
    const groupMessage = f.context.renewalGroupStore.get("g").messages.find(m => m.id === "ga");
    groupMessage.deleted = deleted; groupMessage.metadata = { deleted };
    assert.equal(await f.count(a), 2); assert.equal(await f.count(a, "group", "g"), 2);
  }
  f.context.renewalStore.messages.find(m => m.id === "a").metadata = { deleted: true };
  f.context.renewalGroupStore.get("g").messages.find(m => m.id === "ga").deleted = true;
  await assert.rejects(f.mark(a, ["b", "a"]), e => e.status === 404);
  await assert.rejects(f.mark(a, ["gb", "ga"], "group", "g"), e => e.status === 404);
  assert.equal(await f.count(a), 1); assert.equal(await f.count(a, "group", "g"), 1);
});

test("payload validation caps the raw list at 200, deduplicates, and permits empty owned batches", async () => {
  const f = fixture(), a = f.client();
  for (const body of [null, {}, { scope: "dream", threadId: "c", messageIds: [] }, { scope: "private", threadId: " ", messageIds: [] }, { scope: "private", threadId: "c", messageIds: [1] }, { scope: "private", threadId: "c", messageIds: Array(201).fill("a") }]) await assert.rejects(a.mark("u", body), e => e.status === 400);
  assert.equal((await f.mark(a, Array(200).fill("a"))).markedCount, 1);
  assert.equal((await f.mark(a, [])).markedCount, 0);
  await assert.rejects(f.mark(a, [], "group", "missing"), e => e.status === 404);
});

test("GET is read-only, returns authenticated userId and counters with no content, and follows account changes", async () => {
  const f = fixture(), { GET } = f.load("@/app/api/sync/inbox/route");
  const before = plain([f.context.renewalStore, [...f.context.renewalGroupStore]]);
  const response = await GET(), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.userId, "u");
  assert.ok(Number.isFinite(Date.parse(data.checkedAt)));
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.deepEqual(Object.keys(data.threads[0]).sort(), ["scope", "threadId", "unreadCount"]);
  assert.ok(!JSON.stringify(data).includes("must never leak"));
  assert.deepEqual(plain([f.context.renewalStore, [...f.context.renewalGroupStore]]), before);
  assert.equal(f.context.renewalMessageReadReceipts, undefined);
  f.setSession({ userId: "v" });
  const other = await (await GET()).json();
  assert.equal(other.userId, "v"); assert.ok(other.threads.every(t => t.threadId.startsWith("foreign")));
});

function postRequest(body, headers = {}) {
  return new Request("https://app.test/api/sync/read", { method: "POST", headers: { origin: "https://app.test", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

const lanOrigin = "http://192.168.1.20:3000";
const internalOrigin = "http://localhost:3000";
const readScopes = [["private", "c", ["a", "b"]], ["group", "g", ["ga", "gb"]]];
function internalPost(body, headers) {
  return new Request(`${internalOrigin}/api/sync/read`, { method: "POST", headers, body: JSON.stringify(body) });
}

for (const mode of ["development", "production"]) {
  test(`internal localhost POST accepts canonical LAN origin in both scopes (${mode})`, async () => {
    const f = fixture();
    f.setEnv({ NODE_ENV: mode, AUTH_APP_URL: `${lanOrigin}/configured/path`, AUTH_DEV_ALLOWED_ORIGINS: undefined });
    const { POST } = f.load("@/app/api/sync/read/route"), { GET } = f.load("@/app/api/sync/inbox/route");
    for (const [scope, threadId, messageIds] of readScopes) {
      assert.equal(await f.count(f.client(), scope, threadId), 2);
      const response = await POST(internalPost({ scope, threadId, messageIds }, { origin: lanOrigin, "sec-fetch-site": "same-origin" }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { markedCount: 2 });
      const inbox = await GET();
      assert.equal(inbox.status, 200);
      assert.equal((await inbox.json()).threads.find(t => t.scope === scope && t.threadId === threadId).unreadCount, 0);
    }
  });
}

test("internal localhost and explicitly allowed development LAN POST consume both scopes", async () => {
  for (const origin of [internalOrigin, lanOrigin]) {
    const f = fixture();
    f.setEnv({ NODE_ENV: "development", AUTH_APP_URL: "https://canonical.test", AUTH_DEV_ALLOWED_ORIGINS: `invalid,, ${lanOrigin},` });
    const { POST } = f.load("@/app/api/sync/read/route"), { GET } = f.load("@/app/api/sync/inbox/route");
    for (const [scope, threadId, messageIds] of readScopes) {
      const response = await POST(internalPost({ scope, threadId, messageIds }, { origin }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { markedCount: 2 });
      assert.equal((await (await GET()).json()).threads.find(t => t.scope === scope && t.threadId === threadId).unreadCount, 0);
    }
  }
});

test("rejected internal-host POST origins preserve existing receipts and unread IDs in both scopes", async () => {
  const cases = [
    ["foreign", {}, { origin: "https://foreign.test" }],
    ["wrong LAN port", {}, { origin: "http://192.168.1.20:3001" }],
    ["cross-site canonical", {}, { origin: lanOrigin, "sec-fetch-site": "cross-site" }],
    ["cross-site localhost", {}, { origin: internalOrigin, "sec-fetch-site": "cross-site" }],
    ["unconfigured LAN", { AUTH_APP_URL: undefined }, { origin: lanOrigin }],
    ["production ignores devlist", { NODE_ENV: "production", AUTH_APP_URL: internalOrigin, AUTH_DEV_ALLOWED_ORIGINS: lanOrigin }, { origin: lanOrigin }],
    ["missing", {}, {}],
    ["opaque", {}, { origin: "null" }],
    ["malformed", {}, { origin: `${lanOrigin}/path` }],
    ["forged host", { AUTH_APP_URL: undefined }, { origin: lanOrigin, host: "192.168.1.20:3000", "x-forwarded-host": "192.168.1.20:3000", "x-forwarded-proto": "http" }],
  ];
  for (const [label, env, headers] of cases) {
    const f = fixture();
    f.setEnv({ NODE_ENV: "development", AUTH_APP_URL: lanOrigin, AUTH_DEV_ALLOWED_ORIGINS: undefined, ...env });
    for (const [scope, threadId, ids] of readScopes) await f.mark(f.client(), [ids[0]], scope, threadId);
    const before = plain([...f.context.renewalMessageReadReceipts]);
    const { POST } = f.load("@/app/api/sync/read/route"), { GET } = f.load("@/app/api/sync/inbox/route");
    for (const [scope, threadId, messageIds] of readScopes) {
      const response = await POST(internalPost({ scope, threadId, messageIds }, headers));
      assert.equal(response.status, 403, `${label}: ${scope}`);
      assert.deepEqual(plain([...f.context.renewalMessageReadReceipts]), before, `${label}: receipts unchanged`);
      assert.equal((await (await GET()).json()).threads.find(t => t.scope === scope && t.threadId === threadId).unreadCount, 1, `${label}: ${scope} remains unread`);
    }
  }
});
test("routes enforce optional-session-only authentication, same origin, and private error responses", async () => {
  const f = fixture(), { GET } = f.load("@/app/api/sync/inbox/route"), { POST } = f.load("@/app/api/sync/read/route");
  const body = { scope: "private", threadId: "c", messageIds: ["a"] };
  for (const headers of [{ origin: "https://evil.test" }, { origin: "null" }, { origin: "" }, { "sec-fetch-site": "cross-site" }]) assert.equal((await POST(postRequest(body, headers))).status, 403);
  f.setSession(null);
  for (const response of [await GET(), await POST(postRequest(body))]) { assert.equal(response.status, 401); assert.match(response.headers.get("cache-control"), /private.*no-store/); }
  assert.equal(f.context.renewalMessageReadReceipts, undefined);
  f.setSession({ userId: "u" });
  assert.deepEqual(await (await POST(postRequest(body))).json(), { markedCount: 1 });
});

test("POST enforces streaming 16 KiB limit without trusting Content-Length and rejects malformed input", async () => {
  const f = fixture(), { POST } = f.load("@/app/api/sync/read/route");
  for (const text of ["{", "[]", JSON.stringify({ scope: "private", threadId: "c", messageIds: ["a"], padding: "字".repeat(6000) })]) {
    const response = await POST(postRequest(text, { "content-length": "1" }));
    assert.equal(response.status, 400);
  }
  assert.equal(await f.count(f.client()), 2);
});

test("database and authentication failures return fixed 503 with no memory fallback or internal details", async () => {
  const f = fixture(); f.databaseMode();
  f.db.$queryRaw = async () => { throw new Error("secret database URL"); };
  f.db.$transaction = async () => { throw new Error("secret database URL"); };
  const { GET } = f.load("@/app/api/sync/inbox/route"), { POST } = f.load("@/app/api/sync/read/route");
  for (const response of [await GET(), await POST(postRequest({ scope: "private", threadId: "c", messageIds: ["a"] }))]) {
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "消息同步暂时不可用，请稍后重试。" });
  }
  assert.equal(f.context.renewalMessageReadReceipts, undefined);
  f.failAuth(); assert.equal((await GET()).status, 503);
});

test("fallback cleanup can erase account or selected companion/thread receipts without touching others", async () => {
  const f = fixture(), a = f.client();
  await f.mark(a, ["a"]); await f.mark(a, ["ga"], "group", "g"); await f.mark(a, ["foreign-m"], "private", "foreign", "v");
  f.core.clearMessageReadReceipts("u", "private", ["c"]);
  assert.equal(await f.count(a), 2); assert.equal(await f.count(a, "group", "g"), 1);
  f.core.clearMessageReadReceipts("u");
  assert.equal(await f.count(a, "group", "g"), 2); assert.equal(await f.count(a, "private", "foreign", "v"), 0);
});

test("export service returns only owned visible receipts, excluding deleted threads/messages and snapshot orphans", async () => {
  const f = fixture(), a = f.client();
  const { listMessageReadReceiptsForExport } = f.load("@/lib/sync/read-receipts-service");
  await f.mark(a, ["a", "b"]); await f.mark(a, ["ga", "gb"], "group", "g");
  await f.mark(a, ["foreign-m"], "private", "foreign", "v");
  const exported = await listMessageReadReceiptsForExport("u");
  assert.equal(exported.length, 4);
  assert.ok(exported.every(row => Object.keys(row).sort().join(",") === "messageId,scope,threadId"));
  assert.ok(exported.every(row => !row.messageId.includes("foreign")));
  f.context.renewalStore.messages.find(m => m.id === "a").metadata = { deleted: true };
  f.context.renewalGroupStore.get("g").messages.find(m => m.id === "ga").metadata = { deleted: true };
  assert.deepEqual(plain((await listMessageReadReceiptsForExport("u")).map(r => r.messageId).sort()), ["b", "gb"]);
  f.context.renewalStore.conversations = f.context.renewalStore.conversations.filter(c => c.id !== "c");
  f.context.renewalGroupStore.get("g").messages = [];
  assert.deepEqual(plain(await listMessageReadReceiptsForExport("u")), []);
  assert.equal((await listMessageReadReceiptsForExport("v")).length, 1);
  f.context.renewalGroupStore.delete("g");
  assert.deepEqual(plain(await listMessageReadReceiptsForExport("u")), []);
});

test("Prisma export is parameterized and database export failure never returns memory receipts", async () => {
  const f = fixture(); await f.mark(f.client(), ["a"]);
  f.databaseMode();
  const { listMessageReadReceiptsForExport } = f.load("@/lib/sync/read-receipts-service");
  f.db.$queryRaw = async query => {
    assert.ok(query.values.includes("u' injected")); assert.ok(!query.text.includes("injected"));
    assert.match(query.text, /JOIN "qa_unit"\."Message"/); assert.match(query.text, /EXISTS/);
    assert.ok(!query.text.includes('"content"')); assert.ok(!query.text.includes('public.'));
    return [{ scope: "private", threadId: "c", messageId: "a" }];
  };
  assert.equal((await listMessageReadReceiptsForExport("u' injected")).length, 1);
  f.db.$queryRaw = async () => { throw new Error("fixture export failure"); };
  await assert.rejects(listMessageReadReceiptsForExport("u"), /fixture export failure/);
});

test("Prisma adapter uses parameterized aggregation and bounded ID queries, validates all IDs before insert", async () => {
  const f = fixture(), { PrismaReadReceiptRepository } = f.load("@/lib/sync/read-receipts-prisma");
  const queries = [];
  f.db.$queryRaw = async sql => { queries.push(sql); return [{ scope: "private", threadId: "c", unreadCount: 2n }]; };
  const repo = new PrismaReadReceiptRepository(f.db, "qa_unit");
  assert.equal((await repo.inbox("u' injected"))[0].unreadCount, 2);
  assert.ok(!queries[0].text.includes("injected")); assert.ok(queries[0].values.includes("u' injected"));
  assert.match(queries[0].text, /COUNT\(/); assert.ok(!queries[0].text.includes('m."content"')); assert.ok(!queries[0].text.includes('public.'));
  for (const scope of ["private", "group"]) {
    let inserts = 0, steps = 0;
    f.db.$transaction = async (run, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      assert.equal(options.timeout, 20000); assert.equal(options.maxWait, 5000);
      return run({ $queryRaw: async sql => {
        queries.push(sql); steps++;
        if (sql.text.includes("INSERT INTO")) { inserts++; return [{ messageId: "a" }]; }
        if (steps === 1) { assert.match(sql.text, /FOR SHARE/); return [{ id: "c" }]; }
        return [{ id: "a" }];
      } });
    };
    await assert.rejects(repo.mark("u", { scope, threadId: "c", messageIds: ["a", "invalid"] }), e => e.status === 404);
    assert.equal(inserts, 0);
    steps = 0;
    assert.equal(await repo.mark("u", { scope, threadId: "c", messageIds: ["a"] }), 1);
    assert.equal(inserts, 1);
    assert.match(queries.at(-1).text, /ON CONFLICT/);
  }
  for (const query of queries) {
    const references = [...query.text.matchAll(/(?:FROM|JOIN|INTO)\s+("[^"]+"(?:\."[^"]+")?)/g)];
    assert.ok(references.length > 0);
    assert.ok(references.every(([, table]) => table.startsWith('"qa_unit".')));
  }
});

test("serialization conflicts retry a complete transaction; unrelated DB errors propagate", async () => {
  const f = fixture(), { PrismaReadReceiptRepository } = f.load("@/lib/sync/read-receipts-prisma");
  let calls = 0;
  const repo = new PrismaReadReceiptRepository(f.db, "qa_unit");
  const input = { scope: "private", threadId: "c", messageIds: [] };
  for (const conflict of [{ code: "P2034" }, { code: "P2010", meta: { code: "40001" } }]) {
    calls = 0;
    f.db.$transaction = async () => { calls++; if (calls < 3) throw conflict; return 0; };
    assert.equal(await repo.mark("u", input), 0); assert.equal(calls, 3);
    calls = 0;
    f.db.$transaction = async () => { calls++; throw conflict; };
    await assert.rejects(repo.mark("u", input), e => e === conflict); assert.equal(calls, 3);
  }
  calls = 0;
  const unrelated = { code: "P2010", meta: { code: "23503" } };
  f.db.$transaction = async () => { calls++; throw unrelated; };
  await assert.rejects(repo.mark("u", input), e => e === unrelated); assert.equal(calls, 1);
  f.db.$transaction = async () => { throw new Error("offline DB error"); };
  await assert.rejects(repo.mark("u", input), /offline DB error/);
});

test("configured schema identifiers are validated and quoted independently of parameterized values", async () => {
  const f = fixture(), { PrismaReadReceiptRepository, postgresSchemaFromDatabaseUrl } = f.load("@/lib/sync/read-receipts-prisma");
  assert.equal(postgresSchemaFromDatabaseUrl("postgresql://fixture@invalid.test/db"), "public");
  const schema = 'qa"; schema';
  assert.equal(postgresSchemaFromDatabaseUrl(`postgresql://fixture@invalid.test/db?schema=${encodeURIComponent(schema)}`), schema);
  for (const invalid of [undefined, "invalid", "https://invalid.test", "postgresql://invalid.test/db?schema=", `postgresql://invalid.test/db?schema=${"界".repeat(22)}`, "postgresql://invalid.test/db?schema=%00"]) {
    assert.throws(() => postgresSchemaFromDatabaseUrl(invalid), /Invalid message sync database configuration/);
  }
  f.db.$queryRaw = async query => {
    assert.ok(query.text.includes('FROM "qa""; schema"."Conversation"'));
    assert.ok(query.values.includes("u' injected")); assert.ok(!query.text.includes("injected"));
    return [];
  };
  await new PrismaReadReceiptRepository(f.db, schema).inbox("u' injected");
  for (const invalid of [undefined, "", "a\0b", "界".repeat(22)]) {
    assert.throws(() => new PrismaReadReceiptRepository(f.db, invalid));
  }
});

test("oversized chunked requests are cancelled before a later chunk is read", async () => {
  const f = fixture(), { POST } = f.load("@/app/api/sync/read/route");
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16385).fill(32)); }, cancel() { cancelled = true; } });
  const response = await POST(new Request("https://app.test/api/sync/read", { method: "POST", headers: { origin: "https://app.test" }, body: stream, duplex: "half" }));
  assert.equal(response.status, 400); assert.equal(cancelled, true);
  assert.equal(f.context.renewalMessageReadReceipts, undefined);
});

test("migration provides exact ID uniqueness and cascading user/thread/private-message relations", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20261117020000_message_read_receipts/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /PRIMARY KEY \("userId", "scope", "threadId", "messageId"\)/);
  for (const table of ["User", "Conversation", "GroupWorkspace", "Message"]) assert.ok(sql.includes(`REFERENCES "${table}"("id") ON DELETE CASCADE`));
  assert.match(sql, /CHECK/); assert.ok(!sql.includes('public.'));
});
