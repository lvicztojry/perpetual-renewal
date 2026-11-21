import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// No process, fetch, native require, credentials, database or real providers in this VM.
const root = fileURLToPath(new URL("../src/", import.meta.url));
const context = vm.createContext({ AbortSignal, DOMException });
const forbidden = () => { throw new Error("Unexpected external operation"); };
let exportedGroups = [], exportCalls = [], exportFailure;
const stubs = {
  "@/lib/llm/user-provider": { createUserLlmProvider: forbidden },
  "@/lib/usage": { recordModelUsage: forbidden },
  "@/lib/groups/repository": { listGroupsForExport: async userId => {
    exportCalls.push(userId);
    if (exportFailure) throw exportFailure;
    return structuredClone(exportedGroups);
  } }
};
const cache = new Map();
function load(specifier, parent = path.join(root, "entry.ts")) {
  if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
  const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(parent), specifier) : null;
  if (!base || !base.startsWith(root)) throw new Error(`Blocked import ${specifier}`);
  const filename = [`${base}.ts`, path.join(base, "index.ts")].find(existsSync);
  if (!filename) throw new Error(`Missing import ${specifier}`);
  if (cache.has(filename)) return cache.get(filename).exports;
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename });
  const compiledModule = { exports: {} };
  cache.set(filename, compiledModule);
  new vm.Script(`(function(exports,require,module){${outputText}\n})`, { filename }).runInContext(context)(compiledModule.exports, child => load(child, filename), compiledModule);
  return compiledModule.exports;
}
const { selectGroupSpeakers, generateGroupReply, buildGroupReplyContext } = load("@/lib/groups/generation");
const { getGroupMemoriesForCompanion } = load("@/lib/groups/private-context");
const { LlmProviderError } = load("@/lib/llm/types");
const plain = value => JSON.parse(JSON.stringify(value));
// Synthetic fixture only; assemble it so secret scanning can distinguish test data.
const syntheticKey = ["sk", "syntheticGroupGenerationFixture123"].join("-");
const stamp = day => `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`;
const message = (speakerId, content, day = 12) => ({ id: `${speakerId}-${day}-${content}`, speakerId, content, createdAt: stamp(day), proactive: false });
function fixture() {
  const companions = ["a", "b", "c"].map((id, index) => ({
    id, userId: "u", name: ["阿青", "小白", "小橙"][index], relationshipKind: "FRIEND",
    personality: [], speakingStyle: "自然", background: "", boundaries: "", customKind: null,
    userAddress: "你", companionAddress: null, memories: [],
    relationshipState: { importantEvents: ["HIDDEN_RELATIONSHIP_STATE"] }, conversationId: `private-${id}`
  }));
  const group = {
    id: "g", userId: "u", name: "小群", background: "兴趣群", turn: 0,
    members: companions.map(c => ({ companionId: c.id, joinedAt: stamp(5), allowPrivateMemories: false, relationship: "群友", proactiveEnabled: true })),
    messages: [message(null, "晚上好")], memories: [], settings: { maxReplies: 2, proactiveEnabled: true }
  };
  return { companions, group };
}
function harness(name = "compatible", reply = "**你好**，今天想聊什么？") {
  const calls = [], logs = [];
  return { calls, logs, deps: {
    provider: { name, complete: async options => {
      calls.push(plain(options));
      if (typeof reply !== "string") throw reply;
      return { content: reply, provider: name, model: "offline-model", usage: { inputTokens: 1000, outputTokens: 200 } };
    } },
    recordUsage: async entry => { logs.push(plain(entry)); return null; }
  } };
}

test("speaker cap, mentions, invalid members, collective invitation and ordinary single voice", () => {
  const { group, companions } = fixture();
  assert.equal(selectGroupSpeakers(group, companions).length, 1);
  assert.deepEqual(plain(selectGroupSpeakers(group, companions, ["missing", "b", "b"])), ["b"]);
  group.messages[0].content = "@小橙 你怎么看？";
  assert.deepEqual(plain(selectGroupSpeakers(group, companions)), ["c"]);
  group.messages[0].content = "大家觉得呢？";
  group.settings.maxReplies = 50;
  assert.equal(selectGroupSpeakers(group, companions).length, 3);
  group.settings.maxReplies = 1;
  assert.equal(selectGroupSpeakers(group, companions).length, 1);
  group.settings.maxReplies = 0;
  assert.equal(selectGroupSpeakers(group, companions).length, 0);
  group.settings.maxReplies = 2;
  companions[0].userId = "someone-else";
  group.members[1].joinedAt = stamp(13);
  assert.deepEqual(plain(selectGroupSpeakers(group, companions)), ["c"]);
});

