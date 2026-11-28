import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

// Isolated VM: no host process, network, credentials, mail, model, or database.
const root = fileURLToPath(new URL("../", import.meta.url));
const context = vm.createContext({ structuredClone, Map, Date, TextDecoder, crypto: globalThis.crypto });
const cache = new Map(), companions = new Map(), messages = new Map(), rows = new Map();
let memory = true, session = { userId: "alice" }, externalFailure = false, serializationFailures = 0;
let inside = false, updateMiss = false;
const forbidden = () => { throw new Error("Unexpected external operation"); };
const role = where => where.role ?? "USER";
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
  companion: { findFirst: async ({ where }) => { assert(inside); const c = companions.get(where.id); return c?.userId === where.userId ? structuredClone(c) : null; } },
  message: { findFirst: async ({ where }) => {
    assert(inside);
    const c = companions.get(where.conversation.companionId);
    assert.equal(c.userId, where.conversation.userId);
    const wanted = role(where).toLowerCase();
    const since = where.createdAt?.gt ? Date.parse(where.createdAt.gt) : 0;
    return (messages.get(c.conversationId) ?? []).some(m => m.role === wanted && Date.parse(m.createdAt ?? "1970-01-01") > since) ? { id: "persisted-message" } : null;
  } },
  dreamWorkspace: { findFirst: async ({ where }) => { assert(inside); const d = context.renewalDreamStore?.get(where.companionId); return d?.userId === where.userId ? structuredClone({ id: "persisted-dream", updatedAt: new Date(d.updatedAt ?? 0), state: d.state }) : null; } },
  groupWorkspace: { findMany: async ({ where }) => {
    assert(inside);
    const groups = globalThis.renewalGroupStore;
    if (!groups) return [];
    return [...groups.values()].filter(g => g.userId === where.userId && (!where.id || g.id === where.id))
      .map(g => ({ id: g.id, userId: g.userId, createdAt: new Date(g.createdAt), state: structuredClone(g) }));
  } },
  memory: { findFirst: async ({ where }) => {
    assert(inside);
    const since = where.updatedAt?.gt ? Date.parse(where.updatedAt.gt) : 0;
    return (context.renewalStore?.memories ?? []).some(m => m.userId === where.userId && m.companionId === where.companionId && Date.parse(m.updatedAt) > since) ? { id: "persisted-memory" } : null;
  } },
  user: { findUnique: async ({ where }) => { assert(inside); return where.id === "alice" ? { id: "alice", updatedAt: new Date() } : null; } }
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
const { JourneyService, markNewJourneyAccount } = load("@/lib/journey/service");
const { GET, POST } = load("@/app/api/me/journey/route");
const codec = load("./native/src/runtime/codec");
const { mainCourse, getCourse, validateCourses, allCourses } = load("@/lib/journey/courses");
const service = new JourneyService();
const plain = value => JSON.parse(JSON.stringify(value));
const fails = (fn, status) => assert.rejects(fn, e => e.status === status);
let count = 0;
async function test(name, run) { await run(); console.log(`ok ${++count} - ${name}`); }
async function current(user) { return (await service.get(user)).journey; }
async function post(user, action, extra = {}) { return service.post(user, { action, expectedRevision: (await current(user)).revision, ...extra }); }
const companion = (id, userId, conversationId) => ({
  id, userId, conversationId, name: id, relationshipKind: "FRIEND", customKind: null, userAddress: "你", companionAddress: id,
  personality: [], speakingStyle: "简短", background: null, boundaries: null, immersionEnabled: true,
  proactiveMessagesEnabled: false, proactiveFrequencyPreset: "1m", proactiveFrequencyMinutes: 1,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
});
companions.set("a", companion("a", "alice", "ca"));
companions.set("b", companion("b", "bob", "cb"));
context.renewalStore = {
  get companions() { return [...companions.values()]; },
  get conversations() { return [...companions.values()].map(c => ({ id: c.conversationId, userId: c.userId, companionId: c.id })); },
  get messages() { return [...messages].flatMap(([conversationId, entries]) => entries.map(m => ({ ...m, conversationId }))); },
  get memories() { return context.__memories ?? []; }
};
async function newCompanion(id, userId = "alice") {
  const existing = companions.get(id);
  const person = { ...(existing ?? companion(id, userId, "c-" + id)), userId, updatedAt: new Date().toISOString() };
  companions.set(id, person);
  return person;
}

