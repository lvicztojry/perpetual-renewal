import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Allowlisted VM: no credentials, process, fetch, real database or model access.
const root = fileURLToPath(new URL("../src/", import.meta.url));
const forbidden = () => { throw new Error("Unexpected external operation"); };
const timers = new Map();
let nextTimer = 0;
const context = vm.createContext({
  structuredClone, TextEncoder, TextDecoder, Intl,
  setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
  clearTimeout: id => timers.delete(id)
});
const stubs = {
  "node:crypto": { randomUUID },
  "@/lib/prisma": { prisma: new Proxy({}, { get: forbidden }) },
  "@/lib/persistence/memory-fallback": { shouldUseMemoryFallback: forbidden },
  "@/lib/renewal/in-memory-repository": { InMemoryRenewalRepository: class {} },
  "@/lib/renewal/prisma-repository": { PrismaRenewalRepository: class {} },
  "@/lib/groups/generation": { selectGroupSpeakers: forbidden, generateGroupReply: forbidden },
  "@/lib/users/profile": { getUserProfile: forbidden }
};
const cache = new Map();
function load(specifier, parent = path.join(root, "entry.ts")) {
  const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(parent), specifier) : null;
  if (!base || !base.startsWith(root)) throw new Error(`Blocked import ${specifier}`);
  const canonical = `@/${path.relative(root, base).split(path.sep).join("/")}`;
  if (Object.hasOwn(stubs, canonical)) return stubs[canonical];
  const filename = [`${base}.ts`, path.join(base, "index.ts")].find(existsSync);
  if (!filename) throw new Error(`Missing import ${specifier}`);
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiledModule = { exports: {} }; cache.set(filename, compiledModule);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename });
  new vm.Script(`(function(exports,require,module){${outputText}\n})`, { filename }).runInContext(context)(compiledModule.exports, child => child === "node:crypto" ? stubs[child] : load(child, filename), compiledModule);
  return compiledModule.exports;
}
const { GroupService, GROUP_CLAIM_LEASE_MS, GROUP_GENERATION_TIMEOUT_MS, GROUP_MAX_REPLY_ATTEMPTS } = load("@/lib/groups/service");
const { PrismaGroupRepository } = load("@/lib/groups/repository");
const { missing } = load("@/lib/groups/errors");
const { boundState } = load("@/lib/groups/validation");
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const fails = (promise, status) => assert.rejects(promise, error => error.status === status);

class OfflineRepository {
  rows = new Map();
  people = ["a", "b", "c"].map(id => ({ id, userId: "u", name: id, memories: [], proactiveMessagesEnabled: false }));
  async companions(userId) { return structuredClone(this.people.filter(c => c.userId === userId)); }
  async list(userId) { return structuredClone([...this.rows.values()].filter(g => g.userId === userId)); }
  async read(userId, id) { const g = this.rows.get(id); if (!g || g.userId !== userId) throw missing(); return structuredClone(g); }
  async create(group) { this.rows.set(group.id, structuredClone(group)); return structuredClone(group); }
  async delete(userId, id) { await this.read(userId, id); this.rows.delete(id); }
  async mutate(userId, id, run) {
    const before = this.rows.get(id); if (!before || before.userId !== userId) throw missing();
    const next = run(structuredClone(before));
    if (JSON.stringify(before) !== JSON.stringify(next)) next.revision = before.revision + 1;
    boundState(next); this.rows.set(id, structuredClone(next)); return structuredClone(next);
  }
}
async function fixture({ two = false } = {}) {
  const repository = new OfflineRepository();
  let instant = Date.parse("2026-11-13T04:00:00Z"), globalEnabled = true;
  const calls = [];
  let generate = async () => ({ content: "offline reply", source: "model" });
  const deps = { repository, now: () => new Date(instant),
    getUserProfile: async () => ({ proactiveMessagesEnabled: globalEnabled, timezone: "Asia/Shanghai" }),
    selectGroupSpeakers: (_g, companions, mentionIds) => mentionIds?.length ? mentionIds : companions.slice(0, two ? 2 : 1).map(c => c.id),
    generateGroupReply: async (...args) => { calls.push(plain(args)); return generate(...args); }
  };
  const service = new GroupService(deps);
  const initial = await service.create("u", { name: "Offline", background: "", companionIds: two ? ["a", "b"] : ["a"] });
  const id = initial.id;
  return { service, repository, calls, id, deps,
    restart: () => new GroupService(deps),
    generate: fn => { generate = fn; },
    global: value => { globalEnabled = value; },
    advance: ms => { instant += ms; },
    read: () => service.get("u", id),
    stored: () => repository.read("u", id),
    post: action => service.post("u", id, action),
    async update(patch = {}, members) {
      const g = await service.get("u", id);
      return service.post("u", id, { action: "update", revision: g.revision, name: g.name, background: g.background, members: members ?? g.members, settings: { ...g.settings, ...patch } });
    },
    async enable(patch = {}) { await this.update({ proactiveEnabled: true, autoChat: true, quietStart: "00:00", quietEnd: "00:00", ...patch }); this.advance(60001); },
    async message(clientId = randomUUID(), extra = {}) { return this.post({ action: "message", content: "hello", clientId, ...extra }); },
    scheduled: () => service.scheduled("u", id)
  };
}