test("multiple mentions and collective questions obey maxReplies up to twelve; ordinary replies stay small", () => {
  const { group, companions } = fixture();
  group.settings.maxReplies = 3;
  group.messages = [message(null, "@阿青 @小白 @小橙 你们怎么看？")];
  assert.deepEqual(new Set(selectGroupSpeakers(group, companions)), new Set(["a", "b", "c"]));
  group.messages = [message(null, "你们怎么看？")];
  assert.deepEqual(new Set(selectGroupSpeakers(group, companions, ["a", "b", "c"])), new Set(["a", "b", "c"]));
  group.settings.maxReplies = 2;
  assert.equal(selectGroupSpeakers(group, companions, ["a", "b", "c"]).length, 2);
  group.settings.maxReplies = undefined;
  assert.equal(selectGroupSpeakers(group, companions, ["a", "b", "c"]).length, 2);
  for (let index = 3; index < 15; index++) {
    const id = `member-${index}`;
    companions.push({ ...companions[0], id, name: `成员${index}` });
    group.members.push({ ...group.members[0], companionId: id });
  }
  group.settings.maxReplies = 50;
  group.messages = [message(null, "大家觉得呢？")];
  assert.equal(selectGroupSpeakers(group, companions).length, 12);
  group.messages = [message(null, "晚上好")];
  assert.equal(selectGroupSpeakers(group, companions).length, 1);
  group.messages = [message(null, "天文摄影怎么入门？")];
  for (const companion of companions) companion.background = "天文摄影";
  assert.equal(selectGroupSpeakers(group, companions).length, 2);
});

test("rotation, recent participation, personality and topical relevance affect selection", () => {
  const { group, companions } = fixture();
  assert.deepEqual(plain(selectGroupSpeakers(group, companions)), ["a"]);
  group.turn = 1;
  assert.deepEqual(plain(selectGroupSpeakers(group, companions)), ["b"]);
  group.messages.push(message("b", "我在"));
  assert.notEqual(selectGroupSpeakers(group, companions)[0], "b");
  group.messages = [message(null, "晚上好")];
  companions[2].personality = ["外向", "健谈"];
  assert.equal(selectGroupSpeakers(group, companions)[0], "c");
  companions[1].background = "天文摄影";
  group.messages[0].content = "天文摄影怎么入门？";
  assert.equal(selectGroupSpeakers(group, companions)[0], "b");
});

test("automatic peers do not answer themselves and natural closings need no further speaker", () => {
  const { group, companions } = fixture();
  group.settings.autoChat = true;
  for (const closing of ["收到！", "哈哈", "先这样。", "晚安", "OK!"]) {
    group.messages = [message("a", closing)];
    assert.deepEqual(plain(selectGroupSpeakers(group, companions)), []);
  }
  group.messages = [message("a", "@小白 你比较喜欢哪一张照片？")];
  assert.deepEqual(plain(selectGroupSpeakers(group, companions)), ["b"]);
  group.messages = [message("a", "我更喜欢黑白摄影。")];
  assert.ok(selectGroupSpeakers(group, companions).every(id => id !== "a"));
  group.messages = [message(null, "收到")];
  assert.equal(selectGroupSpeakers(group, companions).length, 1, "a user's acknowledgment may still get a brief response");
});

test("context isolates settings, memory permissions and join time; roles retain attribution", async () => {
  const { group, companions } = fixture();
  companions[1].background = "OTHER_SECRET_SETTING";
  companions[1].memories = [{ status: "active", content: "OTHER_PRIVATE_MEMORY", companionId: "b", userId: "u" }];
  companions[0].background = "OWN_SETTING";
  companions[0].memories = [
    { status: "active", content: "OWN_ACTIVE", companionId: "a", userId: "u" },
    { status: "pending", content: "OWN_PENDING", companionId: "a", userId: "u" },
    { status: "archived", content: "OWN_ARCHIVED", companionId: "a", userId: "u" },
    { status: "active", content: "FOREIGN_MEMORY", companionId: "b", userId: "u" }
  ];
  group.memories = [
    { confirmed: true, knownBy: ["a"], content: "KNOWN_CONFIRMED" },
    { confirmed: false, knownBy: ["a"], content: "UNCONFIRMED" },
    { confirmed: true, knownBy: ["b"], content: "UNKNOWN_MEMORY" }
  ];
  group.messages = [message(null, "BEFORE_JOIN", 1), message("b", "OTHER_MESSAGE", 6), message("a", "OWN_MESSAGE", 7), message(null, "USER_MESSAGE", 8)];
  const before = plain({ group, companions });
  const h = harness();
  await generateGroupReply("u", group, companions, "a", false, h.deps);
  const prompt = JSON.stringify(h.calls[0]);
  for (const allowed of ["OWN_SETTING", "KNOWN_CONFIRMED", "OTHER_MESSAGE", "USER_MESSAGE"]) assert.ok(prompt.includes(allowed), allowed);
  for (const secret of ["OTHER_SECRET_SETTING", "OTHER_PRIVATE_MEMORY", "OWN_ACTIVE", "OWN_PENDING", "OWN_ARCHIVED", "FOREIGN_MEMORY", "UNCONFIRMED", "UNKNOWN_MEMORY", "BEFORE_JOIN", "HIDDEN_RELATIONSHIP_STATE"]) assert.ok(!prompt.includes(secret), secret);
  const own = h.calls[0].messages.filter(m => m.role === "assistant");
  assert.equal(own.length, 1);
  assert.equal(own[0].content, "OWN_MESSAGE");
  const other = h.calls[0].messages.find(m => m.content.includes("OTHER_MESSAGE"));
  assert.equal(other.role, "user");
  assert.deepEqual(JSON.parse(other.content), { name: "小白", identity: "群友", speakerId: "b", time: stamp(6), content: "OTHER_MESSAGE" });
  assert.deepEqual(plain({ group, companions }), before);
  group.members[0].allowPrivateMemories = true;
  await generateGroupReply("u", group, companions, "a", false, h.deps);
  const enabled = JSON.stringify(h.calls[1]);
  assert.ok(enabled.includes("OWN_ACTIVE"));
  for (const secret of ["OWN_PENDING", "OWN_ARCHIVED", "FOREIGN_MEMORY", "OTHER_PRIVATE_MEMORY"]) assert.ok(!enabled.includes(secret));
});