/* ------------------------------ static graph ------------------------------ */
await test("course graph is closed, uniquely identified and every evidence step names a target", async () => {
  assert.deepEqual(plain(validateCourses(allCourses)), []);
  assert.equal(allCourses.length, 14);
  assert.equal(mainCourse.steps.at(-1)?.id, "complete-end");
  assert.equal(mainCourse.steps.at(-1)?.next, null);
  for (const course of allCourses) {
    for (const step of course.steps) {
      if (step.completion.type === "evidence") {
        assert.ok(step.target, `${course.id}/${step.id} needs a target`);
        assert.ok(["action", "wait"].includes(step.kind), `${course.id}/${step.id} evidence kind must be an operation`);
      }
    }
  }
  assert.equal(getCourse("nope"), undefined);
});

/* ------------------------------ v1 compatibility ------------------------------ */
await test("GET stays legacy without writing; new marking is explicit and idempotent", async () => {
  assert.equal((await current("alice")).status, "legacy");
  assert.equal(context.renewalJourneyStore, undefined);
  markNewJourneyAccount("bob");
  assert.equal((await current("bob")).status, "active");
  assert.equal((await current("bob")).version, 2);
  await post("bob", "pause"); markNewJourneyAccount("bob");
  assert.equal((await current("bob")).status, "paused");
});

await test("a stored v1 row is lifted in memory without being rewritten", async () => {
  const v1 = { version: 1, step: "conversation", status: "active", companionId: "a", revision: 7 };
  context.renewalJourneyStore.set("legacy-user", v1);
  const read = await current("legacy-user");
  assert.equal(read.version, 2);
  assert.equal(read.step, "conversation");
  assert.equal(read.companionId, "a");
  assert.equal(read.revision, 7);
  assert.deepEqual(read.courses, {});
  assert.deepEqual(context.renewalJourneyStore.get("legacy-user"), v1, "GET must not persist the upgrade");
  // First legal write persists v2.
  await post("legacy-user", "pause");
  assert.equal(context.renewalJourneyStore.get("legacy-user").version, 2);
});

await test("unknown or corrupt stored versions are treated as legacy, never overwritten by a read", async () => {
  context.renewalJourneyStore.set("bad", { version: 9, step: "awakening", status: "active", revision: 3 });
  const read = await current("bad");
  assert.equal(read.status, "legacy");
  assert.equal(read.revision, 0);
});

