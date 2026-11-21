import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const plain = value => JSON.parse(JSON.stringify(value));
const stamp = "2026-11-17T10:00:00.000Z";
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function barrier() {
  const entered = deferred(), release = deferred();
  return { entered, release, async wait() { entered.resolve(); await release.promise; } };
}

function fixture() {
  // Fresh globals per test; never import Prisma, read env, or initialize a database.
  const context = vm.createContext({ structuredClone });
  const groups = barrier(), dreams = barrier();
  const mocks = new Map([
    ["node:crypto", { randomUUID }],
    ["@/lib/prisma", { prisma: new Proxy({}, { get() { throw new Error("Database access is forbidden in this test"); } }) }],
    ["@/lib/persistence/memory-fallback", { shouldUseMemoryFallback: () => true, shouldFallbackToMemoryOnPrismaError: () => false }],
    ["@/lib/groups/repository", { deleteGroupsForAccount: () => groups.wait() }],
    ["@/lib/dream/repository", { deleteDreamWorkspaces: () => dreams.wait() }],
    ["./relationship-state-adapter", { updateRelationshipRecordAfterMessage() { throw new Error("Unexpected relationship update"); } }]
  ]);
  const modules = new Map();
  function load(name, parent = resolve(root, "entry.ts")) {
    if (mocks.has(name)) return mocks.get(name);
    const path = name.startsWith("@/") ? resolve(root, name.slice(2) + ".ts") : resolve(dirname(parent), name + ".ts");
    assert.ok(path.startsWith(root));
    if (modules.has(path)) return modules.get(path).exports;
    const mod = { exports: {} };
    modules.set(path, mod);
    const output = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    new vm.Script(`(function(exports,require,module){${output}\n})`, { filename: path })
      .runInContext(context)(mod.exports, child => load(child, path), mod);
    return mod.exports;
  }
  const memory = (id, userId, status = "active") => ({
    id, userId, companionId: `companion-${userId}`, sourceMessageId: `source-${id}`,
    type: "user_fact", status, content: `private-fact-${id}`, confidence: .8,
    createdAt: stamp, updatedAt: stamp, supersededById: null
  });
  context.renewalStore = {
    companions: ["u", "other"].map(userId => ({ id: `companion-${userId}`, userId })),
    conversations: ["u", "other"].map(userId => ({ id: `conversation-${userId}`, userId, companionId: `companion-${userId}` })),
    relationshipStates: ["u", "other"].map(userId => ({ companionId: `companion-${userId}` })),
    messages: [], proactiveMessages: [],
    memories: [memory("old", "u"), memory("next", "u", "pending"), memory("foreign", "other")]
  };
  const lifecycle = load("@/lib/memory/lifecycle");
  for (const [userId, memoryId] of [["u", "old"], ["other", "foreign"]]) {
    lifecycle.applyMemoryChangeInStore(context.renewalStore.memories, userId, memoryId,
      { action: "edit", expectedUpdatedAt: stamp, content: `corrected-private-fact-${memoryId}` }, randomUUID);
  }
  const foreignMemory = plain(context.renewalStore.memories.filter(row => row.userId === "other"));
  const foreignHistory = plain(lifecycle.memoryRevisionStore().filter(row => row.userId === "other"));
  const deletion = load("@/lib/users/delete-account");
  const service = load("@/lib/memory/lifecycle-service");
  const repository = load("@/lib/renewal/in-memory-repository");
  const old = context.renewalStore.memories.find(row => row.id === "old");
  const change = { action: "supersede", replacementId: "next", expectedUpdatedAt: old.updatedAt, replacementUpdatedAt: stamp };
  const remove = () => deletion.deleteCurrentUserAccount("u", { confirmation: deletion.ACCOUNT_DELETE_CONFIRMATION });
  async function finish(pending) {
    groups.release.resolve();
    await dreams.entered.promise;
    dreams.release.resolve();
    const result = await pending;
    assert.equal(result.deleted, true);
    assert.equal(result.persistence, "memory");
    return result;
  }
  async function assertClean() {
    assert.deepEqual(plain(context.renewalStore.memories), foreignMemory);
    assert.deepEqual(plain(lifecycle.memoryRevisionStore()), foreignHistory);
    await assert.rejects(service.readMemoryHistory("u", "old"), error => error.status === 404);
    const foreignPage = await service.readMemoryHistory("other", "foreign");
    assert.deepEqual(plain(foreignPage.items), foreignHistory);
  }
  return { context, groups, dreams, lifecycle, service, repository, change, remove, finish, assertClean, foreignHistory };
}

for (const stage of ["groups", "dreams"]) {
  test(`account deletion purges supersede snapshots written while awaiting ${stage}`, async () => {
    const f = fixture();
    const pending = f.remove();
    await f.groups.entered.promise;
    if (stage === "dreams") {
      f.groups.release.resolve();
      await f.dreams.entered.promise;
    }
    // The real service awaits the real repository's listCompanions before writing.
    const changed = await f.service.supersedeMemory("u", "old", f.change);
    assert.equal(changed.find(row => row.id === "next").status, "active");
    const history = f.lifecycle.memoryRevisionStore().filter(row => row.userId === "u");
    assert.equal(history.filter(row => row.kind === "superseded" || row.kind === "accepted").length, 2);
    assert.ok(JSON.stringify(history).includes("corrected-private-fact-old"));
    const result = await f.finish(pending);
    assert.equal(result.counts.memories, 2);
    await f.assertClean();
  });
}

test("in-flight supersede resuming after deletion returns 404 without recreating snapshots", async () => {
  const f = fixture(), resume = barrier();
  const prototype = f.repository.InMemoryRenewalRepository.prototype;
  const listCompanions = prototype.listCompanions;
  prototype.listCompanions = async function (...args) {
    const result = await listCompanions.apply(this, args);
    await resume.wait();
    return result;
  };
  const pending = f.service.supersedeMemory("u", "old", f.change);
  const rejected = assert.rejects(pending, error => error.status === 404);
  await resume.entered.promise;
  await f.finish(f.remove());
  resume.release.resolve();
  await rejected;
  prototype.listCompanions = listCompanions;
  await f.assertClean();
});

test("account deletion also clears orphan history when the memory store is absent", async () => {
  const f = fixture();
  delete f.context.renewalStore;
  await f.finish(f.remove());
  assert.deepEqual(plain(f.lifecycle.memoryRevisionStore()), f.foreignHistory);
  assert.equal(f.lifecycle.memoryRevisionStore().some(row => row.userId === "u"), false);
});