test("message identity/source/attendance fields are server-owned; clientId is idempotent", async () => {
  const f = await fixture();
  const action = { source: "model", speakerId: "b", proactive: true, createdAt: "1900-01-01", turn: 999, sourceMessageIds: ["fake"] };
  const sent = await f.message("__proto__", action);
  assert.equal(sent.group.turn, 1);
  const message = sent.group.messages[0];
  assert.equal(message.speakerId, null); assert.equal(message.proactive, false);
  assert.equal(message.source, undefined); assert.equal(message.sourceMessageIds, undefined);
  assert.notEqual(message.createdAt, action.createdAt); assert.equal(sent.group._control, undefined);
  assert.deepEqual(plain(await f.message("__proto__", action)), plain(sent));
  await fails(f.message("__proto__", { content: "changed" }), 409);
  await fails(f.post({ action: "reply", turn: 999, speakerId: "a" }), 409);
  assert.equal(f.calls.length, 0);
});

test("done reply is idempotent without model calls, writes, or a capacity check", async () => {
  const f = await fixture(); const sent = await f.message();
  const action = { action: "reply", turn: sent.group.turn, speakerId: "a", source: "local", content: "forged" };
  const first = await f.post(action); const second = await f.restart().post("u", f.id, action);
  assert.deepEqual(plain(second), plain(first)); assert.equal(f.calls.length, 1);
  assert.equal(first.source, "model"); assert.equal(first.group.messages.at(-1).content, "offline reply");
  assert.deepEqual(f.calls[0][5], { now: "2026-11-13T04:00:00.000Z", timeZone: "Asia/Shanghai" });
});

test("live lease excludes concurrent retries; metadata is persisted before generation", async () => {
  const f = await fixture(); const gate = deferred(), entered = deferred();
  f.generate(async () => { entered.resolve(); return gate.promise; });
  const sent = await f.message(); const action = { action: "reply", turn: sent.group.turn, speakerId: "a" };
  const pending = f.post(action); await entered.promise;
  const claim = (await f.stored())._control.plan.claims.a;
  assert.equal(Date.parse(claim.leaseUntil) - Date.parse(claim.claimedAt), GROUP_CLAIM_LEASE_MS);
  assert.equal(claim.attempts, 1); assert.equal(claim.status, "pending");
  await fails(f.restart().post("u", f.id, action), 409); assert.equal(f.calls.length, 1);
  gate.resolve({ content: "once", source: "model" }); await pending;
});