/* ------------------------------ main course ------------------------------ */
await test("main course walks chapters, records evidence and completes at the terminal step", async () => {
  markNewJourneyAccount("alice");
  const started = await post("alice", "course-start", { courseId: "main", mode: "first" });
  assert.equal(started.journey.activeCourse?.stepId, "awakening-greet");
  assert.equal(started.journey.activeCourse?.mode, "first");
  assert.equal(started.journey.step, "awakening");
  for (const id of ["awakening-greet", "awakening-answer", "awakening-walk", "arrival-people", "arrival-chat", "arrival-tools", "lanterns-entry", "lanterns-pack"]) {
    const next = await post("alice", "course-confirm", { courseId: "main", stepId: id });
    assert.ok(next.journey.activeCourse, `still active after ${id}`);
  }
  // The starter pack creates a real group; without one the step refuses to advance.
  await fails(() => post("alice", "course-confirm", { courseId: "main", stepId: "lanterns-install", evidence: "group-created" }), 409);
  context.renewalGroupStore = new Map([["starter-a", {
    id: "starter-a", userId: "alice", name: "留灯会", background: "", members: [], messages: [], memories: [],
    settings: { proactiveEnabled: false, intervalMinutes: 60, maxReplies: 2, autoChat: false, maxAutoRounds: 2, quietStart: "23:00", quietEnd: "07:00" },
    revision: 0, turn: 0, lastActivityAt: new Date().toISOString(), lastProactiveAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }]]);
  for (const id of ["lanterns-install", "lanterns-read", "lanterns-continue", "creation-open", "creation-kind", "creation-name", "creation-addresses", "creation-style"]) {
    const next = await post("alice", "course-confirm", {
      courseId: "main", stepId: id,
      ...(id === "lanterns-install" ? { evidence: "group-created", context: { groupId: "starter-a" } } : {})
    });
    assert.ok(next.journey.activeCourse, `still active after ${id}`);
  }
  let journey = await current("alice");
  assert.equal(journey.activeCourse?.stepId, "creation-submit");
  assert.equal(journey.step, "creation");
  await newCompanion("a");
  const created = await post("alice", "course-confirm", { courseId: "main", stepId: "creation-submit", evidence: "companion-created", resourceId: "a" });
  assert.equal(created.journey.companionId, "a");
  assert.equal(created.journey.activeCourse?.stepId, "conversation-focus");
  await post("alice", "course-confirm", { courseId: "main", stepId: "conversation-focus" });
  await post("alice", "course-confirm", { courseId: "main", stepId: "conversation-input" });
  for (let i = 0; i < 40 && !messages.get("ca"); i++) await new Promise(r => setTimeout(r, 10));
  messages.set("ca", [{ role: "user", createdAt: new Date().toISOString() }]);
  journey = await post("alice", "course-confirm", { courseId: "main", stepId: "conversation-send", evidence: "message-sent" });
  assert.equal(journey.journey.activeCourse?.stepId, "conversation-reply");
  messages.set("ca", [...messages.get("ca"), { role: "assistant", createdAt: new Date().toISOString() }]);
  journey = await post("alice", "course-confirm", { courseId: "main", stepId: "conversation-reply", evidence: "assistant-replied" });
  assert.equal(journey.journey.activeCourse?.stepId, "dream-open");
  await post("alice", "course-confirm", { courseId: "main", stepId: "dream-open" });
  context.renewalDreamStore = new Map([["a", { userId: "alice", state: { status: "draft", rounds: [], updatedAt: new Date().toISOString() } }]]);
  journey = await post("alice", "course-confirm", { courseId: "main", stepId: "dream-start", evidence: "dream-started" });
  assert.equal(journey.journey.activeCourse?.stepId, "dream-situation");
  await post("alice", "course-confirm", { courseId: "main", stepId: "dream-situation" });
  context.renewalDreamStore.get("a").state.rounds = [{ createdAt: new Date().toISOString(), choices: [] }];
  await post("alice", "course-confirm", { courseId: "main", stepId: "dream-generate", evidence: "dream-generated" });
  context.renewalDreamStore.get("a").state.rounds[0].feedback = { choiceId: "1" };
  await post("alice", "course-confirm", { courseId: "main", stepId: "dream-feedback", evidence: "dream-feedback-recorded" });
  await post("alice", "course-confirm", { courseId: "main", stepId: "dream-review" });
  await post("alice", "course-confirm", { courseId: "main", stepId: "complete-recap" });
  await post("alice", "course-confirm", { courseId: "main", stepId: "complete-entry" });
  await post("alice", "course-confirm", { courseId: "main", stepId: "complete-directory" });
  journey = await post("alice", "course-confirm", { courseId: "main", stepId: "complete-end" });
  assert.equal(journey.journey.activeCourse, null);
  assert.equal(journey.journey.status, "completed");
  assert.equal(journey.journey.step, "complete");
  assert.equal(journey.journey.courses.main.result, "practiced");
  assert.ok(journey.journey.courses.main.milestones.includes("conversation-send"));
});

await test("evidence steps refuse to advance without a matching business result", async () => {
  markNewJourneyAccount("carol");
  await newCompanion("carol-person", "carol");
  await post("carol", "course-start", { courseId: "chat", mode: "review", context: { companionId: "carol-person" } });
  await post("carol", "course-confirm", { courseId: "chat", stepId: "chat-input" });
  // No user message exists for this companion yet; the confirmation is refused.
  await fails(() => post("carol", "course-confirm", { courseId: "chat", stepId: "chat-send", evidence: "message-sent" }), 409);
  // Wrong evidence kind never passes.
  await fails(() => post("carol", "course-confirm", { courseId: "chat", stepId: "chat-send", evidence: "assistant-replied" }), 400);
  // Another account's companion is rejected outright.
  await fails(() => post("carol", "course-confirm", { courseId: "chat", stepId: "chat-send", evidence: "message-sent", resourceId: "a" }), 404);
});