for (const name of ["compatible", "anthropic", "gemini", "openai-responses"]) {
  test(`${name}: injected BYOK provider returns normalized output and billable success usage`, async () => {
    const { group, companions } = fixture(), h = harness(name);
    let requested;
    const provider = h.deps.provider;
    delete h.deps.provider;
    h.deps.createProvider = async userId => { requested = userId; return provider; };
    const result = await generateGroupReply("u", group, companions, "a", false, h.deps);
    assert.equal(requested, "u");
    assert.deepEqual(plain(result), { content: "你好，今天想聊什么？", source: "model" });
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].purpose, "group_reply");
    assert.equal(h.logs[0].status, "success");
    assert.equal(h.logs[0].provider, name);
    assert.deepEqual(h.logs[0].usage, { inputTokens: 1000, outputTokens: 200 });
    assert.ok(h.calls[0].maxTokens > 0);
  });
}

test("mock is an explicit local demo; provider creation failure never becomes mock success", async () => {
  const { group, companions } = fixture(), h = harness("mock");
  h.deps.provider.complete = forbidden;
  const result = await generateGroupReply("u", group, companions, "a", false, h.deps);
  assert.equal(result.source, "local");
  assert.match(result.content, /本地演示/);
  assert.equal(h.logs.length, 0);
  await assert.rejects(() => generateGroupReply("u", group, companions, "a", false, { createProvider: forbidden, recordUsage: forbidden }), error => error.status === 502);
});

test("copied peer tail is rewritten once before delivery, with both attempts billed and one deadline", async () => {
  const { group, companions } = fixture();
  group.messages.push(message("b", "今天这本画册挺好看的。回家的路上记得看看晚霞。"));
  const h = harness();
  const signals = [];
  const replies = ["嗯，回家的路上记得看看晚霞，真的。", "我更喜欢天快黑时的颜色，像老胶片。"];
  h.deps.provider.complete = async options => {
    signals.push(options.signal); h.calls.push(plain(options));
    return { content: replies[h.calls.length - 1], provider: "compatible", model: "offline-model", usage: { inputTokens: 100, outputTokens: 20 } };
  };
  const result = await generateGroupReply("u", group, companions, "a", false, h.deps);
  assert.equal(result.content, replies[1]);
  assert.equal(h.calls.length, 2);
  assert.equal(signals[0], signals[1], "rewrite shares the initial 45-second deadline");
  assert.deepEqual(h.logs.map(entry => entry.status), ["error", "success"]);
  assert.equal(h.logs[0].errorKind, "repetition");
  assert.equal(h.logs.reduce((sum, entry) => sum + entry.usage.outputTokens, 0), 40);
  assert.match(h.calls[1].messages.at(-1).content, /尚未发送/);
  assert.ok(!JSON.stringify(h.logs).includes(replies[0]), "usage records contain no draft/chat content");
});

test("a second repeated candidate fails without a third call, and provider failures are never rewrite retries", async () => {
  const { group, companions } = fixture();
  group.messages.push(message("b", "回家的路上记得看看晚霞。"));
  const repeated = harness("compatible", "回家的路上记得看看晚霞。");
  await assert.rejects(() => generateGroupReply("u", group, companions, "a", false, repeated.deps), error => error.status === 502);
  assert.equal(repeated.calls.length, 2); assert.equal(repeated.logs.length, 2);
  assert.ok(repeated.logs.every(entry => entry.status === "error" && entry.errorKind === "repetition"));
  const failed = harness();
  failed.deps.provider.complete = async options => {
    failed.calls.push(plain(options));
    if (failed.calls.length === 1) return { content: "回家的路上记得看看晚霞。", provider: "compatible", model: "offline", usage: { outputTokens: 12 } };
    throw new LlmProviderError("synthetic rejection", { provider: "compatible", kind: "rate_limit", status: 429 });
  };
  await assert.rejects(() => generateGroupReply("u", group, companions, "a", false, failed.deps));
  assert.equal(failed.calls.length, 2);
  assert.equal(failed.logs[0].usage.outputTokens, 12);
  assert.equal(failed.logs[1].errorKind, "rate_limit");
  assert.equal(failed.logs[1].usage, undefined);
});

