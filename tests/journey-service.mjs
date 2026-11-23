import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

// Isolated VM: no host process, network, credentials, mail, model, or database.
const root = fileURLToPath(new URL("../", import.meta.url));
const context = vm.createContext({ structuredClone, Map, Date, TextDecoder });
const cache = new Map(), companions = new Map(), messages = new Map(), rows = new Map();
let memory = true, session = { userId: "alice" }, externalFailure = false, serializationFailures = 0;
let inside = false, updateMiss = false;
const forbidden = () => { throw new Error("Unexpected external operation"); };
const tx = {
  userJourney: {
    findUnique: async ({ where }) => { if (externalFailure) throw new Error("secret DB URL"); return structuredClone(rows.get(where.userId) ?? null); },
    create: async ({ data }) => { assert(inside); rows.set(data.userId, structuredClone(data)); },
    updateMany: async ({ where, data }) => {
      assert(inside);
      if (updateMiss || rows.get(where.userId)?.revision !== where.revision) return { count: 0 };
      rows.set(where.userId, { userId: where.userId, ...structuredClone(data) }); return { count: 1 };
    }
  },
  companion: { findFirst: async ({ where }) => { assert(inside); return companions.get(where.id)?.userId === where.userId ? { id: where.id } : null; } },
  message: { findFirst: async ({ where }) => {
    assert(inside); assert.equal(where.role, "USER");
    const c = companions.get(where.conversation.companionId);
    assert.equal(c.userId, where.conversation.userId);
    return messages.get(c.conversationId)?.some(m => m.role === "user") ? { id: "persisted-user-message" } : null;
  } },
  dreamWorkspace: { findFirst: async ({ where }) => { assert(inside); return context.renewalDreamStore?.get(where.companionId)?.userId === where.userId ? { id: "persisted-dream" } : null; } }
};
const stubs = {
  "@/lib/prisma": { prisma: { userJourney: tx.userJourney, $transaction: async (fn, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    if (serializationFailures-- > 0) throw Object.assign(new Error("retry"), { code: "P2034" });
    const before = structuredClone(rows); inside = true;
    try { return await fn(tx); } catch (e) { rows.clear(); for (const [k, v] of before) rows.set(k, v); throw e; } finally { inside = false; }
  } } },
  "@/lib/persistence/memory-fallback": { shouldUseMemoryFallback: () => memory },
  "@/lib/renewal/in-memory-repository": { InMemoryRenewalRepository: class {
    async getCompanion(userId, id) { const c = companions.get(id); return c?.userId === userId ? structuredClone(c) : null; }
    async listMessages(_userId, id) { return structuredClone(messages.get(id) ?? []); }
  } },
  "@/lib/auth/session": { getOptionalSession: async () => session, AuthenticationRequiredError: class extends Error {} },
  "@/lib/http/private-response": { privateJson: (data, options) => ({ data, status: options?.status ?? 200 }) },
  "@/lib/http/request-origin": { isTrustedMutationOrigin: request => request.headers.get("origin") === "https://fixture.test" }
};
function load(specifier, parent = path.join(root, "entry.ts")) {
  if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
  const base = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(parent), specifier) : null;
  if (!base || !base.startsWith(root)) return forbidden();
  const file = [`${base}.ts`, path.join(base, "index.ts")].find(existsSync);
  if (!file) throw new Error(`Missing import ${specifier}`);
  if (cache.has(file)) return cache.get(file).exports;
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file });
  const mod = { exports: {} }; cache.set(file, mod);
  new vm.Script(`(function(exports,require,module){${compiled.outputText}\n})`, { filename: file }).runInContext(context)(mod.exports, child => load(child, file), mod);
  return mod.exports;
}
const { JourneyService, markNewJourneyAccount, clearJourneyAccount } = load("@/lib/journey/service");
const { GET, POST } = load("@/app/api/me/journey/route");
const codec = load("./native/src/runtime/codec");
const service = new JourneyService();
const plain = value => JSON.parse(JSON.stringify(value));
const fails = (fn, status) => assert.rejects(fn, e => e.status === status);
let count = 0;
async function test(name, run) { await run(); console.log(`ok ${++count} - ${name}`); }
async function post(user, action, extra = {}) { return service.post(user, { action, expectedRevision: (await service.get(user)).journey.revision, ...extra }); }
async function toCreation(user) { await post(user, "start"); for (let i = 0; i < 3; i++) await post(user, "advance"); }
companions.set("a", { id: "a", userId: "alice", conversationId: "ca" });
companions.set("b", { id: "b", userId: "bob", conversationId: "cb" });
context.renewalStore = {
  get companions() { return [...companions.values()]; },
  get conversations() { return [...companions.values()].map(c => ({ id: c.conversationId, userId: c.userId, companionId: c.id })); },
  get messages() { return [...messages].flatMap(([conversationId, entries]) => entries.map(m => ({ ...m, conversationId }))); }
};
await test("GET stays legacy without writing; new marking is explicit and idempotent", async () => {
  assert.equal((await service.get("alice")).journey.status, "legacy"); assert.equal(context.renewalJourneyStore, undefined);
  markNewJourneyAccount("bob"); assert.equal((await service.get("bob")).journey.status, "active");
  await post("bob", "pause"); markNewJourneyAccount("bob"); assert.equal((await service.get("bob")).journey.status, "paused");
});
await test("manual transitions, pause/resume, replay/skip and CAS preserve progress", async () => {
  await toCreation("alice"); const before = await service.get("alice");
  await fails(() => service.post("alice", { action: "start", expectedRevision: 0 }), 409);
  assert.deepEqual(plain(await service.get("alice")), plain(before));
  await post("alice", "pause"); await fails(() => post("alice", "advance"), 409); await post("alice", "resume");
  assert.equal((await service.get("alice")).journey.step, "creation");
  await fails(() => post("alice", "advance", { step: "conversation" }), 400);
  await post("alice", "skip"); await fails(() => post("alice", "resume"), 409);
  assert.equal((await post("alice", "start")).journey.step, "awakening");
});
await test("strict fields and resource ownership reject fake milestones", async () => {
  await toCreation("alice");
  for (const extra of [{ kind: "message-sent" }, { companionId: "a" }, { kind: "fake", companionId: "a" }, { kind: "companion-created", companionId: "a", step: "dream" }]) await fails(() => post("alice", "observe", extra), 400);
  await fails(() => post("alice", "advance", { kind: "companion-created" }), 400);
  await fails(() => post("alice", "observe", { kind: "companion-created", companionId: "b" }), 404);
  await post("alice", "observe", { kind: "companion-created", companionId: "a" });
  messages.set("ca", [{ role: "assistant" }]);
  await fails(() => post("alice", "observe", { kind: "message-sent", companionId: "a" }), 400);
  messages.set("cb", [{ role: "user" }]);
  await fails(() => post("alice", "observe", { kind: "message-sent", companionId: "b" }), 400);
  messages.set("ca", [{ role: "user" }]); await post("alice", "observe", { kind: "message-sent", companionId: "a" });
  await fails(() => post("alice", "observe", { kind: "dream-started", companionId: "a" }), 400);
  context.renewalDreamStore = new Map([["a", { userId: "bob", state: {} }]]);
  await fails(() => post("alice", "observe", { kind: "dream-started", companionId: "a" }), 400);
  context.renewalDreamStore.set("a", { userId: "alice", state: {} });
  assert.equal((await post("alice", "observe", { kind: "dream-started", companionId: "a" })).journey.status, "completed");
});
await test("existing owned choice from lanterns and explicit dream finish are valid", async () => {
  await post("alice", "start"); await post("alice", "advance"); await post("alice", "advance");
  await post("alice", "observe", { kind: "companion-created", companionId: "a" });
  await post("alice", "observe", { kind: "message-sent", companionId: "a" });
  assert.equal((await post("alice", "advance", { step: "complete" })).journey.status, "completed");
});
await test("simultaneous memory requests accept one receipt, stale retry cannot rewind", async () => {
  const revision = (await service.get("alice")).journey.revision;
  const results = await Promise.allSettled([service.post("alice", { action: "start", expectedRevision: revision }), service.post("alice", { action: "skip", expectedRevision: revision })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.status, 409);
});
await test("native snapshots isolate accounts, restore progress and keep old vaults legacy", async () => {
  codec.hydrate(codec.emptyState("alice")); assert.equal((await service.get("alice")).journey.status, "active");
  await post("alice", "advance"); const saved = codec.snapshot();
  codec.hydrate(codec.emptyState("bob")); assert.equal((await service.get("alice")).journey.status, "legacy");
  codec.hydrate(saved); assert.equal((await service.get("alice")).journey.step, "arrival"); assert.equal((await service.get("bob")).journey.status, "legacy");
  codec.hydrate(codec.encode({})); assert.equal((await service.get("alice")).journey.status, "legacy");
  markNewJourneyAccount("alice"); markNewJourneyAccount("bob"); clearJourneyAccount("alice"); assert.equal((await service.get("bob")).journey.status, "active");
});
await test("Prisma transaction checks persisted targets and serializable/CAS retry", async () => {
  memory = false; assert.equal((await service.get("alice")).journey.status, "legacy"); assert.equal(rows.size, 0);
  serializationFailures = 1; await toCreation("alice");
  await fails(() => post("alice", "observe", { kind: "companion-created", companionId: "b" }), 404);
  await post("alice", "observe", { kind: "companion-created", companionId: "a" });
  messages.set("ca", []); await fails(() => post("alice", "observe", { kind: "message-sent", companionId: "a" }), 400);
  messages.set("ca", [{ role: "user" }]); await post("alice", "observe", { kind: "message-sent", companionId: "a" });
  context.renewalDreamStore = new Map(); await fails(() => post("alice", "observe", { kind: "dream-started", companionId: "a" }), 400);
  context.renewalDreamStore.set("a", { userId: "alice" }); await post("alice", "observe", { kind: "dream-started", companionId: "a" });
  const before = plain(await service.get("alice")); updateMiss = true;
  await fails(() => post("alice", "start"), 409); updateMiss = false; assert.deepEqual(plain(await service.get("alice")), before);
  serializationFailures = 3; await fails(() => post("alice", "start"), 409);
});
await test("HTTP authentication, origin, bounded parsing and private errors", async () => {
  session = null; assert.equal((await GET()).status, 401); session = { userId: "alice" };
  const request = (body, origin = "https://fixture.test") => new Request("https://fixture.test/api/me/journey", { method: "POST", headers: { origin }, body });
  for (const origin of ["", "null", "https://foreign.test"]) assert.equal((await POST(request("{}", origin))).status, 403);
  assert.equal((await POST(request("{"))).status, 400); assert.equal((await POST(request(" ".repeat(5000)))).status, 400);
  const stale = await POST(request(JSON.stringify({ action: "start", expectedRevision: 0 })));
  assert.equal(stale.status, 409); assert.equal(stale.data.userId, "alice"); assert(stale.data.journey.revision > 0);
  externalFailure = true; const result = await GET(); assert.equal(result.status, 503); assert(!JSON.stringify(result).includes("secret")); externalFailure = false;
});
await test("actual account export/delete hooks preserve foreign journey and exclude secrets", async () => {
  memory = true; codec.hydrate(codec.emptyState());
  markNewJourneyAccount("alice"); markNewJourneyAccount("bob"); await post("bob", "advance");
  const foreign = plain(await service.get("bob"));
  Object.assign(stubs, {
    "@/lib/credentials/repository": { getLlmCredentialStatus: async () => ({ configured: false }) },
    "@/lib/renewal/repository": { createRenewalRepository: () => ({ persistence: "memory", listCompanions: async () => [] }) },
    "@/lib/renewal/types": { DEMO_USER_ID: "demo-user" },
    "@/lib/safety-events": { listSafetyEventsExportPage: async () => ({ items: [] }) },
    "@/lib/usage": { listModelUsageLogsExportPage: async () => ({ items: [] }) },
    "@/lib/users/profile": { getUserProfile: async userId => ({ id: userId }) },
    "@/lib/dream/repository": { listDreamWorkspacesForExport: async () => [], deleteDreamWorkspaces: async () => {} },
    "@/lib/groups/repository": { listGroupsForExport: async () => [], deleteGroupsForAccount: async () => {} },
    "@/lib/memory/lifecycle-service": { readMemoryExportSnapshot: async () => ({ memories: [], revisions: [] }) },
    "@/lib/memory/lifecycle": { clearMemoryHistory() {} },
    "@/lib/sync/read-receipts-core": { clearMessageReadReceipts() {} },
    "@/lib/sync/read-receipts-service": { listMessageReadReceiptsForExport: async () => [] }
  });
  const { buildUserExportSnapshot } = load("@/lib/export/snapshot");
  const { deleteCurrentUserAccount } = load("@/lib/users/delete-account");
  context.renewalJourneyStore.get("alice").apiKey = "fixture-secret";
  const snapshot = await buildUserExportSnapshot("alice");
  assert.equal(snapshot.journey.step, "awakening");
  assert(!JSON.stringify(snapshot).includes("fixture-secret"));
  assert(!JSON.stringify(snapshot).includes('"arrival"'), "foreign journey omitted");
  await deleteCurrentUserAccount("alice", { confirmation: "删除我的账号" });
  assert.equal(context.renewalJourneyStore.has("alice"), false);
  assert.deepEqual(plain(await service.get("bob")), foreign);
});
console.log(`journey-service: ${count} isolated checks passed`);