/* ------------------------------ skip / pause / rewind ------------------------------ */
await test("skipping a step never claims it was learned, and a skip is a distinct result", async () => {
  markNewJourneyAccount("dave");
  await post("dave", "course-start", { courseId: "chat", mode: "review" });
  await post("dave", "course-skip-step", { courseId: "chat", stepId: "chat-input" });
  const journey = await current("dave");
  assert.equal(journey.activeCourse?.stepId, "chat-send");
  assert.ok(!journey.courses.chat.milestones.includes("chat-input"));
  const left = await post("dave", "course-leave", { result: "skipped" });
  assert.equal(left.journey.activeCourse, null);
  assert.equal(left.journey.courses.chat.result, "skipped");
  assert.ok(left.journey.deferredCourses.includes("chat"));
});

await test("pause keeps the checkpoint; resume restores it; leaving defers the course", async () => {
  markNewJourneyAccount("erin");
  await post("erin", "course-start", { courseId: "people", mode: "review" });
  await post("erin", "course-confirm", { courseId: "people", stepId: "people-switch" });
  const paused = await post("erin", "course-pause");
  assert.equal(paused.journey.activeCourse, null);
  assert.equal(paused.journey.courses.people.result, "deferred");
  assert.equal(paused.journey.courses.people.checkpoint, "people-profile");
  const resumed = await post("erin", "course-start", { courseId: "people", mode: "first" });
  assert.equal(resumed.journey.activeCourse?.stepId, "people-profile");
  const left = await post("erin", "course-leave", { result: "deferred" });
  assert.equal(left.journey.activeCourse, null);
  const rewritten = await post("erin", "course-start", { courseId: "people", mode: "review" });
  assert.equal(rewritten.journey.activeCourse?.stepId, "people-switch");
});

await test("rewind only moves backwards inside the running course", async () => {
  markNewJourneyAccount("frank");
  await post("frank", "course-start", { courseId: "memory", mode: "review" });
  await post("frank", "course-confirm", { courseId: "memory", stepId: "memory-open" });
  const back = await post("frank", "course-rewind", { courseId: "memory", stepId: "memory-open" });
  assert.equal(back.journey.activeCourse?.stepId, "memory-open");
  await fails(() => post("frank", "course-rewind", { courseId: "memory", stepId: "memory-forget" }), 400);
});

await test("one active course at a time; starting another defers the first", async () => {
  markNewJourneyAccount("gina");
  await post("gina", "course-start", { courseId: "chat", mode: "review" });
  const journey = await current("gina");
  await fails(() => service.post("gina", { action: "course-start", courseId: "memory", expectedRevision: journey.revision }), 409);
});

await test("invalid course IDs, steps and evidence keys are rejected before any write", async () => {
  markNewJourneyAccount("hank");
  for (const body of [
    { action: "course-start", courseId: "main2", expectedRevision: 0 },
    { action: "course-start", courseId: "main", contentVersion: 99, expectedRevision: 0 },
    { action: "course-confirm", courseId: "main", stepId: "nope", expectedRevision: 0 },
    { action: "course-confirm", courseId: "main", stepId: "awakening-greet", evidence: "made-up", expectedRevision: 0 }
  ]) await fails(() => service.post("hank", body), 400);
  assert.equal((await current("hank")).revision, 0);
});