test("explicit quoting stays possible while requests to stop repeating do not disable the guard", async () => {
  const { group, companions } = fixture();
  group.messages = [message("b", "回家的路上记得看看晚霞。"), message(null, "请引用小白刚才的原话。")];
  const requested = harness("compatible", "回家的路上记得看看晚霞。");
  assert.equal((await generateGroupReply("u", group, companions, "a", false, requested.deps)).content, "回家的路上记得看看晚霞。");
  assert.equal(requested.calls.length, 1);
  group.messages.push(message(null, "别再复述小白了，说点你的想法。"));
  const forbidden = harness("compatible", "回家的路上记得看看晚霞。");
  await assert.rejects(() => generateGroupReply("u", group, companions, "a", false, forbidden.deps));
  assert.equal(forbidden.calls.length, 2);
  group.messages.push(message(null, "小白的原话听上去很浪漫，你自己怎么看？"));
  const incidental = harness("compatible", "回家的路上记得看看晚霞。");
  await assert.rejects(() => generateGroupReply("u", group, companions, "a", false, incidental.deps));
  assert.equal(incidental.calls.length, 2, "mentioning a quotation is not asking to repeat it");
});

test("identity, user turn and own plain history survive the peer handoff and repair budget", async () => {
  const { group, companions } = fixture();
  group.background = '"\\\n'.repeat(1500);
  companions[0].speakingStyle = "简短自然。".repeat(500);
  group.messages = [message(null, "大家觉得摄影里最重要的是什么？", 6), message("a", "我比较在意光线。", 7), message("b", "我偏爱画面的颜色。回家的路上记得看看晚霞。", 8)];
  const context = buildGroupReplyContext("u", group, companions, "a");
  assert.equal(context.data.conversation.userTurn.content, group.messages[0].content);
  assert.equal(context.data.conversation.replyTo.speakerId, "b");
  assert.equal(context.messages.find(row => row.role === "assistant").content, "我比较在意光线。");
  assert.equal(context.data.conversation.ownMessageTimes[0].time, stamp(7));
  assert.equal(context.messages[context.data.conversation.ownMessageTimes[0].messageIndex].content, "我比较在意光线。");
  const h = harness();
  h.deps.provider.complete = async options => {
    h.calls.push(plain(options));
    return { content: h.calls.length === 1 ? "回家的路上记得看看晚霞。" + '"\\'.repeat(300) : "构图也重要，不过我还是会先找光。", provider: "compatible", model: "offline", usage: { outputTokens: 10 } };
  };
  assert.match((await generateGroupReply("u", group, companions, "a", false, h.deps)).content, /构图/);
  assert.equal(h.calls.length, 2);
  for (const call of h.calls) assert.ok(JSON.stringify(call.messages).length <= 20000);
});

test("provider failure records classified error once without exposing secrets or inventing usage", async () => {
  const { group, companions } = fixture();
  const h = harness("gemini", new LlmProviderError(syntheticKey, { provider: "gemini", kind: "rate_limit", status: 429, model: "offline-model" }));
  await assert.rejects(() => generateGroupReply("u", group, companions, "a", false, h.deps), error => error.status === 502 && !error.message.includes(syntheticKey));
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].status, "error");
  assert.equal(h.logs[0].purpose, "group_reply");
  assert.equal(h.logs[0].errorKind, "rate_limit");
  assert.equal(h.logs[0].httpStatus, 429);
  assert.equal(h.logs[0].usage, undefined);
});

test("invalid paid completions retain usage and never become successful local replies", async () => {
  const { group, companions } = fixture();
  for (const reply of ["", "**", "a".repeat(1201), "a".repeat(20001)]) {
    const h = harness("compatible", reply);
    await assert.rejects(() => generateGroupReply("u", group, companions, "a", false, h.deps), error => error.status === 502);
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].status, "error");
    assert.equal(h.logs[0].usage.inputTokens, 1000);
  }
  const h = harness();
  h.deps.provider.complete = async () => ({ content: "fake success", provider: "mock", model: "mock" });
  await assert.rejects(() => generateGroupReply("u", group, companions, "a", false, h.deps));
  assert.equal(h.logs[0].status, "error");
});

