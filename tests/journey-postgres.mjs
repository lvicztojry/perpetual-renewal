import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import ts from "typescript";
import { loadLocalEnv } from "../scripts/load-local-env.mjs";
import { migrationDatabaseUrl } from "../scripts/database-url.mjs";

// Gate before credentials are loaded or any client is constructed.
if (process.env.JOURNEY_DATABASE_QA !== "1") {
  console.log("Journey PostgreSQL QA skipped: set JOURNEY_DATABASE_QA=1 to opt in.");
  process.exit(0);
}
loadLocalEnv();
const configured = migrationDatabaseUrl();
if (!configured) throw new Error("A direct PostgreSQL migration URL is required.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = `renewal_journey_qa_${randomUUID().replaceAll("-", "")}`;
const pattern = /^renewal_journey_qa_[a-f0-9]{32}$/;
assert.match(schema, pattern);
const url = new URL(configured);
assert(["postgres:", "postgresql:"].includes(url.protocol));
assert(!url.hostname.includes("-pooler"), "Use a direct migration connection.");
const bootstrap = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
url.searchParams.set("schema", schema);
const isolatedUrl = url.toString();
const observedSchemas = new Set();
function newClient() {
  assert.equal(new URL(isolatedUrl).searchParams.get("schema"), schema);
  const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } }, log: [{ emit: "event", level: "query" }] });
  client.$on("query", event => {
    // Record only table qualification, never SQL, parameters, or credentials.
    for (const match of event.query.matchAll(/"([^"]+)"\."UserJourney"/g)) observedSchemas.add(match[1]);
  });
  return client;
}
let left, right, created = false, step = "create temporary schema";
function makeService(client) {
  const modules = new Map();
  // Mirrors the bundler's resolution: a `.ts` file first, then a directory index.
  function resolveModule(base) {
    for (const candidate of [`${base}.ts`, resolve(base, "index.ts")]) {
      try { readFileSync(candidate, "utf8"); return candidate; } catch { /* Try the next shape. */ }
    }
    throw new Error("Unresolved journey module");
  }
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const mod = { exports: {} }; modules.set(filename, mod);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    function scopedRequire(id) {
      if (id === "@/lib/prisma") return { prisma: client };
      if (id === "@/lib/persistence/memory-fallback") return { shouldUseMemoryFallback: () => false };
      if (id.startsWith("@/lib/journey/")) return load(resolveModule(resolve(root, "src", `${id.slice(2)}`)));
      if (id.startsWith(".")) return load(resolveModule(resolve(dirname(filename), id)));
      throw new Error("Unexpected external operation");
    }
    new Function("exports", "require", "module", output)(mod.exports, scopedRequire, mod);
    return mod.exports;
  }
  return new (load(resolve(root, "src/lib/journey/service.ts")).JourneyService)();
}
try {
  await bootstrap.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
  step = "apply all migrations in temporary schema";
  const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000,
    env: { ...process.env, DATABASE_URL: isolatedUrl, DATABASE_URL_UNPOOLED: isolatedUrl, DIRECT_URL: isolatedUrl }
  });
  // Raw Prisma output can contain credentials; report only allowlisted error codes.
  if (migration.status !== 0) {
    const codes = [...new Set(`${migration.stdout ?? ""}\n${migration.stderr ?? ""}`.match(/\bP\d{4}\b/g) ?? [])];
    console.error(`Isolated migration failed; exit=${Number.isInteger(migration.status) ? migration.status : "none"}; codes=${codes.join(",") || "none"}.`);
    throw new Error("Isolated migrations failed");
  }
  left = newClient(); right = newClient();
  const expected = readdirSync(resolve(root, "prisma/migrations")).filter(name => /^\d{14}_[a-z0-9_]+$/.test(name)).sort();
  const applied = await left.$queryRawUnsafe(`SELECT migration_name FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  assert.deepEqual(applied.map(r => r.migration_name).sort(), expected);
  assert.equal(await left.userJourney.count(), 0);
  assert.deepEqual([...observedSchemas], [schema]);
  console.log("ok - all versioned migrations applied only to own empty random schema");

  const a = randomUUID(), b = randomUUID();
  await left.user.createMany({ data: [a, b].map(id => ({ id, email: `${id}@example.invalid`, nickname: "Journey QA" })) });
  const one = makeService(left), two = makeService(right);
  const post = async (user, action, extra = {}) => one.post(user, { action, expectedRevision: (await one.get(user)).journey.revision, ...extra });
  const fails = (fn, status) => assert.rejects(fn, e => e.status === status);
  const confirm = async (stepId, extra = {}) => post(a, "course-confirm", { courseId: "main", stepId, ...extra });
  const skip = async (stepId) => post(a, "course-skip-step", { courseId: "main", stepId });

  step = "read only legacy and two-client first-row CAS";
  assert.equal((await one.get(a)).journey.status, "legacy");
  assert.equal((await two.get(a)).journey.revision, 0);
  assert.equal(await left.userJourney.count(), 0);
  let raced = await Promise.allSettled([
    one.post(a, { action: "course-start", courseId: "main", mode: "first", expectedRevision: 0 }),
    two.post(a, { action: "dismiss-invite", courseId: "voice", expectedRevision: 0 })
  ]);
  assert.equal(raced.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(raced.find(r => r.status === "rejected").reason.status, 409);
  assert.deepEqual(await two.get(a), raced.find(r => r.status === "fulfilled").value);

  step = "two-client existing-row CAS and stale retry";
  const revision = (await one.get(a)).journey.revision;
  raced = await Promise.allSettled([
    one.post(a, { action: "dismiss-invite", courseId: "voice", expectedRevision: revision }),
    two.post(a, { action: "dismiss-invite", courseId: "model", expectedRevision: revision })
  ]);
  assert.equal(raced.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(raced.find(r => r.status === "rejected").reason.status, 409);
  const winner = raced.find(r => r.status === "fulfilled").value;
  assert.deepEqual(await two.get(a), winner);
  await fails(() => one.post(a, { action: "dismiss-invite", courseId: "voice", expectedRevision: revision }), 409);
  assert.deepEqual(await two.get(a), winner);
  console.log("ok - independent clients enforce CAS for missing and existing rows, stale receipts preserve winner");

  step = "resource ownership and real persisted USER/dream evidence";
  // Created before the run starts, so it can never satisfy "created inside this run".
  const person = await left.companion.create({ data: { userId: a, name: "Owned", relationshipKind: "FRIEND", personality: [], speakingStyle: "plain" } });
  const foreign = await left.companion.create({ data: { userId: b, name: "Foreign", relationshipKind: "FRIEND", personality: [], speakingStyle: "plain" } });
  const thread = await left.conversation.create({ data: { userId: a, companionId: person.id } });
  const foreignThread = await left.conversation.create({ data: { userId: b, companionId: foreign.id } });
  const personId = person.id;

  // A run from the CAS race may still be open; leave it so the v2 walk starts clean.
  if ((await one.get(a)).journey.activeCourse) await post(a, "course-leave", { result: "deferred" });
  const started = await post(a, "course-start", { courseId: "main", mode: "first" });
  assert.equal(started.journey.activeCourse?.id, "main");
  assert.equal(started.journey.activeCourse?.stepId, "awakening-greet");
  for (const id of ["awakening-greet", "awakening-answer", "awakening-walk", "arrival-people", "arrival-chat", "arrival-tools", "lanterns-entry", "lanterns-pack"]) {
    await confirm(id);
  }
  // The group is created after the run began, so `group-created` evidence is real.
  const group = await left.groupWorkspace.create({ data: { id: randomUUID(), userId: a, revision: 1, state: { messages: [] } } });
  const groupCreated = await confirm("lanterns-install", { evidence: "group-created" });
  assert.equal(groupCreated.journey.activeCourse?.stepId, "lanterns-read");
  // A group that predates the run cannot satisfy the same step on a later attempt.
  for (const id of ["lanterns-read", "lanterns-continue", "creation-open", "creation-kind", "creation-name", "creation-addresses", "creation-style"]) {
    await confirm(id);
  }

  // Ownership is checked before "was it recent enough".
  await fails(() => confirm("creation-submit", { evidence: "companion-created", resourceId: foreign.id }), 404);
  // A person that existed before this run never counts as created by it.
  await fails(() => confirm("creation-submit", { evidence: "companion-created", resourceId: personId }), 409);
  // Reusing the existing person is the honest way past the create gate.
  const reused = await post(a, "reuse-companion", { resourceId: personId, context: { companionId: personId } });
  assert.equal(reused.journey.activeCourse?.stepId, "creation-submit");
  assert.equal(reused.journey.companionId, personId);
  assert.equal(reused.journey.courses.main.reused, true);
  // A real update inside the run does satisfy the step.
  await left.companion.update({ where: { id: personId }, data: { speakingStyle: "plain and warm" } });
  const created2 = await confirm("creation-submit", { evidence: "companion-created", resourceId: personId });
  assert.equal(created2.journey.activeCourse?.stepId, "conversation-focus");
  assert.equal(created2.journey.companionId, personId);

  await confirm("conversation-focus");
  await confirm("conversation-input");
  await left.message.create({ data: { conversationId: foreignThread.id, role: "USER", content: "foreign fixture" } });
  await fails(() => confirm("conversation-send", { evidence: "message-sent", resourceId: foreign.id }), 404);
  // Someone else's message never satisfies this account's step.
  await fails(() => confirm("conversation-send", { evidence: "message-sent" }), 409);
  await left.message.create({ data: { conversationId: thread.id, role: "USER", content: "persisted fixture" } });
  await confirm("conversation-send", { evidence: "message-sent" });
  await fails(() => confirm("conversation-reply", { evidence: "assistant-replied" }), 409);
  await left.message.create({ data: { conversationId: thread.id, role: "ASSISTANT", content: "reply fixture" } });
  await confirm("conversation-reply", { evidence: "assistant-replied" });

  await confirm("dream-open");
  await fails(() => confirm("dream-start", { evidence: "dream-started" }), 409);
  await left.dreamWorkspace.create({ data: { id: randomUUID(), userId: b, companionId: foreign.id, revision: 1, state: {} } });
  await fails(() => confirm("dream-start", { evidence: "dream-started" }), 409);
  await left.dreamWorkspace.create({ data: { id: randomUUID(), userId: a, companionId: personId, revision: 1, state: { status: "draft", rounds: [] } } });
  await confirm("dream-start", { evidence: "dream-started" });
  await confirm("dream-situation");
  await left.dreamWorkspace.update({
    where: { companionId: personId },
    data: { state: { status: "draft", rounds: [{ createdAt: new Date().toISOString(), reply: "echo" }] } }
  });
  await confirm("dream-generate", { evidence: "dream-generated" });
  await left.dreamWorkspace.update({
    where: { companionId: personId },
    data: { state: { status: "draft", rounds: [{ createdAt: new Date().toISOString(), reply: "echo", feedback: { choice: 1 } }] } }
  });
  await confirm("dream-feedback", { evidence: "dream-feedback-recorded" });
  for (const id of ["dream-review", "complete-recap", "complete-entry", "complete-directory"]) await confirm(id);
  const finished = await confirm("complete-end");
  assert.equal(finished.journey.activeCourse, null);
  assert.equal(finished.journey.status, "completed");
  // The reused run is recorded as reused, never as a fresh creation.
  assert.equal(finished.journey.courses.main.result, "reused");
  assert.equal(finished.journey.courses.main.checkpoint, null);
  assert.equal(finished.journey.step, "complete");
  assert.equal((await two.get(b)).journey.status, "legacy");
  assert.equal(await left.message.count({ where: { conversationId: thread.id } }), 2);
  assert.equal(await left.groupWorkspace.count({ where: { id: group.id } }), 1);
  console.log("ok - foreign and fabricated evidence fails; owned persisted resources finish a reused run without altering history");

  step = "skipping a step advances without a milestone";
  const reviewStart = await post(a, "course-start", { courseId: "main", mode: "review" });
  assert.equal(reviewStart.journey.activeCourse?.mode, "review");
  assert.equal(reviewStart.journey.activeCourse?.stepId, "awakening-greet");
  const afterSkip = await skip("awakening-greet");
  assert.equal(afterSkip.journey.activeCourse?.stepId, "awakening-answer");
  // A skipped step adds no milestone, and a review never grows the record.
  assert.deepEqual(afterSkip.journey.courses.main.milestones, finished.journey.courses.main.milestones);
  assert.equal(afterSkip.journey.courses.main.result, "reused", "replaying never downgrades the recorded result");
  await post(a, "course-leave", { result: "deferred" });
  console.log("ok - skipping advances without a milestone and keeps the stronger result");

  step = "new account nested initialization and owned account cascade";
  const fresh = await left.user.create({ data: { email: `${randomUUID()}@example.invalid`, nickname: "New", journey: { create: { revision: 0, state: { version: 1, step: "awakening", status: "active", companionId: null, revision: 0 } } } } });
  const lifted = await two.get(fresh.id);
  assert.equal(lifted.journey.version, 2);
  assert.equal(lifted.journey.status, "active");
  assert.equal(lifted.journey.revision, 0);
  // Reading a v1 row upgrades it in memory only.
  assert.equal((await left.userJourney.findUnique({ where: { userId: fresh.id } })).state.version, 1);
  await post(b, "start"); const foreignJourney = await two.get(b);
  await left.user.delete({ where: { id: a } });
  assert.equal(await right.userJourney.count({ where: { userId: a } }), 0);
  assert.equal((await two.get(a)).journey.status, "legacy");
  assert.deepEqual(await two.get(b), foreignJourney);
  assert.equal((await two.get(fresh.id)).journey.status, "active");
  assert.deepEqual([...observedSchemas], [schema]);
  console.log("ok - v1 rows lift without a write, and account cascade preserves foreign journey");
} catch (error) {
  const code = /^P\d{4}$/.test(error?.code ?? "") ? error.code : "check_failed";
  console.error(`Journey PostgreSQL QA failed at ${step}; code=${code}; status=${Number.isInteger(error?.status) ? error.status : "none"}.`);
  const line = error?.stack?.match(/journey-postgres\.mjs:(\d+):\d+/)?.[1];
  if (line) console.error(`QA assertion/error line=${line}.`);
  process.exitCode = 1;
} finally {
  try {
    await Promise.allSettled([left?.$disconnect(), right?.$disconnect()]);
    if (created) {
      assert.match(schema, pattern);
      assert.equal(new URL(isolatedUrl).searchParams.get("schema"), schema);
      await bootstrap.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      console.log("ok - own temporary schema removed");
    }
  } finally { await bootstrap.$disconnect(); }
}