await test("a companion-created step can continue with an existing person and is recorded as reused", async () => {
  markNewJourneyAccount("kara");
  const person = await newCompanion("kara-person", "kara");
  await post("kara", "course-start", { courseId: "main", mode: "first" });
  for (const id of ["awakening-greet", "awakening-answer", "awakening-walk", "arrival-people", "arrival-chat", "arrival-tools", "lanterns-entry", "lanterns-pack"]) {
    await post("kara", "course-confirm", { courseId: "main", stepId: id });
  }
  context.renewalGroupStore ??= new Map();
  context.renewalGroupStore.set("kara-group", {
    id: "kara-group", userId: "kara", name: "留灯会", background: "", members: [], messages: [], memories: [],
    settings: { proactiveEnabled: false, intervalMinutes: 60, maxReplies: 2, autoChat: false, maxAutoRounds: 2, quietStart: "23:00", quietEnd: "07:00" },
    revision: 0, turn: 0, lastActivityAt: new Date().toISOString(), lastProactiveAt: null,
    // Created inside this run: evidence requires a timestamp after the run started.
    createdAt: new Date(Date.now() + 5000).toISOString(), updatedAt: new Date(Date.now() + 5000).toISOString()
  });
  for (const id of ["lanterns-install", "lanterns-read", "lanterns-continue", "creation-open", "creation-kind", "creation-name", "creation-addresses", "creation-style"]) {
    try { await post("kara", "course-confirm", { courseId: "main", stepId: id, ...(id === "lanterns-install" ? { evidence: "group-created", context: { groupId: "kara-group" } } : {}) }); } catch (e) { e.message += " @" + id; throw e; }
  }
  // Reusing an existing person clears the create gate without any new evidence.
  const reused = await post("kara", "reuse-companion", { resourceId: person.id, context: { companionId: person.id } });
  assert.equal(reused.journey.activeCourse?.stepId, "creation-submit");
  assert.equal(reused.journey.companionId, person.id);
  assert.equal(reused.journey.courses.main.reused, true);
  // A step that is not waiting on a created person refuses the switch.
  await fails(() => post("kara", "course-confirm", { courseId: "main", stepId: "creation-submit", evidence: "companion-created", resourceId: person.id }), 409);
  const skipped = await post("kara", "course-skip-step", { courseId: "main", stepId: "creation-submit" });
  assert.equal(skipped.journey.activeCourse?.stepId, "conversation-focus");
  const left = await post("kara", "course-leave", { result: "reused" });
  assert.equal(left.journey.courses.main.result, "reused");
  // Once a run is reused, later endings keep the reused label.
  const restarted = await post("kara", "course-start", { courseId: "main", mode: "review" });
  assert.equal(restarted.journey.activeCourse?.mode, "review");
});

await test("reuse is refused outside a created-person step and for foreign resources", async () => {
  markNewJourneyAccount("lena");
  await post("lena", "course-start", { courseId: "main", mode: "first" });
  await fails(() => post("lena", "reuse-companion", { resourceId: "a" }), 400);
  assert.equal((await current("lena")).courses.main?.reused, undefined);
});

/* ------------------------------ dismissals ------------------------------ */
await test("invitation refusals are stored per course and content version", async () => {
  markNewJourneyAccount("ivy");
  const first = await post("ivy", "dismiss-invite", { courseId: "voice" });
  assert.equal(first.journey.dismissedInvites.voice, getCourse("voice").contentVersion);
  const again = await post("ivy", "dismiss-invite", { courseId: "voice" });
  assert.deepEqual(again.journey.dismissedInvites, first.journey.dismissedInvites);
});

/* ------------------------------ legacy observe + CAS ------------------------------ */
await test("legacy observe keeps working for an un-migrated v1 client", async () => {
  context.renewalJourneyStore.set("jack", { version: 1, step: "creation", status: "active", companionId: null, revision: 0 });
  await newCompanion("jack-person", "jack");
  const next = await post("jack", "observe", { kind: "companion-created", companionId: "jack-person" });
  assert.equal(next.journey.step, "conversation");
  assert.equal(next.journey.companionId, "jack-person");
});