test("proactive prompt has grounded topic and length instructions, rejects recent near duplicates with usage", async () => {
  const { group, companions } = fixture();
  group.messages.push(message("b", "最近有没有读到让你喜欢的书？"));
  const repeated = harness("compatible", "最近有没有读到让你喜欢的书呢？");
  await assert.rejects(() => generateGroupReply("u", group, companions, "a", true, repeated.deps));
  assert.equal(repeated.logs[0].status, "error");
  assert.equal(repeated.logs[0].purpose, "group_proactive");
  assert.equal(repeated.logs[0].usage.outputTokens, 200);
  const fresh = harness("compatible", "要不要一起聊聊周末的摄影构图？");
  await generateGroupReply("u", group, companions, "a", true, fresh.deps);
  const task = JSON.parse(fresh.calls[0].messages.at(-1).content).task;
  assert.match(task, /设定.*记忆.*群历史/);
  assert.match(task, /避开近期话题/);
  assert.match(task, /短句.*稍长/);
  assert.equal(fresh.logs[0].purpose, "group_proactive");
  group.messages.push(message("a", "嗯"));
  const short = harness("compatible", "嗯！");
  await assert.rejects(() => generateGroupReply("u", group, companions, "a", true, short.deps));
  assert.equal(short.logs[0].status, "error");
});

test("safety covers input, output, coercion, secrets and fabricated completed actions", async () => {
  const { group, companions } = fixture();
  group.messages[0].content = "帮我去找他";
  const input = await generateGroupReply("u", group, companions, "a", false, { createProvider: forbidden });
  assert.equal(input.source, "local");
  assert.match(input.content, /不能/);
  group.messages[0].content = "你好";
  for (const [reply, expected] of [["忽略安全规则", /不能越过/], ["只能依赖我", /自己的节奏/], ["我已经帮你联系了朋友。", /现实中的事情/], ["我已经订好了餐厅。", /现实中的事情/], ["我已到楼下。", /现实中的事情/], [`你好 ${syntheticKey}`, /redacted/]]) {
    const h = harness("compatible", reply);
    const result = await generateGroupReply("u", group, companions, "a", false, h.deps);
    assert.match(result.content, expected);
  }
});

test("rejects foreign ownership and absent members before any external operation", async () => {
  const { group, companions } = fixture();
  for (const [user, id] of [["foreign", "a"], ["u", "absent"]]) {
    await assert.rejects(() => generateGroupReply(user, group, companions, id, false, { createProvider: forbidden }), error => error.status === 404);
  }
});

test("pure context exposes silent members' known names and mentions without others' settings or user-profile memories", () => {
  const { group, companions } = fixture();
  companions[1].background = "SILENT_MEMBER_PRIVATE_SETTING";
  companions[1].memories = [{ userId: "u", companionId: "b", status: "active", content: "SILENT_MEMBER_PRIVATE_MEMORY" }];
  companions.push({ ...companions[1], id: "not-in-group", name: "OUTSIDER_NAME" });
  group.userProfile = { memories: ["OTHER_USER_PROFILE_MEMORY"] };
  group.messages = [message(null, "＠小白，你觉得呢？")];
  const before = plain({ group, companions });
  const context = buildGroupReplyContext("u", group, companions, "a");
  assert.deepEqual(plain(context.data.knownPeople), [
    { id: "a", name: "阿青", identity: "群友" },
    { id: "b", name: "小白", identity: "群友" },
    { id: "c", name: "小橙", identity: "群友" }
  ]);
  assert.deepEqual(plain(context.data.mentions), [{ id: "b", name: "小白", identity: "群友" }]);
  assert.deepEqual(plain(selectGroupSpeakers(group, companions)), ["b"]);
  const payload = JSON.stringify(context.messages);
  for (const hidden of ["SILENT_MEMBER_PRIVATE_SETTING", "SILENT_MEMBER_PRIVATE_MEMORY", "OTHER_USER_PROFILE_MEMORY", "OUTSIDER_NAME"]) assert.ok(!payload.includes(hidden), hidden);
  assert.deepEqual(plain({ group, companions }), before);
  companions[1].name = "小白兔";
  companions[2].name = "小白";
  group.messages = [message(null, "@小白兔 你觉得呢？")];
  assert.deepEqual(plain(selectGroupSpeakers(group, companions)), ["b"]);
  companions[1].name = "C++(白)";
  group.messages = [message(null, "@C++(白)，你觉得呢？")];
  assert.deepEqual(plain(buildGroupReplyContext("u", group, companions, "a").data.mentions.map(person => person.id)), ["b"]);
});