test("failed reply can recover after service restart with a fresh CAS token", async () => {
  const f = await fixture(); const sent = await f.message();
  const action = { action: "reply", turn: sent.group.turn, speakerId: "a" };
  f.generate(async () => { throw Error("secret provider detail"); });
  await fails(f.post(action), 502); const failed = (await f.stored())._control.plan.claims.a;
  f.generate(async () => ({ content: "recovered", source: "local" }));
  const result = await f.restart().post("u", f.id, action);
  const claim = (await f.stored())._control.plan.claims.a;
  assert.equal(result.group.messages.at(-1).content, "recovered");
  assert.equal(claim.status, "done"); assert.equal(claim.attempts, 2); assert.notEqual(claim.token, failed.token);
});

test("expired crash lease is recoverable; abandoned worker token cannot write", async () => {
  const f = await fixture(); const old = deferred(), entered = deferred();
  f.generate(async () => { entered.resolve(); return old.promise; });
  const sent = await f.message(); const action = { action: "reply", turn: sent.group.turn, speakerId: "a" };
  const abandoned = f.post(action); await entered.promise;
  f.advance(GROUP_CLAIM_LEASE_MS);
  f.generate(async () => ({ content: "new worker", source: "model" }));
  const recovered = await f.restart().post("u", f.id, action);
  assert.equal((await f.stored())._control.plan.claims.a.attempts, 2);
  old.resolve({ content: "obsolete worker", source: "model" });
  assert.equal((await abandoned).skipped, "stale-turn");
  assert.deepEqual(plain(await f.read()), plain(recovered.group));
});

test("generation timeout is 45s, marks failed, and ignores late completion", async () => {
  const f = await fixture(), gate = deferred(), entered = deferred();
  f.generate(async () => { entered.resolve(); return gate.promise; });
  const sent = await f.message(); const pending = f.post({ action: "reply", turn: sent.group.turn, speakerId: "a" });
  await entered.promise;
  const timer = [...timers.values()].find(t => t.ms === GROUP_GENERATION_TIMEOUT_MS);
  assert.ok(timer); timer.callback(); await fails(pending, 502);
  assert.equal((await f.stored())._control.plan.claims.a.status, "failed");
  gate.resolve({ content: "too late", source: "model" }); await Promise.resolve();
  assert.equal((await f.read()).messages.length, 1);
});

test("new user turn fences in-flight success and stale retry without extra model calls", async () => {
  const f = await fixture(), gate = deferred(), entered = deferred();
  f.generate(async () => { entered.resolve(); return gate.promise; });
  const old = await f.message(); const action = { action: "reply", turn: old.group.turn, speakerId: "a" };
  const pending = f.post(action); await entered.promise;
  const next = await f.message("next"); assert.equal(next.group.turn, old.group.turn + 1);
  gate.resolve({ content: "old turn", source: "model" }); assert.equal((await pending).skipped, "stale-turn");
  await fails(f.post(action), 409); assert.equal(f.calls.length, 1); assert.equal((await f.read()).messages.length, 2);
});

test("scheduled resumes failed proactive speaker in order without new turn or round", async () => {
  const f = await fixture({ two: true }); await f.enable({ maxAutoRounds: 1 });
  f.generate(async (_u, _g, _cs, speaker) => { if (speaker === "b") throw Error("offline failure"); return { content: "a complete", source: "local" }; });
  await fails(f.scheduled(), 502);
  const failed = await f.stored(); assert.equal(failed.messages.length, 1); assert.equal(failed._control.autoRounds, 1);
  f.generate(async () => ({ content: "b recovered", source: "model" }));
  const result = await f.restart().scheduled("u", f.id);
  assert.equal(result.group.turn, failed.turn); assert.equal(result.group.messages.length, 2);
  assert.equal((await f.stored())._control.autoRounds, 1);
  assert.deepEqual(f.calls.map(args => args[3]), ["a", "b", "b"]);
  f.advance(60001); assert.equal((await f.scheduled()).skipped, "max-auto-rounds");
});

