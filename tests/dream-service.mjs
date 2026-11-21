import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import * as ts from "typescript";

// Explicit allowlist: no native require, host process/env, fetch, real DB or credential access.
const root = fileURLToPath(new URL("../src/", import.meta.url));
const context = vm.createContext({ structuredClone, AbortSignal, TextDecoder, URL, process: { env: {} } });
const cache = new Map();
const usage = [], calls = [];
let configuredProvider, sessionUser = "demo-user", useMemory = true;
let database, dbCompanion, inTransaction = false;
const forbidden = () => { throw new Error("Unexpected external operation"); };
database = new Proxy({}, { get: forbidden });
const stubs = {
  "node:crypto": { randomUUID },
  "@prisma/client": { Prisma: {} },
  "@/lib/prisma": { get prisma() { return database; } },
  "@/lib/renewal/prisma-repository": { PrismaRenewalRepository: class {
    async getCompanion(userId, companionId) {
      assert.equal(inTransaction, false, "must not obtain second Prisma connection inside locked transaction");
      return dbCompanion?.id === companionId && dbCompanion.userId === userId ? structuredClone(dbCompanion) : null;
    }
  } },
  "@/lib/renewal/relationship-state-adapter": { updateRelationshipRecordAfterMessage: forbidden },
  "@/lib/persistence/memory-fallback": { shouldUseMemoryFallback: () => useMemory },
  "@/lib/llm/user-provider": { createUserLlmProvider: async () => configuredProvider },
  "@/lib/usage": { recordModelUsage: async entry => { usage.push(entry); return null; } },
  "@/lib/auth/session": { getCurrentSession: forbidden, getOptionalSession: async () => sessionUser ? ({ userId: sessionUser }) : null, AuthenticationRequiredError: class extends Error {} },
  "@/lib/http/private-response": { privateJson: (data, options) => ({ data, status: options?.status ?? 200 }) }
};
function load(specifier, parent = path.join(root, "entry.ts")) {
  if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
  const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(parent), specifier) : null;
  if (!base || !base.startsWith(root)) throw new Error(`Blocked import ${specifier}`);
  const canonical = `@/${path.relative(root, base).split(path.sep).join("/")}`;
  if (Object.hasOwn(stubs, canonical)) return stubs[canonical];
  const filename = [`${base}.ts`, path.join(base, "index.ts")].find(existsSync);
  if (!filename) throw new Error(`Missing import ${specifier}`);
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename });
  const compiledModule = { exports: {} };
  cache.set(filename, compiledModule);
  new vm.Script(`(function(exports,require,module){${compiled.outputText}\n})`, { filename }).runInContext(context)(compiledModule.exports, child => load(child, filename), compiledModule);
  return compiledModule.exports;
}
const { InMemoryRenewalRepository } = load("@/lib/renewal/in-memory-repository");
const { DreamService } = load("@/lib/dream/service");
const { MemoryDreamRepository, listDreamWorkspacesForExport, deleteDreamWorkspaces, createDreamRepository, PrismaDreamRepository } = load("@/lib/dream/repository");
const { GET, POST } = load("@/app/api/companions/[companionId]/dream/route");
const renewal = new InMemoryRenewalRepository();
const repository = new MemoryDreamRepository(renewal);
const local = { name: "mock", complete: forbidden };
configuredProvider = local;
const service = new DreamService({ repository, provider: local });
const user = "demo-user", id = "echo";
const plain = value => JSON.parse(JSON.stringify(value));
const fails = async (fn, status) => assert.rejects(fn, error => error.status === status);
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`ok ${passed} - ${name}`); }
let state;
const post = async (action, extra = {}) => {
  const result = await service.post(user, id, { action, revision: state?.revision, ...extra }); state = result.state; return result;
};
await test("GET is read only and every action enforces ownership", async () => {
  assert.equal((await service.get(user, id)).state, null);
  await fails(() => service.get("stranger", id), 404);
  for (const action of ["start", "generate", "feedback", "edit", "apply", "discard", "restore", "unknown"]) await fails(() => service.post("stranger", id, { action }), 404);
  assert.equal((await service.get(user, id)).state, null);
});
const original = plain(await renewal.getCompanion(user, id));
const messages = plain(await renewal.listMessages(user, original.conversationId));
const memories = plain(await renewal.listMemories(user, id));
await test("start inherits official profile and resumes without overwriting", async () => {
  await post("start");
  assert.deepEqual(plain(state.draftProfile), { personality: original.personality, speakingStyle: original.speakingStyle });
  const before = plain(state);
  await post("start"); assert.deepEqual(plain(state), before);
});
await test("compare/free counts, CAS, and draft isolation", async () => {
  const stale = state.revision;
  const result = await post("generate", { message: "今天心情不错", mode: "compare" });
  assert.equal(result.source, "local"); assert.equal(state.rounds[0].choices.length, 3);
  await fails(() => service.post(user, id, { action: "discard", revision: stale }), 409);
  await fails(() => service.post(user, id, { action: "discard" }), 400);
  await post("generate", { message: "说句话吧", mode: "free" });
  assert.equal(state.rounds[1].choices.length, 1);
  assert.deepEqual(plain(await renewal.getCompanion(user, id)), original);
  assert.deepEqual(plain(await renewal.listMessages(user, original.conversationId)), messages);
  assert.deepEqual(plain(await renewal.listMemories(user, id)), memories);
});
await test("feedback persists without inventing local inference; once per round", async () => {
  await post("feedback", { roundId: state.rounds[0].id, choiceId: state.rounds[0].choices[0].id, scope: "context" });
  assert.equal(state.fragments.length, 0); assert.ok(state.rounds[0].feedback);
  await fails(() => post("feedback", { roundId: state.rounds[0].id, scope: "always" }), 409);
  await post("feedback", { roundId: state.rounds[1].id, correction: "偶尔使用短句", scope: "occasional" });
  assert.equal(state.fragments[0].origin, "user"); assert.equal(state.fragments[0].confirmed, false);
  assert.equal(state.previewProfile.speakingStyle, original.speakingStyle);
});
await test("edit restricts profile and fragment identity; confirmation affects exact preview", async () => {
  await fails(() => post("edit", { draftProfile: { ...state.draftProfile, background: "forged" }, fragments: state.fragments }), 400);
  await fails(() => post("edit", { draftProfile: state.draftProfile, fragments: [{ ...state.fragments[0], id: "forged" }] }), 400);
  await post("edit", { draftProfile: { personality: ["克制"], speakingStyle: "直白" }, fragments: state.fragments.map(f => ({ ...f, confirmed: true, text: "只在轻松时使用短句" })) });
  assert.equal(state.previewProfile.speakingStyle, "直白\n【偶尔】只在轻松时使用短句");
  assert.equal((await renewal.getCompanion(user, id)).speakingStyle, original.speakingStyle);
});
let initialVersion;
await test("apply is exact, saves pre-apply version and never changes other fields", async () => {
  const expected = plain(state.previewProfile);
  const result = await post("apply");
  assert.deepEqual(plain({ personality: result.companion.personality, speakingStyle: result.companion.speakingStyle }), expected);
  for (const key of ["name", "background", "boundaries", "proactiveFrequencyMinutes", "memories"]) assert.deepEqual(plain(result.companion[key]), original[key]);
  initialVersion = state.versions[0].id;
  assert.equal(state.versions.length, 2);
  assert.deepEqual(plain(state.versions[0].profile), { personality: original.personality, speakingStyle: original.speakingStyle });
});
await test("restore really rolls official profile back and fresh start keeps history", async () => {
  await post("restore", { versionId: initialVersion });
  assert.equal((await renewal.getCompanion(user, id)).speakingStyle, original.speakingStyle);
  const versions = plain(state.versions);
  await post("start");
  assert.equal(state.rounds.length, 0); assert.equal(state.fragments.length, 0);
  assert.deepEqual(plain(state.versions), versions);
});
await test("external companion editing blocks apply and restore", async () => {
  await renewal.updateCompanion(user, id, { background: "用户在其他页面改动" });
  await fails(() => post("apply"), 409);
  await fails(() => post("restore", { versionId: initialVersion }), 409);
  assert.equal((await renewal.getCompanion(user, id)).background, "用户在其他页面改动");
  await post("discard");
  assert.equal(state.versions.length, 3); assert.equal(state.status, "discarded");
  await post("start");
});
await test("fragment deletion and pending exclusion", async () => {
  await post("generate", { message: "测试", mode: "free" });
  await post("feedback", { roundId: state.rounds[0].id, correction: "待确认", scope: "always" });
  await post("edit", { draftProfile: state.draftProfile, fragments: [] });
  assert.equal(state.fragments.length, 0);
});
await test("provider error is fixed and redacted; no fallback, no draft mutation", async () => {
  const before = plain(state);
  const failing = new DreamService({ repository, provider: { name: "compatible", complete: async () => { throw new Error("synthetic secret and payload"); } } });
  await assert.rejects(() => failing.post(user, id, { action: "generate", revision: state.revision, message: "你好", mode: "free" }), error => error.status === 502 && !error.message.includes("synthetic"));
  assert.deepEqual(plain((await service.get(user, id)).state), before);
  assert.equal(usage.at(-1).purpose, "dream_candidates"); assert.equal(usage.at(-1).status, "error");
});
await test("real provider compare uses one call, user correction bypasses inference", async () => {
  const provider = { name: "compatible", complete: async options => { calls.push(options); return { content: JSON.stringify({ choices: ["我听着。", "嗯，你讲。", "慢慢说，我在。"] }), provider: "compatible", model: "fixture" }; } };
  const modelService = new DreamService({ repository, provider });
  const generated = await modelService.post(user, id, { action: "generate", revision: state.revision, message: "今天发生很多事", mode: "compare" });
  state = generated.state;
  assert.equal(calls.length, 1); assert.equal(state.rounds.at(-1).choices.length, 3);
  const sent = JSON.parse(calls[0].messages[1].content);
  assert.equal(sent.context.relationshipKind, original.relationshipKind);
  assert.equal(sent.context.userAddress, original.userAddress);
  assert.ok(sent.context.background); assert.ok(sent.context.boundaries);
  assert.ok(sent.context.memories.length); assert.ok(calls[0].messages.reduce((n, message) => n + message.content.length, 0) <= 16000);
  const feedback = await modelService.post(user, id, { action: "feedback", revision: state.revision, roundId: state.rounds.at(-1).id, correction: "我希望语气更简洁", scope: "context" });
  state = feedback.state;
  assert.equal(calls.length, 1); assert.equal(state.fragments.at(-1).text, "我希望语气更简洁");
});
await test("context preview specifies hypothetical situation; empty feedback never calls model", async () => {
  await post("generate", { message: "未反馈的练习", mode: "free" });
  await fails(() => post("feedback", { roundId: state.rounds.at(-1).id, scope: "always" }), 400);
  await post("edit", { draftProfile: state.draftProfile, fragments: state.fragments.map(f => ({ ...f, confirmed: true })) });
  assert.ok(state.previewProfile.speakingStyle.includes("以下为假设练习，不代表真实经历"));
  assert.ok(state.previewProfile.speakingStyle.includes("今天发生很多事"));
});
await test("malformed model response records exactly one failed call with usage", async () => {
  const before = usage.length;
  const broken = new DreamService({ repository, provider: { name: "compatible", complete: async () => ({ content: '{"choices":[]}', provider: "compatible", model: "fixture", usage: { inputTokens: 11, outputTokens: 3 } }) } });
  await fails(() => broken.post(user, id, { action: "generate", revision: state.revision, message: "试试", mode: "compare" }), 502);
  assert.equal(usage.length, before + 1); assert.equal(usage.at(-1).status, "error"); assert.equal(usage.at(-1).usage.inputTokens, 11);
});
await test("concurrent completions cannot overwrite a newer revision", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const slow = new DreamService({ repository, provider: { name: "compatible", complete: async () => { await pending; return { content: '{"choices":["好的。"]}', provider: "compatible", model: "fixture" }; } } });
  const task = slow.post(user, id, { action: "generate", revision: state.revision, message: "并发", mode: "free" });
  await post("edit", { draftProfile: state.draftProfile, fragments: state.fragments });
  release(); await fails(() => task, 409);
});
await test("round and version bounds", async () => {
  while (state.rounds.length < 20) await post("generate", { message: "测试", mode: "free" });
  await fails(() => post("generate", { message: "测试", mode: "free" }), 400);
  await post("discard"); await post("start");
  for (let i = 0; i < 12; i++) { await post("apply"); await post("start"); }
  assert.equal(state.versions.length, 10); assert.equal(state.versions[0].id, initialVersion);
});
await test("POST enforces origin before body; both routes require existing sessions", async () => {
  const context = { params: Promise.resolve({ companionId: id }) };
  for (const origin of [undefined, "null", "https://foreign.invalid"]) {
    const response = await POST(new Request("https://app.invalid/api/dream", { method: "POST", headers: origin ? { origin } : {}, body: '{"action":"start"}' }), context);
    assert.equal(response.status, 403);
  }
  const accepted = await POST(new Request("https://app.invalid/api/dream", { method: "POST", headers: { origin: "https://app.invalid" }, body: '{"action":"start"}' }), context);
  assert.equal(accepted.status, 200);
  const read = await GET(new Request("https://app.invalid/api/dream"), context); assert.equal(read.status, 200);
  sessionUser = "stranger";
  const denied = await POST(new Request("https://app.invalid/api/dream", { method: "POST", headers: { origin: "https://app.invalid" }, body: "bad json" }), context);
  assert.equal(denied.status, 404); sessionUser = user;
  sessionUser = null;
  assert.equal((await GET(new Request("https://app.invalid/api/dream"), context)).status, 401);
  assert.equal((await POST(new Request("https://app.invalid/api/dream", { method: "POST", headers: { origin: "https://app.invalid" }, body: '{"action":"start"}' }), context)).status, 401);
  sessionUser = user;
});
await test("export/cleanup include full snapshot and DB selection fails closed", async () => {
  const exported = await listDreamWorkspacesForExport(user); assert.equal(exported.length, 1); assert.equal(exported[0].state.versions.length, 10);
  assert.equal((await listDreamWorkspacesForExport("stranger")).length, 0);
  useMemory = false;
  assert.ok(createDreamRepository() instanceof PrismaDreamRepository);
  await assert.rejects(() => listDreamWorkspacesForExport(user)); useMemory = true;
  await deleteDreamWorkspaces(user, id); assert.equal((await service.get(user, id)).state, null);
});
await test("memory companion deletion cascades dream data", async () => {
  const companion = await renewal.createCompanion(user, { name: "隔离测试人物", relationshipKind: "FRIEND", speakingStyle: "简短" });
  await service.post(user, companion.id, { action: "start" });
  assert.equal((await listDreamWorkspacesForExport(user)).length, 1);
  await renewal.deleteCompanion(user, companion.id);
  assert.equal((await listDreamWorkspacesForExport(user)).length, 0);
  assert.equal(context.renewalDreamStore.has(companion.id), false);
  await fails(() => service.get(user, companion.id), 404);
});
await test("Prisma transactions lock, CAS, roll back profile and snapshots together", async () => {
  dbCompanion = structuredClone(original);
  let row = null, breakSnapshotCas = false, locks = 0;
  database = {
    dreamWorkspace: { findFirst: async () => structuredClone(row) },
    async $transaction(run) {
      const stagedCompanion = structuredClone(dbCompanion);
      let stagedRow = structuredClone(row);
      const tx = {
        $queryRaw: forbidden,
        companion: { async updateMany({ where, data }) {
          if (Object.keys(data).length === 1 && Object.hasOwn(data, "updatedAt")) locks++;
          if (where.id !== stagedCompanion.id || where.userId !== stagedCompanion.userId) return { count: 0 };
          if (where.updatedAt.toISOString() !== stagedCompanion.updatedAt) return { count: 0 };
          Object.assign(stagedCompanion, structuredClone(data), { updatedAt: data.updatedAt.toISOString() }); return { count: 1 };
        } },
        dreamWorkspace: {
          findFirst: async () => structuredClone(stagedRow),
          create: async ({ data }) => { stagedRow = structuredClone(data); },
          updateMany: async ({ where, data }) => {
            if (breakSnapshotCas || stagedRow.revision !== where.revision) return { count: 0 };
            Object.assign(stagedRow, structuredClone(data)); return { count: 1 };
          }
        }
      };
      inTransaction = true;
      try { const result = await run(tx); dbCompanion = stagedCompanion; row = stagedRow; return result; }
      finally { inTransaction = false; }
    }
  };
  const dbService = new DreamService({ repository: new PrismaDreamRepository(), provider: local });
  let draft = (await dbService.post(user, id, { action: "start" })).state;
  draft = (await dbService.post(user, id, { action: "edit", revision: draft.revision, draftProfile: { personality: ["安静"], speakingStyle: "简短" }, fragments: [] })).state;
  const beforeRow = plain(row), beforeProfile = plain(dbCompanion);
  breakSnapshotCas = true;
  await fails(() => dbService.post(user, id, { action: "apply", revision: draft.revision }), 409);
  assert.deepEqual(plain(row), beforeRow); assert.deepEqual(plain(dbCompanion), beforeProfile);
  breakSnapshotCas = false;
  const applied = await dbService.post(user, id, { action: "apply", revision: draft.revision });
  assert.equal(dbCompanion.speakingStyle, "简短"); assert.equal(row.state.versions.length, 2);
  assert.equal(applied.state.baseCompanionUpdatedAt, dbCompanion.updatedAt);
  await fails(() => dbService.post(user, id, { action: "discard", revision: draft.revision }), 409);
  await dbService.post(user, id, { action: "restore", revision: applied.state.revision, versionId: applied.state.versions[0].id });
  assert.equal(dbCompanion.speakingStyle, original.speakingStyle); assert.ok(locks >= 4);
  database = new Proxy({}, { get: forbidden });
});
await test("explicit rebase preserves draft, checks reviewed timestamp and permits a later confirmed apply", async () => {
  useMemory = true;
  const own = await renewal.createCompanion(user, { name: "基准核对", relationshipKind: "FRIEND", speakingStyle: "原始表达", personality: ["坦率"] });
  const localService = new DreamService({ repository, provider: local });
  let current = (await localService.post(user, own.id, { action: "start" })).state;
  current = (await localService.post(user, own.id, { action: "generate", revision: current.revision, mode: "free", message: "今天有些累。" })).state;
  current = (await localService.post(user, own.id, { action: "feedback", revision: current.revision, roundId: current.rounds[0].id, correction: "先关心吃饭，不连续追问。", scope: "context" })).state;
  current = (await localService.post(user, own.id, { action: "edit", revision: current.revision, draftProfile: current.draftProfile, fragments: current.fragments.map(fragment => ({ ...fragment, confirmed: true })) })).state;
  await new Promise(resolve => setTimeout(resolve, 2));
  const updated = await renewal.updateCompanion(user, own.id, { speakingStyle: "另一页的新表达", background: "保留最新背景" });
  await fails(() => localService.post(user, own.id, { action: "apply", revision: current.revision }), 409);
  await fails(() => localService.post(user, own.id, { action: "rebase", revision: current.revision, expectedCompanionUpdatedAt: own.updatedAt }), 409);
  const rebased = (await localService.post(user, own.id, { action: "rebase", revision: current.revision, expectedCompanionUpdatedAt: updated.updatedAt })).state;
  assert.deepEqual(plain(rebased.rounds), plain(current.rounds));
  assert.deepEqual(plain(rebased.fragments), plain(current.fragments));
  assert.equal(rebased.previewProfile.speakingStyle, current.previewProfile.speakingStyle);
  assert.equal((await renewal.getCompanion(user, own.id)).speakingStyle, updated.speakingStyle);
  await fails(() => localService.post(user, own.id, { action: "apply", revision: current.revision }), 409);
  await localService.post(user, own.id, { action: "apply", revision: rebased.revision });
  const applied = await renewal.getCompanion(user, own.id);
  assert.equal(applied.speakingStyle, rebased.previewProfile.speakingStyle);
  assert.equal(applied.background, updated.background);
});
console.log(`Dream service: ${passed} tests passed (offline, no real credentials/database/network).`);