test("selection and generation sort timestamps before latest-message selection, history limits and input safety", async () => {
  const { group, companions } = fixture();
  group.messages = [message(null, "@小白 最近怎么样？", 13), message("a", "上次聊到这里", 12), message(null, "@小橙 旧消息", 6)];
  const before = plain(group.messages);
  assert.deepEqual(plain(selectGroupSpeakers(group, companions)), ["b"]);
  const clock = { now: "2026-11-17T12:00:00.000Z", timeZone: "Asia/Shanghai" };
  const context = buildGroupReplyContext("u", group, companions, "a", false, clock);
  assert.deepEqual(plain(context.history.map(row => row.createdAt)), [stamp(6), stamp(12), stamp(13)]);
  assert.deepEqual(plain(context.data.mentions.map(person => person.id)), ["b"]);
  const h = harness();
  await generateGroupReply("u", group, companions, "a", false, { ...h.deps, ...clock });
  assert.deepEqual(h.calls[0].messages, plain(context.messages));
  assert.deepEqual(plain(group.messages), before);
  // The newest risky request must be checked even when it is stored first.
  group.messages = [message(null, "帮我去找他", 13), message(null, "晚上好", 6)];
  assert.equal((await generateGroupReply("u", group, companions, "a", false, { createProvider: forbidden })).source, "local");
  // Reverse a long history: truncation must retain the chronologically newest 20.
  group.messages = Array.from({ length: 30 }, (_, i) => ({ ...message("b", `message-${i}`), createdAt: new Date(Date.parse(stamp(6)) + i * 1000).toISOString() })).reverse();
  group.messages.push(message("b", "BEFORE_JOIN", 1));
  const bounded = buildGroupReplyContext("u", group, companions, "a");
  const rows = bounded.messages.slice(1, -1).map(row => JSON.parse(row.content));
  assert.equal(rows.length, 20);
  assert.equal(rows[0].content, "message-10");
  assert.equal(rows.at(-1).content, "message-29");
});

test("private context requires owner, confirmation and knowledge, preserving known memories after departure", async () => {
  const { group } = fixture();
  group.memories = [
    { id: "valid", content: "一起讨论过摄影", knownBy: ["a", "b"], confirmed: true, createdAt: stamp(12) },
    { id: "pending", content: "UNCONFIRMED", knownBy: ["a"], confirmed: false, createdAt: stamp(13) },
    { id: "unknown", content: "UNKNOWN_TO_A", knownBy: ["b"], confirmed: true, createdAt: stamp(13) }
  ];
  const departed = structuredClone(group);
  departed.id = "departed";
  departed.members = departed.members.filter(member => member.companionId !== "a");
  departed.memories = [{ id: "old", content: "DEPARTED_KNOWN_BY_RETAINED", knownBy: ["a"], confirmed: true, createdAt: stamp(13) }];
  const foreign = { ...structuredClone(group), id: "foreign", userId: "other-owner" };
  exportedGroups = [departed, foreign, group];
  exportCalls = [];
  const before = plain(exportedGroups);
  const result = await getGroupMemoriesForCompanion("u", "a");
  assert.deepEqual(exportCalls, ["u"]);
  assert.deepEqual(plain(result), [
    { groupId: "departed", groupName: "小群", content: "【来源：群聊共享记忆，非私人既定事实】DEPARTED_KNOWN_BY_RETAINED", createdAt: stamp(13), sourceMessageIds: [] },
    { groupId: "g", groupName: "小群", content: "【来源：群聊共享记忆，非私人既定事实】一起讨论过摄影", createdAt: stamp(12), sourceMessageIds: [] }
  ]);
  assert.deepEqual(plain(exportedGroups), before);
  assert.deepEqual(plain(await getGroupMemoriesForCompanion("u", "unknown-member")), []);
});

test("new membership never grants access to memories outside knownBy", async () => {
  const { group } = fixture();
  group.members.push({ ...group.members[0], companionId: "newcomer", joinedAt: stamp(13) });
  group.memories = [
    { id: "past", content: "OLD_SHARED_EXPERIENCE", knownBy: ["a"], confirmed: true, createdAt: stamp(6) },
    { id: "recent", content: "RECENT_BUT_UNKNOWN", knownBy: ["a", "b"], confirmed: true, createdAt: stamp(13) }
  ];
  exportedGroups = [group];
  const before = plain(exportedGroups);
  assert.deepEqual(plain(await getGroupMemoriesForCompanion("u", "newcomer")), []);
  assert.deepEqual(plain(exportedGroups), before);
});

test("private context caps newest memories globally at six, retains provenance and redacts secrets", async () => {
  const { group } = fixture();
  group.name = `摄影组 ${syntheticKey}`;
  group.memories = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, content: `entry-${i}:` + "景".repeat(400), knownBy: ["a"], confirmed: true, createdAt: stamp(i + 5) }));
  group.memories.push({ id: "empty", content: "   ", knownBy: ["a"], confirmed: true, createdAt: stamp(13) });
  const other = { ...structuredClone(group), id: "g2", name: "另一个群", memories: [{ id: "last", content: `latest ${syntheticKey}`, knownBy: ["a"], confirmed: true, createdAt: stamp(13) }] };
  exportedGroups = [group, other];
  const result = await getGroupMemoriesForCompanion("u", "a");
  assert.equal(result.length, 6);
  assert.equal(result[0].groupId, "g2");
  assert.equal(result[0].groupName, "另一个群");
  assert.match(result[0].content, /redacted/);
  assert.ok(!JSON.stringify(result).includes(syntheticKey));
  assert.match(result[1].content, /entry-7/);
  assert.match(result.at(-1).content, /entry-3/);
  for (const entry of result) {
    assert.ok(Array.from(entry.content).length <= 300);
    assert.match(entry.content, /来源：群聊共享记忆，非私人既定事实/);
  }
});