await test("simultaneous requests accept one revision; a stale retry cannot rewind", async () => {
  const revision = (await current("alice")).revision;
  const results = await Promise.allSettled([
    service.post("alice", { action: "start", expectedRevision: revision }),
    service.post("alice", { action: "skip", expectedRevision: revision })
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.status, 409);
});

/* ------------------------------ native snapshots ------------------------------ */
await test("native snapshots isolate accounts, restore v2 progress and keep old vaults legacy", async () => {
  const saved = codec.emptyState("alice");
  codec.hydrate(saved);
  assert.equal((await current("alice")).version, 2);
  const active = context.renewalJourneyStore.get("alice");
  active.activeCourse = { id: "main", contentVersion: 2, runId: "run-1234", stepId: "arrival-people", mode: "review", context: {}, startedAt: new Date().toISOString() };
  const snapshot = codec.snapshot();
  codec.hydrate(codec.emptyState("bob"));
  codec.hydrate(snapshot);
  assert.equal(context.renewalJourneyStore.get("alice").activeCourse.stepId, "arrival-people");
  assert.equal(context.renewalJourneyStore.has("bob"), false, "snapshot replaces the account store");
  // An old snapshot with no journey field still reads as legacy.
  codec.hydrate(codec.encode({}));
  assert.equal((await current("alice")).status, "legacy");
});

/* ------------------------------ Prisma path ------------------------------ */
await test("Prisma path runs the same rules, checks evidence and retries serialization failures", async () => {
  memory = false;
  assert.equal((await current("alice")).status, "legacy");
  assert.equal(rows.size, 0);
  serializationFailures = 1;
  await post("alice", "course-start", { courseId: "chat", mode: "review", context: { companionId: "a" } });
  await post("alice", "course-confirm", { courseId: "chat", stepId: "chat-input" });
  messages.set("ca", []);
  await fails(() => post("alice", "course-confirm", { courseId: "chat", stepId: "chat-send", evidence: "message-sent" }), 409);
  messages.set("ca", [{ role: "user", createdAt: new Date().toISOString() }]);
  await post("alice", "course-confirm", { courseId: "chat", stepId: "chat-send", evidence: "message-sent" });
  // Foreign companions are rejected inside the transaction.
  await fails(() => post("alice", "course-start", { courseId: "dream", mode: "review", context: { companionId: "b" } }), 409);
  const before = plain(await current("alice"));
  updateMiss = true;
  await fails(() => post("alice", "course-leave", { result: "deferred" }), 409);
  updateMiss = false;
  assert.deepEqual(plain(await current("alice")), before);
  serializationFailures = 3;
  await fails(() => post("alice", "course-leave", { result: "deferred" }), 409);
  memory = true;
});

/* ------------------------------ HTTP surface ------------------------------ */
await test("HTTP authentication, origin, bounded parsing and private errors", async () => {
  session = null; assert.equal((await GET()).status, 401);
  session = { userId: "alice" };
  const request = (body, origin = "https://fixture.test") => new Request("https://fixture.test/api/me/journey", { method: "POST", headers: { origin }, body });
  for (const origin of ["", "null", "https://foreign.test"]) assert.equal((await POST(request("{}", origin))).status, 403);
  assert.equal((await POST(request("{"))).status, 400);
  assert.equal((await POST(request(" ".repeat(5000)))).status, 400);
  const currentRevision = (await current("alice")).revision;
  const stale = await POST(request(JSON.stringify({ action: "start", expectedRevision: currentRevision + 5 })));
  assert.equal(stale.status, 409);
  assert.equal(stale.data.userId, "alice");
  externalFailure = true;
  memory = false; // Only the database path can fail; the fallback store cannot.
  const result = await GET();
  assert.equal(result.status, 503);
  assert(!JSON.stringify(result).includes("secret"));
  externalFailure = false;
  memory = true;
});

await test("account export/delete hooks preserve foreign journey and exclude secrets", async () => {
  memory = true;
  codec.hydrate(codec.emptyState());
  markNewJourneyAccount("alice");
  markNewJourneyAccount("bob");
  await post("bob", "course-start", { courseId: "chat", mode: "review" });
  const foreign = plain(await current("bob"));
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
  assert.equal(snapshot.journey.version, 2);
  assert(!JSON.stringify(snapshot).includes("fixture-secret"));
  assert(!JSON.stringify(snapshot).includes('"main"'), "foreign journey omitted");
  await deleteCurrentUserAccount("alice", { confirmation: "删除我的账号" });
  assert.equal(context.renewalJourneyStore.has("alice"), false);
  assert.deepEqual(plain(await current("bob")), foreign);
});

console.log(`journey-service: ${count} isolated checks passed`);
