import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import * as ts from "typescript";
import { loadLocalEnv } from "../scripts/load-local-env.mjs";
import { migrationDatabaseUrl } from "../scripts/database-url.mjs";

// Opt-in is checked BEFORE reading local credentials or creating any DB client.
// No existing schema is migrated, read for fixtures, reset, seeded or deleted.
if (process.env.GROUP_DATABASE_QA !== "1") {
  console.log("Group PostgreSQL QA skipped: set GROUP_DATABASE_QA=1 to opt in.");
  process.exit(0);
}
loadLocalEnv();
const configured = migrationDatabaseUrl();
if (!configured) throw new Error("A PostgreSQL migration URL is required.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const schema = `renewal_group_qa_${randomUUID().replaceAll("-", "")}`;
const schemaPattern = /^renewal_group_qa_[a-f0-9]{32}$/;
assert.match(schema, schemaPattern);
const url = new URL(configured);
assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
// Bootstrap executes only CREATE/DROP of our cryptographically named schema.
const bootstrap = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
url.searchParams.set("schema", schema);
const isolatedUrl = url.toString();
const groupQuerySchemas = new Set();
function newClient() {
  assert.equal(new URL(isolatedUrl).searchParams.get("schema"), schema);
  const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } }, log: [{ emit: "event", level: "query" }] });
  client.$on("query", event => {
    // Observe only the qualified schema of ORM group queries; never log SQL/params.
    for (const match of event.query.matchAll(/"([^"]+)"\."GroupWorkspace"/g)) groupQuerySchemas.add(match[1]);
  });
  return client;
}
let prisma = newClient();
let peer;
let created = false;
let step = "create isolated schema";
function migrationDiagnostics(result) {
  // Extract only allowlisted tokens. Prisma output may contain credentials,
  // hostnames and SQL; never print a raw line, even on spawn/timeout failures.
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const codes = [...new Set(output.match(/\bP\d{4}\b/g) ?? [])];
  const migrations = readdirSync(resolve(root, "prisma/migrations"))
    .filter(name => /^\d{14}_[a-z0-9_]+$/.test(name) && output.includes(name));
  const spawnCode = ["EACCES", "EPERM", "ENOENT", "ETIMEDOUT", "ENOBUFS"].includes(result.error?.code) ? result.error.code : "none";
  const hints = [
    [/certificate|TLS|SSL/i, "tls"], [/ENOTFOUND|EAI_AGAIN|resolve.*host/i, "dns"],
    [/Can't reach database|connection.*(refused|timed out)/i, "database-unreachable"],
    [/spawn.*EPERM|operation not permitted/i, "spawn-denied"],
    [/schema engine|schema-engine/i, "schema-engine"], [/advisory lock/i, "advisory-lock"],
    [/permission denied/i, "permission-denied"]
  ].filter(([pattern]) => pattern.test(output)).map(([, hint]) => hint);
  console.error(`Isolated migration diagnostics: exit=${Number.isInteger(result.status) ? result.status : "none"}; spawn=${spawnCode}; codes=${codes.join(",") || "none"}; migrations=${migrations.join(",") || "none"}; hints=${hints.join(",") || "none"}.`);
}
try {
  await bootstrap.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  step = "apply all versioned migrations including group workspace";
  const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 120_000,
    // Override both URLs so a future directUrl cannot select the real schema.
    env: { ...process.env, DATABASE_URL: isolatedUrl, DATABASE_URL_UNPOOLED: isolatedUrl }
  });
  if (migration.status !== 0) migrationDiagnostics(migration);
  assert.equal(migration.status, 0, "Isolated migrations failed.");
  step = "verify migrations in the explicit temporary schema";
  // Prisma qualifies ORM tables using the URL schema. A raw current_schema()
  // can report a different session search_path and does not prove ORM routing.
  assert.match(schema, schemaPattern);
  const applied = await prisma.$queryRawUnsafe(`SELECT migration_name FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  const expectedMigrations = readdirSync(resolve(root, "prisma/migrations"))
    .filter(name => /^\d{14}_[a-z0-9_]+$/.test(name));
  assert.deepEqual(applied.map(row => row.migration_name).sort(), expectedMigrations.sort());
  step = "verify migrated group table is empty";
  assert.equal(await prisma.groupWorkspace.count(), 0);
  assert.deepEqual([...groupQuerySchemas], [schema]);
  console.log("ok - versioned group migration applied only in own empty temporary schema");

  const modules = new Map();
  const forbidden = () => { throw new Error("Unexpected provider operation"); };
  function load(filename) {
    if (!existsSync(filename) && filename.endsWith(".ts")) filename = resolve(filename.slice(0, -3), "index.ts");
    if (modules.has(filename)) return modules.get(filename).exports;
    const compiled = { exports: {} };
    modules.set(filename, compiled);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    const scopedRequire = id => {
      if (id === "@/lib/prisma") return { get prisma() { return prisma; } };
      if (id === "@/lib/persistence/memory-fallback") return { shouldUseMemoryFallback: () => false, shouldFallbackToMemoryOnPrismaError: () => false };
      if (id === "@/lib/llm/user-provider") return { createUserLlmProvider: forbidden };
      if (id === "@/lib/usage") return { recordModelUsage: async () => null };
      if (id.startsWith("@/")) return load(resolve(root, "src", `${id.slice(2)}.ts`));
      if (id.startsWith(".")) return load(resolve(dirname(filename), `${id}.ts`));
      return require(id);
    };
    new Function("exports", "require", "module", output)(compiled.exports, scopedRequire, compiled);
    return compiled.exports;
  }
  const { PrismaRenewalRepository } = load(resolve(root, "src/lib/renewal/prisma-repository.ts"));
  const { PrismaGroupRepository } = load(resolve(root, "src/lib/groups/repository.ts"));
  const { GroupService } = load(resolve(root, "src/lib/groups/service.ts"));
  const userId = randomUUID(), strangerId = randomUUID();
  await prisma.user.createMany({ data: [userId, strangerId].map(id => ({ id, email: `${id}@example.invalid`, nickname: "群聊临时验收" })) });
  const renewal = new PrismaRenewalRepository();
  const people = [];
  for (const name of ["隔离小林", "隔离小夏"]) {
    people.push(await renewal.createCompanion(userId, { name, relationshipKind: "FRIEND", personality: ["直接"], speakingStyle: "平实简短", proactiveMessagesEnabled: false }));
  }
  const makeService = () => new GroupService({
    repository: new PrismaGroupRepository(prisma, renewal),
    selectGroupSpeakers: (_group, companions) => companions.map(c => c.id),
    generateGroupReply: async (_userId, group, _companions, speakerId) => ({
      content: `隔离本地回复 ${speakerId}，已见 ${group.messages.length} 条消息`, source: "local"
    }),
    getUserProfile: async () => ({ timezone: "Asia/Shanghai", proactiveMessagesEnabled: false })
  });
  let service = makeService();
  step = "persist messages, ordered replies, settings and sourced memory";
  let group = await service.create(userId, { name: "临时群聊", background: "仅用于隔离验收", companionIds: people.map(p => p.id) });
  const action = { action: "message", content: "周末公园散步", clientId: randomUUID() };
  const sent = await service.post(userId, group.id, action);
  assert.equal(sent.group.messages.length, 1);
  assert.equal(sent.group.messages[0].speakerId, null);
  assert.equal(sent.speakers.length, 2);
  assert.deepEqual((await service.post(userId, group.id, action)).group, sent.group);
  await assert.rejects(() => service.post(userId, group.id, { action: "reply", turn: sent.group.turn, speakerId: sent.speakers[1] }), e => e.status === 409);
  group = sent.group;
  for (const speakerId of sent.speakers) {
    const result = await service.post(userId, group.id, { action: "reply", turn: sent.group.turn, speakerId });
    assert.equal(result.source, "local");
    assert.equal(result.group.messages.length, group.messages.length + 1);
    assert.deepEqual(result.group.messages.slice(0, -1), group.messages);
    group = result.group;
  }
  group = (await service.post(userId, group.id, { action: "remember", revision: group.revision,
    content: "周末公园散步", sourceMessageIds: [group.messages[0].id], knownBy: [people[0].id] })).group;
  group = (await service.post(userId, group.id, { action: "update", revision: group.revision,
    name: "持久化茶馆", background: "保存新背景", members: group.members.map((m, i) => ({ ...m, relationship: i ? "朋友" : "老朋友" })),
    settings: { ...group.settings, intervalMinutes: 30, maxReplies: 2 } })).group;
  const originalId = group.id;
  await prisma.$disconnect();
  prisma = newClient();
  service = makeService(); // Repositories capture their client; construct again after reconnect.
  assert.deepEqual(await service.get(userId, group.id), group);
  assert.equal((await service.list(userId))[0].lastMessage.id, group.messages.at(-1).id);
  assert.deepEqual(group.memories[0].sourceMessageIds, [group.messages[0].id]);
  assert.deepEqual(group.memories[0].knownBy, [people[0].id]);
  assert.equal(group.memories[0].confirmed, true);
  assert.equal(await prisma.message.count(), 0);
  assert.equal(await prisma.memory.count(), 0);
  console.log("ok - messages, ordered replies, settings and memory provenance survive reconnect; private history untouched");

  step = "ownership isolation and stale turn/revision";
  assert.deepEqual(await service.list(strangerId), []);
  await assert.rejects(() => service.get(strangerId, group.id), e => e.status === 404);
  await assert.rejects(() => service.delete(strangerId, group.id), e => e.status === 404);
  await assert.rejects(() => service.post(strangerId, group.id, action), e => e.status === 404);
  await assert.rejects(() => service.create(strangerId, { name: "越权", companionIds: people.map(p => p.id) }), e => e.status === 404);
  await assert.rejects(() => service.post(userId, group.id, { action: "remember", revision: sent.group.revision,
    content: "过期记忆", sourceMessageIds: [group.messages[0].id], knownBy: [people[0].id] }), e => e.status === 409);
  const newest = await service.post(userId, group.id, { action: "message", content: "新轮次", clientId: randomUUID() });
  await assert.rejects(() => service.post(userId, group.id, { action: "reply", turn: sent.group.turn, speakerId: sent.speakers[0] }), e => e.status === 409);
  assert.deepEqual(await service.get(userId, group.id), newest.group);
  console.log("ok - foreign owners, stale turns and stale revisions cannot alter persisted state");

  step = "database compare-and-swap across independent connections";
  peer = newClient();
  const left = new PrismaGroupRepository(prisma, renewal);
  const right = new PrismaGroupRepository(peer, renewal);
  const snapshot = await left.read(userId, group.id);
  // Pin the same observed revision for both writers, deterministically forcing
  // a DB CAS collision without timing sleeps or bypassing the real updateMany.
  for (const repository of [left, right]) {
    repository.read = async (owner, id) => {
      assert.equal(owner, userId); assert.equal(id, snapshot.id);
      return structuredClone(snapshot);
    };
  }
  const race = await Promise.allSettled([
    left.mutate(userId, group.id, state => ({ ...state, name: "CAS-left" })),
    right.mutate(userId, group.id, state => ({ ...state, name: "CAS-right" }))
  ]);
  const winners = race.filter(r => r.status === "fulfilled");
  const losers = race.filter(r => r.status === "rejected");
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason.status, 409);
  const persisted = await new PrismaGroupRepository(peer, renewal).read(userId, group.id);
  assert.deepEqual(persisted, winners[0].value);
  assert.equal(persisted.revision, snapshot.revision + 1);
  const row = await peer.groupWorkspace.findUnique({ where: { id: group.id } });
  assert.equal(row.revision, persisted.revision);
  assert.equal(row.state.revision, persisted.revision);
  console.log("ok - concurrent connections produce one CAS winner and one 409 without a lost update");

  step = "failed mutations leave no partial snapshot";
  const repository = new PrismaGroupRepository(prisma, renewal);
  const before = await repository.read(userId, group.id);
  await assert.rejects(() => repository.mutate(userId, group.id, state => {
    state.name = "MUST_NOT_PERSIST";
    throw new Error("intentional callback failure");
  }));
  assert.deepEqual(await repository.read(userId, group.id), before);

  step = "group deletion and account cascade";
  const disposable = await service.create(userId, { name: "单群删除", companionIds: [people[0].id] });
  await service.delete(userId, disposable.id);
  assert.equal(await prisma.groupWorkspace.count({ where: { id: disposable.id } }), 0);
  assert.equal(await prisma.groupWorkspace.count({ where: { id: originalId } }), 1);
  const foreignPerson = await renewal.createCompanion(strangerId, { name: "其他账号人物", relationshipKind: "FRIEND", personality: [], speakingStyle: "自然", proactiveMessagesEnabled: false });
  const foreignGroup = await service.create(strangerId, { name: "其他账号群聊", companionIds: [foreignPerson.id] });
  await prisma.user.delete({ where: { id: userId } });
  assert.equal(await prisma.groupWorkspace.count({ where: { userId } }), 0);
  assert.equal(await prisma.groupWorkspace.count({ where: { id: originalId } }), 0);
  assert.equal(await prisma.groupWorkspace.count({ where: { id: foreignGroup.id, userId: strangerId } }), 1);
  console.log("ok - deleting a group preserves siblings; account cascade removes only owned groups");
} catch (error) {
  // Never print raw Prisma errors, connection strings, query data or child output.
  console.error(`Group PostgreSQL QA failed at ${step}; type=${error?.constructor?.name ?? "unknown"}; code=${typeof error?.code === "string" ? error.code : "check_failed"}; status=${typeof error?.status === "number" ? error.status : "none"}.`);
  const line = error?.stack?.match(/group-postgres\.mjs:(\d+):\d+/)?.[1];
  if (line) console.error(`QA script assertion/error line=${line}.`);
  process.exitCode = 1;
} finally {
  // A failed disconnect must not prevent our own schema cleanup.
  try {
    await Promise.allSettled([prisma.$disconnect(), peer?.$disconnect()]);
    if (created) {
      assert.match(schema, schemaPattern);
      assert.equal(new URL(isolatedUrl).searchParams.get("schema"), schema);
      await bootstrap.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      console.log("ok - own temporary schema removed");
    }
  } finally { await bootstrap.$disconnect(); }
}