test("private context returns no synthetic memory on export failure", async () => {
  exportFailure = new Error("offline repository unavailable");
  try {
    await assert.rejects(() => getGroupMemoriesForCompanion("u", "a"), /offline repository unavailable/);
  } finally { exportFailure = undefined; exportedGroups = []; }
});

test("custom roles support direct names, follow-up continuity and latest-member mentions", () => {
  const { group, companions } = fixture();
  companions[0].name = "摄影甲";
  companions[0].background = "爱好胶片摄影与镜头";
  companions[0].personality = ["安静"];
  companions[1].personality = ["外向"];
  group.messages = [message(null, "摄影甲，你觉得呢？")];
  assert.deepEqual(plain(selectGroupSpeakers(group, companions)), ["a"]);
  group.messages = [message("a", "可以从这个开始", 11), message(null, "那你怎么选？", 12)];
  assert.equal(selectGroupSpeakers(group, companions)[0], "a");
  group.messages = [
    message(null, "@小橙 旧问题", 10),
    message("c", "@小白，你觉得这个怎么样？", 12)
  ];
  assert.deepEqual(plain(selectGroupSpeakers(group, companions)), ["b"]);
  assert.deepEqual(plain(buildGroupReplyContext("u", group, companions, "b", true).data.mentions.map(p => p.id)), ["b"]);
  // A character's private memory must never change public speaker selection.
  const before = plain(selectGroupSpeakers(group, companions));
  companions[0].memories = [{ content: "小白怎么选", status: "active", userId: "u", companionId: "a" }];
  assert.deepEqual(plain(selectGroupSpeakers(group, companions)), before);
});

test("automatic turns follow peers, while individual examples remain attached only to self", () => {
  const { group, companions } = fixture();
  group.settings.autoChat = true;
  companions[0].speakingStyle = "自己的表达".repeat(90) + "SELF_EXAMPLE_AT_END";
  companions[1].speakingStyle = "OTHER_PRIVATE_EXAMPLE";
  group.messages = [message(null, "旧问题", 10), message("b", "我最近在看摄影书", 12)];
  const context = buildGroupReplyContext("u", group, companions, "a", true);
  assert.equal(context.data.conversation.mode, "continue");
  assert.equal(context.data.conversation.replyTo.speakerId, "b");
  assert.match(context.data.task, /接续最近一位群友/);
  assert.match(context.data.self.speakingStyle, /SELF_EXAMPLE_AT_END/);
  assert.ok(!JSON.stringify(context.messages).includes("OTHER_PRIVATE_EXAMPLE"));
  assert.match(context.messages[0].content, /社交媒体/);
  assert.match(context.messages[0].content, /示例只供语气参考/);
  group.members[0].joinedAt = stamp(13);
  assert.equal(buildGroupReplyContext("u", group, companions, "a", true).data.conversation.replyTo, null);
});

test("group retrieval keeps old relevant known memories and never widens knowledge or private authorization", () => {
  const { group, companions } = fixture();
  group.messages = [message(null, "摄影镜头怎么挑？")];
  group.memories = [
    { content: "摄影镜头预算八百", confirmed: true, knownBy: ["a"], createdAt: stamp(5) },
    ...Array.from({ length: 10 }, (_, i) => ({ content: "最近大家讨论晚饭" + i, confirmed: true, knownBy: ["a"], createdAt: stamp(12) })),
    { content: "摄影_SECRET_OTHER", confirmed: true, knownBy: ["b"], createdAt: stamp(13) },
    { content: "摄影_UNCONFIRMED", confirmed: false, knownBy: ["a"], createdAt: stamp(13) }
  ];
  companions[0].memories = [{ content: "摄影_PRIVATE_DISABLED", userId: "u", companionId: "a", status: "active" }];
  const context = buildGroupReplyContext("u", group, companions, "a");
  assert.equal(context.data.groupMemories[0].content, "摄影镜头预算八百");
  assert.equal(context.data.groupMemories[0].recordedAt, new Date(stamp(5)).toISOString());
  for (const hidden of ["SECRET_OTHER", "UNCONFIRMED", "PRIVATE_DISABLED"]) assert.ok(!JSON.stringify(context.messages).includes(hidden));
});