test("scheduled skips a live lease then recovers an expired crash lease", async () => {
  const f = await fixture(), gate = deferred(), entered = deferred(); await f.enable();
  f.generate(async () => { entered.resolve(); return gate.promise; });
  const abandoned = f.scheduled(); await entered.promise;
  assert.equal((await f.restart().scheduled("u", f.id)).skipped, "reply-in-progress");
  const original = await f.stored(); f.advance(GROUP_CLAIM_LEASE_MS);
  f.generate(async () => ({ content: "cron recovered", source: "model" }));
  const recovered = await f.restart().scheduled("u", f.id);
  assert.equal(recovered.group.turn, original.turn); assert.equal(f.calls.length, 2);
  gate.resolve({ content: "old cron", source: "model" }); assert.equal((await abandoned).skipped, "stale-turn");
  assert.equal((await f.read()).messages.length, 1);
});

test("max attempts persists across restarts; repeated cron/manual requests never brush fees", async () => {
  const f = await fixture(); await f.enable(); f.generate(async () => { throw Error("offline failure"); });
  for (let i = 0; i < GROUP_MAX_REPLY_ATTEMPTS; i++) await fails(f.restart().scheduled("u", f.id), 502);
  const state = await f.stored(); assert.equal(state._control.plan.claims.a.attempts, GROUP_MAX_REPLY_ATTEMPTS);
  for (let i = 0; i < 4; i++) {
    f.advance(GROUP_CLAIM_LEASE_MS);
    assert.equal((await f.restart().scheduled("u", f.id)).skipped, "reply-attempts-exhausted");
    assert.equal((await f.post({ action: "reply", turn: state.turn, speakerId: "a" })).skipped, "reply-attempts-exhausted");
  }
  assert.equal(f.calls.length, GROUP_MAX_REPLY_ATTEMPTS); assert.equal((await f.stored())._control.autoRounds, 1);
});

test("legacy claims without timestamps recover with bounded attempts", async () => {
  const f = await fixture(); await f.enable(); const planned = await f.post({ action: "proactive" });
  await f.repository.mutate("u", f.id, g => { g._control.plan.claims.a = { token: "legacy", status: "pending" }; return g; });
  const recovered = await f.restart().scheduled("u", f.id);
  assert.equal(recovered.group.turn, planned.group.turn); assert.equal((await f.stored())._control.plan.claims.a.attempts, 2);
});

test("group proactive is independent of private companion switch; global/member/quiet gates apply", async () => {
  const f = await fixture(); await f.enable();
  assert.equal(f.repository.people[0].proactiveMessagesEnabled, false);
  assert.equal((await f.scheduled()).group.messages.length, 1);
  f.advance(60001); f.global(false); assert.equal((await f.scheduled()).skipped, "disabled");
  f.global(true); let g = await f.read();
  await f.update({}, g.members.map(m => ({ ...m, proactiveEnabled: false })));
  assert.equal((await f.scheduled()).skipped, "no-speakers");
  g = await f.read(); await f.update({ quietStart: "11:00", quietEnd: "13:00" }, g.members.map(m => ({ ...m, proactiveEnabled: true })));
  assert.equal((await f.scheduled()).skipped, "quiet-time"); assert.equal(f.calls.length, 1);
});

test("settled automatic conversation spends no model call or new turn and a new user message resumes it", async () => {
  const f = await fixture(); await f.enable();
  const select = f.deps.selectGroupSpeakers;
  f.deps.selectGroupSpeakers = () => [];
  const before = await f.stored();
  assert.equal((await f.scheduled()).skipped, "conversation-settled");
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.stored(), before);
  f.deps.selectGroupSpeakers = select;
  const sent = await f.message();
  const result = await f.post({ action: "reply", turn: sent.group.turn, speakerId: sent.speakers[0] });
  assert.equal(result.group.messages.length, 2);
  assert.equal(f.calls.length, 1);
});

