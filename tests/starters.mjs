import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
let memoryMode = true, transactionFailure = false;
const db = { companions: new Map(), groups: new Map() };
const prisma = { $transaction: async run => {
  if (transactionFailure) throw new Error("offline write failed");
  const snapshot = structuredClone(db);
  const result = await run({
    companion: {
      findUnique: async ({ where }) => snapshot.companions.get(where.id) ?? null,
      upsert: async ({ where, create }) => {
        assert.ok(!Object.hasOwn(create.relationshipState.create, "companionId"));
        if (!snapshot.companions.has(where.id)) snapshot.companions.set(where.id, structuredClone(create));
        return snapshot.companions.get(where.id);
      }
    },
    groupWorkspace: { upsert: async ({ where, create }) => {
      if (!snapshot.groups.has(where.id)) snapshot.groups.set(where.id, structuredClone(create));
      return snapshot.groups.get(where.id);
    } }
  });
  db.companions = snapshot.companions; db.groups = snapshot.groups;
  return result;
} };
const stubs = {
  "node:crypto": { createHash },
  "@/lib/prisma": { prisma },
  "@/lib/persistence/memory-fallback": { shouldUseMemoryFallback: () => memoryMode },
  "@/lib/renewal/prisma-repository": { PrismaRenewalRepository: class {} }
};
const context = vm.createContext({ structuredClone, TextEncoder, TextDecoder, console });
const cache = new Map();
function load(specifier, parent = path.join(root, "entry.ts")) {
  const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(parent), specifier) : null;
  if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
  if (!base || !base.startsWith(root)) throw new Error("Blocked import " + specifier);
  const canonical = "@/" + path.relative(root, base).split(path.sep).join("/");
  if (Object.hasOwn(stubs, canonical)) return stubs[canonical];
  const filename = [base + ".ts", path.join(base, "index.ts")].find(existsSync);
  if (!filename) throw new Error("Missing import " + specifier);
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = { exports: {} }; cache.set(filename, compiled);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename });
  new vm.Script("(function(exports,require,module){" + outputText + "\n})", { filename }).runInContext(context)(compiled.exports, child => load(child, filename), compiled);
  return compiled.exports;
}
const { installStarterPack } = load("@/lib/starters/install");
const { InMemoryRenewalRepository } = load("@/lib/renewal/in-memory-repository");
const { MemoryGroupRepository } = load("@/lib/groups/repository");
const { STARTER_CHARACTERS } = load("@/lib/starters/catalog");
const plain = value => JSON.parse(JSON.stringify(value));

test("pack has six distinct young characters with online examples and no fabricated user history", async () => {
  memoryMode = true;
  const result = await installStarterPack("new-user");
  const renewal = new InMemoryRenewalRepository();
  const people = await renewal.listCompanions("new-user");
  assert.equal(people.length, 6);
  assert.equal(new Set(people.map(c => c.speakingStyle)).size, 6);
  assert.equal(new Set(people.map(c => c.name)).size, 6);
  for (const template of STARTER_CHARACTERS) assert.ok(template.age >= 18 && template.age <= 25);
  for (const person of people) {
    assert.equal(person.userId, "new-user");
    assert.equal(person.memories.length, 0);
    assert.equal(person.relationshipState.familiarityScore, 0);
    assert.equal(person.proactiveMessagesEnabled, false);
    assert.equal(person.proactiveFrequencyMinutes, 1440);
    assert.ok(!/社交媒体|觉醒|物理场景/.test(person.boundaries));
    const messages = await renewal.listMessages("new-user", person.conversationId);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, "assistant");
  }
  const group = await new MemoryGroupRepository(renewal).read("new-user", result.groupId);
  assert.equal(group.members.length, 6);
  assert.equal(group.messages.length, 0);
  assert.equal(group.memories.length, 0);
  assert.equal(group.settings.proactiveEnabled, false);
  assert.ok(group.members.every(m => !m.allowPrivateMemories));
  assert.match(group.background, /表姐妹/);
});

test("concurrent and repeated installs preserve edits, deleted greetings and group settings", async () => {
  memoryMode = true;
  const [first, concurrent] = await Promise.all([installStarterPack("repeat-user"), installStarterPack("repeat-user")]);
  assert.deepEqual(plain(first), plain(concurrent));
  const renewal = new InMemoryRenewalRepository();
  const groups = new MemoryGroupRepository(renewal);
  const person = (await renewal.listCompanions("repeat-user"))[0];
  await renewal.updateCompanion("repeat-user", person.id, { name: "我改的名字", speakingStyle: "我的语气" });
  const messages = await renewal.listMessages("repeat-user", person.conversationId);
  await renewal.deleteMessage("repeat-user", person.conversationId, messages[0].id);
  await groups.mutate("repeat-user", first.groupId, state => { state.name = "我改的群名"; state.messages.push({ id: "own-message", speakerId: null, content: "真实发过的话", createdAt: new Date().toISOString(), proactive: false }); return state; });
  const before = plain(await groups.read("repeat-user", first.groupId));
  await installStarterPack("repeat-user");
  assert.equal((await renewal.listCompanions("repeat-user")).length, 6);
  assert.equal((await renewal.getCompanion("repeat-user", person.id)).name, "我改的名字");
  assert.equal((await renewal.listMessages("repeat-user", person.conversationId)).length, 0);
  assert.deepEqual(plain(await groups.read("repeat-user", first.groupId)), before);
});

test("same-name custom contacts and other accounts remain independent", async () => {
  memoryMode = true;
  const renewal = new InMemoryRenewalRepository();
  const custom = await renewal.createCompanion("owner-a", { name: "林晚", relationshipKind: "CUSTOM", speakingStyle: "自定义风格" });
  const a = await installStarterPack("owner-a");
  const b = await installStarterPack("owner-b");
  assert.equal((await renewal.listCompanions("owner-a")).length, 7);
  assert.equal((await renewal.getCompanion("owner-a", custom.id)).speakingStyle, "自定义风格");
  assert.ok(!a.companionIds.some(id => b.companionIds.includes(id)));
  assert.equal(await renewal.getCompanion("owner-b", a.companionIds[0]), null);
  await assert.rejects(() => new MemoryGroupRepository().read("owner-b", a.groupId), error => error.status === 404);
});

test("Prisma install uses additive nested writes; failures never become memory success", async () => {
  memoryMode = false;
  try {
    const first = await installStarterPack("db-user");
    assert.equal(db.companions.size, 6);
    assert.equal(db.groups.size, 1);
    const row = db.companions.get(first.companionIds[0]);
    row.name = "保留数据库修改";
    const before = plain([...db.groups.values()]);
    await installStarterPack("db-user");
    assert.equal(db.companions.size, 6);
    assert.equal(db.companions.get(first.companionIds[0]).name, "保留数据库修改");
    assert.deepEqual(plain([...db.groups.values()]), before);
    transactionFailure = true;
    await assert.rejects(() => installStarterPack("failed-db-user"), /offline write failed/);
    assert.equal((await new InMemoryRenewalRepository().listCompanions("failed-db-user")).length, 0);
  } finally { transactionFailure = false; memoryMode = true; }
});