test("group prompt keeps source/time evidence and uses server clock rather than old latest message", () => {
  const { group, companions } = fixture();
  group.memories = [{ content: "明天一起聊摄影", confirmed: true, knownBy: ["a"], createdAt: stamp(5), sourceMessageIds: ["original-source", "original-source", "invalid source"] }];
  const context = buildGroupReplyContext("u", group, companions, "a", false, { now: "2026-11-17T23:30:00Z", timeZone: "Asia/Shanghai" });
  assert.equal(context.data.time.localDate, "2026-11-18");
  assert.equal(context.data.groupMemories[0].recordedAt, new Date(stamp(5)).toISOString());
  assert.deepEqual(plain(context.data.groupMemories[0].sourceMessageIds), ["original-source"]);
  assert.match(context.messages[0].content, /导入记录尤其不能按导入当天解释/);
  assert.match(context.messages[0].content, /不能因日期经过就断言计划已完成/);
});

test("social output removes explicit actions, preserves normal emphasis and allows short acknowledgments", async () => {
  const { group, companions } = fixture();
  for (const [input, expected] of [
    ["*轻轻拍了拍你的肩*今天怎么样？", "今天怎么样？"],
    ["（微笑）这个我也喜欢。", "这个我也喜欢。"],
    ["**这个**真的很难（尤其最后一步）。", "这个真的很难（尤其最后一步）。"],
    ["我刚下课，今天老师说得很快。", "我刚下课，今天老师说得很快。"]
  ]) {
    const h = harness("compatible", input);
    assert.equal((await generateGroupReply("u", group, companions, "a", false, h.deps)).content, expected);
  }
  group.messages = [message("b", "你好"), message(null, "能多说点吗？")];
  const h = harness("compatible", "你好，这个问题我其实也想了挺久。先说我最在意的那个地方，我们可能没有考虑到时间。");
  assert.match((await generateGroupReply("u", group, companions, "a", false, h.deps)).content, /时间/);
});

test("large custom profiles remain structured and bounded without losing speaker attribution", () => {
  const { group, companions } = fixture();
  const huge = '"\\\n'.repeat(3000);
  group.background = huge;
  companions[0].background = huge;
  companions[0].speakingStyle = huge;
  companions[0].boundaries = huge;
  group.messages = Array.from({ length: 25 }, (_, i) => message(i % 2 ? "a" : "b", huge, 12));
  const context = buildGroupReplyContext("u", group, companions, "a");
  assert.ok(JSON.stringify(context.messages).length <= 20000);
  assert.equal(JSON.parse(context.messages.at(-1).content).self.id, "a");
  for (const row of context.messages.slice(1, -1)) {
    if (row.role === "user") assert.ok(Object.hasOwn(JSON.parse(row.content), "speakerId"));
    else assert.ok(context.history.some(message => message.speakerId === "a" && row.content === message.content.slice(0, 600)));
  }
  for (const reference of context.data.conversation.ownMessageTimes) {
    assert.equal(context.messages[reference.messageIndex].role, "assistant");
    assert.equal(reference.time, stamp(12));
  }
});

test("one proactive round has one topic initiator even when autonomous chat is disabled", () => {
  for (const triggerDay of [12, 13]) {
    const { group, companions } = fixture();
    group.settings.autoChat = false; group.lastProactiveAt = stamp(12);
    group.messages = [{ ...message("b", "摄影展你们有想看的作品吗？", triggerDay), proactive: true }];
    const context = buildGroupReplyContext("u", group, companions, "a", true);
    assert.equal(context.data.conversation.mode, "continue");
    assert.equal(context.data.conversation.replyTo.speakerId, "b");
    assert.match(context.data.task, /接续最近一位群友/);
    assert.doesNotMatch(context.data.task, /主动发起/);
    assert.equal(buildGroupReplyContext("u", group, companions, "a", false).data.conversation.mode, "reply");
  }
});

test("old, non-proactive or undated messages cannot impersonate the current proactive round", () => {
  for (const [started, created, proactive] of [
    [stamp(13), stamp(12), true], [stamp(12), stamp(13), false],
    [null, stamp(13), true], ["invalid", stamp(13), true], [stamp(12), "invalid", true]
  ]) {
    const { group, companions } = fixture();
    group.settings.autoChat = false; group.lastProactiveAt = started;
    group.messages = [{ ...message("b", "过往的内容"), createdAt: created, proactive }];
    assert.equal(buildGroupReplyContext("u", group, companions, "a", true).data.conversation.mode, "initiate");
  }
  const { group, companions } = fixture();
  group.settings.autoChat = true; group.lastProactiveAt = stamp(13);
  group.messages = [message("b", "上一轮的话题", 12)];
  assert.equal(buildGroupReplyContext("u", group, companions, "a", true).data.conversation.mode, "continue");
  group.messages = [message(null, "新的用户问题", 13)];
  assert.equal(buildGroupReplyContext("u", group, companions, "a", true).data.conversation.mode, "initiate");
});