for (const mode of ["group", "member", "global"]) test(`disabling ${mode} fences in-flight proactive result`, async () => {
  const f = await fixture(), gate = deferred(), entered = deferred(); await f.enable();
  f.generate(async () => { entered.resolve(); return gate.promise; });
  const pending = f.scheduled(); await entered.promise;
  if (mode === "global") f.global(false);
  else if (mode === "group") {
    await f.update({ proactiveEnabled: false });
    // Re-enabling cannot resurrect the old token/plan either.
    await f.update({ proactiveEnabled: true });
  } else { const g = await f.read(); await f.update({}, g.members.map(m => ({ ...m, proactiveEnabled: false }))); }
  gate.resolve({ content: "must not persist", source: "model" });
  assert.equal((await pending).skipped, "stale-turn"); assert.equal((await f.read()).messages.length, 0);
});

test("remember requires real source IDs and attendance; joinedAt cannot be forged", async () => {
  const f = await fixture(); const sent = await f.message(); let g = sent.group;
  const remember = (sourceMessageIds, knownBy) => f.post({ action: "remember", revision: g.revision, content: "memory", sourceMessageIds, knownBy, confirmed: true });
  await fails(remember(["fabricated-source"], ["a"]), 400);
  await f.update({}, [...g.members, { companionId: "b", joinedAt: "1900-01-01", allowPrivateMemories: false, proactiveEnabled: true, relationship: "" }]);
  g = await f.read(); assert.ok(g.members[1].joinedAt > sent.group.messages[0].createdAt);
  await fails(remember([g.messages[0].id], ["b"]), 400);
  const saved = await remember([g.messages[0].id], ["a"]);
  assert.equal(saved.group.memories[0].sourceMessageIds[0], g.messages[0].id);
  assert.equal((await f.read()).messages.length, 1);
});

for (const status of ["failed", "pending"]) test(`actual Prisma CAS allows one recovery claimant for ${status} across concurrent workers`, async () => {
  const f = await fixture(); const sent = await f.message();
  let row = await f.stored();
  row._control.plan.claims.a = { token: "previous-process", status, attempts: 1, claimedAt: "2026-11-12T00:00:00Z", leaseUntil: "2026-11-12T00:01:30Z" };
  const db = { groupWorkspace: {
    findFirst: async () => ({ state: structuredClone(row) }),
    updateMany: async ({ where, data }) => {
      if (where.revision !== row.revision) return { count: 0 };
      row = structuredClone(data.state); return { count: 1 };
    }
  } };
  const repo = new PrismaGroupRepository(db, { listCompanions: userId => f.repository.companions(userId) });
  const one = new GroupService({ ...f.deps, repository: repo }), two = new GroupService({ ...f.deps, repository: repo });
  const action = { action: "reply", turn: sent.group.turn, speakerId: "a" };
  const result = await Promise.allSettled([one.post("u", f.id, action), two.post("u", f.id, action)]);
  assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(result.find(r => r.status === "rejected").reason.status, 409);
  assert.equal(f.calls.length, 1); assert.equal(row.messages.length, 2);
  assert.equal(row._control.plan.claims.a.attempts, 2);
});

test("exhausted expired pending is reported without a new invocation or round", async () => {
  const f = await fixture(); await f.enable(); await f.post({ action: "proactive" });
  await f.repository.mutate("u", f.id, g => {
    g._control.plan.claims.a = { token: "crashed-third-attempt", status: "pending", attempts: GROUP_MAX_REPLY_ATTEMPTS, claimedAt: "2026-11-12T00:00:00Z", leaseUntil: "2026-11-12T00:01:30Z" };
    return g;
  });
  const before = await f.stored();
  for (let i = 0; i < 3; i++) assert.equal((await f.restart().scheduled("u", f.id)).skipped, "reply-attempts-exhausted");
  assert.deepEqual(plain(await f.stored()), plain(before)); assert.equal(f.calls.length, 0);
});

test("all generation watchdogs were cleared", () => { assert.equal(timers.size, 0); });
