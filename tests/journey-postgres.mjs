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
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const mod = { exports: {} }; modules.set(filename, mod);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    function scopedRequire(id) {
      if (id === "@/lib/prisma") return { prisma: client };
      if (id === "@/lib/persistence/memory-fallback") return { shouldUseMemoryFallback: () => false };
      if (id.startsWith("@/lib/journey/")) return load(resolve(root, "src", `${id.slice(2)}.ts`));
      if (id.startsWith(".")) return load(resolve(dirname(filename), `${id}.ts`));
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
  const observe = (kind, companionId) => post(a, "observe", { kind, companionId });
  const fails = (fn, status) => assert.rejects(fn, e => e.status === status);
  step = "read only legacy and two-client first-row CAS";
  assert.equal((await one.get(a)).journey.status, "legacy");
  assert.equal((await two.get(a)).journey.revision, 0);
  assert.equal(await left.userJourney.count(), 0);
  let raced = await Promise.allSettled([one.post(a, { action: "start", expectedRevision: 0 }), two.post(a, { action: "skip", expectedRevision: 0 })]);
  assert.equal(raced.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(raced.find(r => r.status === "rejected").reason.status, 409);
  assert.deepEqual(await two.get(a), raced.find(r => r.status === "fulfilled").value);
  step = "two-client existing-row CAS and stale retry";
  const revision = (await one.get(a)).journey.revision;
  raced = await Promise.allSettled([one.post(a, { action: "start", expectedRevision: revision }), two.post(a, { action: "skip", expectedRevision: revision })]);
  assert.equal(raced.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(raced.find(r => r.status === "rejected").reason.status, 409);
  const winner = raced.find(r => r.status === "fulfilled").value;
  assert.deepEqual(await two.get(a), winner);
  await fails(() => one.post(a, { action: "start", expectedRevision: revision }), 409);
  assert.deepEqual(await two.get(a), winner);
  console.log("ok - independent clients enforce CAS for missing and existing rows, stale receipts preserve winner");

  step = "resource ownership and real persisted USER/dream evidence";
  const person = await left.companion.create({ data: { userId: a, name: "Owned", relationshipKind: "FRIEND", personality: [], speakingStyle: "plain" } });
  const foreign = await left.companion.create({ data: { userId: b, name: "Foreign", relationshipKind: "FRIEND", personality: [], speakingStyle: "plain" } });
  const thread = await left.conversation.create({ data: { userId: a, companionId: person.id } });
  const foreignThread = await left.conversation.create({ data: { userId: b, companionId: foreign.id } });
  await post(a, "start"); for (let i = 0; i < 3; i++) await post(a, "advance");
  await fails(() => observe("companion-created", foreign.id), 404);
  await observe("companion-created", person.id);
  await left.message.create({ data: { conversationId: thread.id, role: "ASSISTANT", content: "fixture" } });
  await left.message.create({ data: { conversationId: foreignThread.id, role: "USER", content: "foreign fixture" } });
  await fails(() => observe("message-sent", person.id), 400);
  await fails(() => observe("message-sent", foreign.id), 400);
  await left.message.create({ data: { conversationId: thread.id, role: "USER", content: "persisted fixture" } });
  await observe("message-sent", person.id);
  await fails(() => observe("dream-started", person.id), 400);
  await left.dreamWorkspace.create({ data: { id: randomUUID(), userId: b, companionId: foreign.id, revision: 1, state: {} } });
  await fails(() => observe("dream-started", person.id), 400);
  await left.dreamWorkspace.create({ data: { id: randomUUID(), userId: a, companionId: person.id, revision: 1, state: {} } });
  assert.equal((await observe("dream-started", person.id)).journey.status, "completed");
  assert.equal((await two.get(b)).journey.status, "legacy");
  assert.equal(await left.message.count({ where: { conversationId: thread.id } }), 2);
  console.log("ok - foreign and fabricated milestones fail; owned persisted resources complete journey without altering history");

  step = "new account nested initialization and owned account cascade";
  const fresh = await left.user.create({ data: { email: `${randomUUID()}@example.invalid`, nickname: "New", journey: { create: { revision: 0, state: { version: 1, step: "awakening", status: "active", companionId: null, revision: 0 } } } } });
  assert.equal((await two.get(fresh.id)).journey.status, "active");
  await post(b, "start"); const foreignJourney = await two.get(b);
  await left.user.delete({ where: { id: a } });
  assert.equal(await right.userJourney.count({ where: { userId: a } }), 0);
  assert.deepEqual(await two.get(b), foreignJourney);
  assert.equal((await two.get(fresh.id)).journey.status, "active");
  assert.deepEqual([...observedSchemas], [schema]);
  console.log("ok - new account nested initialization and account cascade preserve foreign journey");
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
