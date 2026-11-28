import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const plain = (value) => JSON.parse(JSON.stringify(value));
const completion = {
  content: "Offline reply", provider: "fixture", model: "offline",
  usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }
};

function fixture({ failReply = false, groupsForExport } = {}) {
  const messages = [{
    id: "existing", conversationId: "conversation", role: "user", content: "Earlier",
    metadata: { important: true, source: "existing" }
  }];
  const state = { writes: 0, memoryWrites: 0, providerCalls: 0, replies: 0, usage: [], promptInputs: [], groupMemoryReads: [] };
  const memories = [];
  const repo = {
    async getConversation(userId, conversationId) {
      assert.equal(userId, "user");
      assert.equal(conversationId, "conversation");
      return { companionId: "companion" };
    },
    async getCompanion(userId, companionId) {
      assert.equal(userId, "user");
      assert.equal(companionId, "companion");
      return { id: companionId, userId, conversationId: "conversation", name: "Fixture", relationshipKind: "FRIEND", memories };
    },
    async appendMessage(conversationId, role, content, metadata) {
      state.writes++;
      const message = {
        id: `message-${messages.length}`, conversationId, role, content,
        metadata: metadata === undefined ? null : plain(metadata)
      };
      messages.push(message);
      return message;
    },
    async updateRelationshipAfterMessage() { state.writes++; return { warmth: 1 }; },
    async createPendingMemory(userId, companionId, sourceMessageId, content) {
      state.writes++;
      state.memoryWrites++;
      const memory = { id: `pending-${memories.length}`, userId, companionId, sourceMessageId, content, type: "user_fact", status: "pending" };
      memories.push(memory); return memory;
    },
    async createMemory(userId, companionId, input) {
      state.writes++;
      state.memoryWrites++;
      const memory = { id: `manual-${memories.length}`, userId, companionId, ...input };
      memories.push(memory); return memory;
    },
    async getMessage(userId, conversationId, messageId) {
      assert.equal(userId, "user");
      assert.equal(conversationId, "conversation");
      return messages.find(message => message.id === messageId) ?? null;
    },
    async updateMessage(conversationId, messageId, input) {
      assert.equal(conversationId, "conversation");
      const message = messages.find(message => message.id === messageId);
      if (!message) return null;
      state.writes++;
      Object.assign(message, plain(input));
      return message;
    },
    async listMessages(userId, conversationId) {
      assert.equal(userId, "user");
      assert.equal(conversationId, "conversation");
      return plain(messages);
    }
  };
  const sandbox = vm.createContext({ Request, Response, Error });
  function compile(relativePath, dependencies) {
    const filename = new URL(relativePath, import.meta.url);
    const result = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: filename.pathname, reportDiagnostics: true
    });
    assert.equal(result.diagnostics.length, 0);
    const compiledModule = { exports: {} };
    const run = new vm.Script(`(function(exports, require, module) {${result.outputText}\n})`)
      .runInContext(sandbox);
    run(compiledModule.exports, (specifier) => {
      // Fail closed: no native require, environment, database or network in the VM.
      assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected import: ${specifier}`);
      return dependencies[specifier];
    }, compiledModule);
    return compiledModule.exports;
  }
  const types = compile("../src/lib/renewal/types.ts", {});
  // Default is a closed, empty stub. Integration opts into the real filtering
  // helper with an explicit repository stub, never the production repository.
  const groupContext = groupsForExport === undefined
    ? { getGroupMemoriesForCompanion: async () => [] }
    : compile("../src/lib/groups/private-context.ts", {
      "@/lib/groups/repository": { async listGroupsForExport(userId) {
        assert.equal(userId, "user");
        return structuredClone(groupsForExport);
      } },
      "@/lib/http/response-safety": { redactSensitiveResponseText: value => value }
    });
  const serviceModule = compile("../src/lib/renewal/service.ts", {
    "./types": types,
    "./repository": { createRenewalRepository: () => repo },
    "@/lib/llm/types": { LlmProviderError: class extends Error {} },
    "@/lib/chat": { async generateCompanionReply(input) {
      state.replies++;
      state.promptInputs.push(plain(input));
      if (failReply) throw new Error("Offline failure");
      return completion;
    } },
    "@/lib/groups/private-context": { async getGroupMemoriesForCompanion(userId, companionId, query) {
      state.groupMemoryReads.push({ userId, companionId });
      return groupContext.getGroupMemoriesForCompanion(userId, companionId, query);
    } },
    "@/lib/memory/extractor": { extractMemoryCandidates() { throw new Error("Unexpected extraction"); } },
    "@/lib/http/response-safety": { redactSensitiveResponseText: (value) => value },
    "@/lib/usage": { async recordModelUsage(entry) { state.usage.push(plain(entry)); } },
    "@/lib/users/profile": { async getUserProfile() { return { timezone: "Asia/Shanghai", nickname: "测试用户", language: "zh-CN" }; } },
    "@/lib/llm/user-provider": { async createUserLlmProvider() { state.providerCalls++; return {}; } },
    "@/lib/relationship/proactive-frequency": { normalizeProactiveFrequency() {
      throw new Error("Unexpected frequency normalization");
    } }
  });
  const json = compile("../src/lib/http/json.ts", {});
  const route = compile("../src/app/api/conversations/[conversationId]/messages/route.ts", {
    "@/lib/renewal/service": serviceModule,
    "@/lib/auth/session": { async getCurrentSession() { return { userId: "user" }; } },
    "@/lib/http/private-response": { privateJson: (body, init) => Response.json(body, init) },
    "@/lib/http/json": json,
    "@/lib/http/persistence-errors": { persistenceUnavailableResponse: () => null }
  });
  const context = { params: Promise.resolve({ conversationId: "conversation" }) };
  return {
    state, messages, memories,
    service: new serviceModule.RenewalService(repo, "user"),
    MessageValidationError: serviceModule.MessageValidationError,
    post: (body) => route.POST(new Request("http://offline/messages", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }), context),
    get: () => route.GET(new Request("http://offline/messages"), context)
  };
}

test("automatic memory dedup checks full source and never mistakes equal truncated prefixes", async () => {
  const f = fixture();
  const content = "我记得" + "我们一起讨论未来的计划和想法".repeat(5) + "计划一";
  await f.service.sendMessage("conversation", content);
  assert.equal(f.memories.length, 1);
  await f.service.sendMessage("conversation", content);
  assert.equal(f.memories.length, 1);
  await f.service.sendMessage("conversation", content.slice(0, -1) + "二");
  assert.equal(f.memories.length, 2);
});

test("manual candidates preserve type, negation, numbers and archival intent", async () => {
  const f = fixture();
  const add = (content, type = "user_fact") => f.service.createMemoryCandidates("companion", { content, type });
  assert.equal((await add("喜欢咖啡 2 杯")).length, 1);
  assert.equal((await add("  喜欢咖啡  2 杯  ")).length, 0);
  assert.equal((await add("不喜欢咖啡 2 杯")).length, 1);
  assert.equal((await add("喜欢咖啡 3 杯")).length, 1);
  assert.equal((await add("喜欢咖啡 2 杯", "emotional_preference")).length, 1);
  f.memories[0].status = "archived";
  await add("喜欢咖啡 2 杯");
  assert.equal(f.memories[0].status, "archived");
});

test("POST persists correlation on USER and GET returns it without changing other metadata", async () => {
  const f = fixture();
  const clientMessageId = "8387fb7f-453c-44f0-9d4d-731c765219a1";
  const response = await f.post({
    content: "  hello there  ", clientMessageId,
    metadata: { clientMessageId: "forged", important: true, status: "failed" },
    role: "assistant", provider: "forged", important: true
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.userMessage.content, "hello there");
  assert.equal(result.userMessage.role, "user");
  assert.deepEqual(result.userMessage.metadata, { clientMessageId });
  assert.deepEqual(result.assistantMessage.metadata, {
    status: "sent", provider: completion.provider, model: completion.model, usage: completion.usage
  });
  assert.deepEqual(result.pendingMemory, f.memories[0]);
  assert.deepEqual(result.relationshipState, { warmth: 1 });
  const fetched = await f.get();
  assert.equal(fetched.status, 200);
  const { messages } = await fetched.json();
  assert.deepEqual(messages, f.messages);
  assert.deepEqual(messages[0].metadata, { important: true, source: "existing" });
  assert.deepEqual(messages[1].metadata, { clientMessageId });
  assert.equal(f.state.providerCalls, 1);
  assert.equal(f.state.replies, 1);
  assert.equal(f.state.usage.length, 1);
});

test("ASCII opaque IDs accept one character and the 100-character boundary", async () => {
  for (const clientMessageId of ["a", "_-", "optimistic_ABC-012", "a".repeat(100)]) {
    const f = fixture();
    const response = await f.post({ content: "hello", clientMessageId });
    assert.equal(response.status, 201);
    assert.deepEqual((await response.json()).userMessage.metadata, { clientMessageId });
  }
});

const invalidIds = [null, false, true, 42, {}, [], ["id"], "", "a".repeat(101),
  " ", " id", "id ", "id.id", "id/id", "id\n", "id\r", "id\t", "用户", "café", "😀"];

test("route rejects invalid IDs with 400 before any write or provider call", async () => {
  for (const clientMessageId of invalidIds) {
    const f = fixture();
    const response = await f.post({ content: "hello there", clientMessageId });
    assert.equal(response.status, 400, JSON.stringify(clientMessageId));
    assert.deepEqual(await response.json(), { error: "Invalid clientMessageId." });
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.providerCalls, 0);
    assert.equal(f.state.replies, 0);
    assert.equal(f.messages.length, 1);
  }
});

test("direct service callers receive MessageValidationError without side effects", async () => {
  for (const clientMessageId of [...invalidIds, NaN, () => "id"]) {
    const f = fixture();
    await assert.rejects(f.service.sendMessage("conversation", "hello there", clientMessageId),
      (error) => error instanceof f.MessageValidationError && error.message === "Invalid clientMessageId.");
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.providerCalls, 0);
    assert.equal(f.state.replies, 0);
    assert.equal(f.messages.length, 1);
  }
});

test("legacy POST and two-argument service calls preserve null user metadata", async () => {
  for (const direct of [false, true]) {
    const f = fixture();
    const result = direct ? await f.service.sendMessage("conversation", "hello")
      : await (await f.post({ content: "hello", metadata: { clientMessageId: "forged" } })).json();
    assert.equal(result.userMessage.metadata, null);
    assert.equal(result.assistantMessage.metadata.status, "sent");
    const { messages } = await (await f.get()).json();
    assert.equal(messages[1].metadata, null);
    assert.equal(f.state.providerCalls, 1);
    assert.equal(f.state.replies, 1);
  }
});

test("failed reply preserves user correlation and existing assistant error metadata", async () => {
  const f = fixture({ failReply: true });
  const response = await f.post({ content: "hello", clientMessageId: "optimistic_retry" });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.deepEqual(result.userMessage.metadata, { clientMessageId: "optimistic_retry" });
  assert.deepEqual(result.assistantMessage.metadata, {
    status: "failed", provider: "unknown", error: "Offline failure"
  });
  const { messages } = await (await f.get()).json();
  assert.deepEqual(messages[1], result.userMessage);
  assert.equal(f.state.providerCalls, 1);
  assert.equal(f.state.replies, 1);
});

test("shared recall retrieves old relevant evidence and regeneration keeps the original question", async () => {
  const shared = [{ id: "shared-photo", userId: "user", name: "摄影群", members: [], memories: [
    { id: "old", content: "无关的天气。".repeat(100) + "摄影镜头预算八百，不是一千。", confirmed: true, knownBy: ["companion"], createdAt: "2020-01-01T00:00:00Z", sourceMessageIds: ["old-photo"] },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `recent-${i}`, content: `晚饭和跑步的新话题 ${i}`, confirmed: true, knownBy: ["companion"], createdAt: "2026-11-17T00:00:00Z" })),
    { id: "unknown", content: "摄影 SECRET_UNKNOWN", confirmed: true, knownBy: ["other"], createdAt: "2026-11-17T00:00:00Z" }
  ] }];
  const f = fixture({ groupsForExport: shared });
  const sent = await f.service.sendMessage("conversation", "摄影镜头预算是多少？");
  assert.equal(sent.assistantError, undefined);
  const recalled = f.state.promptInputs[0].memories.filter(memory => memory.sourceGroupId === "shared-photo");
  assert.equal(f.state.promptInputs[0].user.timezone, "Asia/Shanghai");
  assert.equal(recalled.length, 6);
  assert.match(recalled[0].content, /摄影镜头预算八百，不是一千/);
  assert.equal(recalled[0].createdAt, "2020-01-01T00:00:00Z");
  assert.deepEqual(recalled[0].sourceMessageIds, ["old-photo"]);
  assert.ok(!JSON.stringify(recalled).includes("SECRET_UNKNOWN"));
  assert.ok(Array.from(recalled[0].content).length <= 300);
  await f.service.sendMessage("conversation", "晚饭和跑步怎么样？");
  assert.doesNotMatch(f.state.promptInputs[1].memories.find(memory => memory.sourceGroupId === "shared-photo").content, /摄影镜头预算/);
  const restored = await f.service.regenerateMessage("conversation", sent.assistantMessage.id);
  assert.ok(restored.assistantMessage);
  assert.match(f.state.promptInputs[2].memories.find(memory => memory.sourceGroupId === "shared-photo").content, /摄影镜头预算八百，不是一千/);
});

test("send and regenerate receive only known, source-labelled group memories without persisting formal copies", async () => {
  const groups = [{
    id: "group-known", userId: "user", name: "摄影群", members: [],
    memories: [
      { id: "known", content: "一起讨论过构图", confirmed: true, knownBy: ["companion"], createdAt: "2026-11-12T10:00:00Z", sourceMessageIds: ["message-composition"] },
      { id: "unknown", content: "UNKNOWN_GROUP_SECRET", confirmed: true, knownBy: ["other"], createdAt: "2026-11-12T11:00:00Z" },
      { id: "pending", content: "UNCONFIRMED_GROUP_SECRET", confirmed: false, knownBy: ["companion"], createdAt: "2026-11-12T12:00:00Z" }
    ]
  }, {
    id: "foreign-group", userId: "other-user", name: "FOREIGN_GROUP", members: [],
    memories: [{ id: "foreign", content: "FOREIGN_GROUP_SECRET", confirmed: true, knownBy: ["companion"], createdAt: "2026-11-12T13:00:00Z" }]
  }];
  const f = fixture({ groupsForExport: groups });
  f.memories.push({ id: "formal", userId: "user", companionId: "companion", type: "user_fact", status: "active", content: "已有私聊记忆" });
  const formalBefore = plain(f.memories);
  const groupsBefore = plain(groups);
  const sent = await f.service.sendMessage("conversation", "hello");
  assert.ok(sent.assistantMessage);
  assert.equal(sent.assistantError, undefined);
  assert.equal(sent.pendingMemory, null);
  assert.deepEqual(f.state.groupMemoryReads, [{ userId: "user", companionId: "companion" }]);
  const promptMemories = f.state.promptInputs[0].memories;
  assert.equal(promptMemories.length, 2);
  assert.deepEqual(promptMemories[0], formalBefore[0]);
  assert.equal(promptMemories[1].type, "relationship_event");
  assert.equal(promptMemories[1].createdAt, "2026-11-12T10:00:00Z");
  assert.equal(promptMemories[1].sourceGroupId, "group-known");
  assert.deepEqual(promptMemories[1].sourceMessageIds, ["message-composition"]);
  assert.match(promptMemories[1].content, /群「摄影群」中你已知的共同经历（不代表私聊发生过）/);
  assert.match(promptMemories[1].content, /来源：群聊共享记忆，非私人既定事实.*一起讨论过构图/);
  assert.ok(!JSON.stringify(f.state.promptInputs).includes("GROUP_SECRET"));
  assert.deepEqual(f.memories, formalBefore);
  assert.equal(f.state.memoryWrites, 0);
  assert.deepEqual(plain(groups), groupsBefore);

  // Regeneration must read current shared context again, without caching a copy.
  groups[0].memories[0].content = "后来讨论了光线";
  const regenerated = await f.service.regenerateMessage("conversation", sent.assistantMessage.id);
  assert.ok(regenerated.assistantMessage);
  assert.equal(f.state.groupMemoryReads.length, 2);
  assert.equal(f.state.promptInputs[1].memories.length, 2);
  assert.match(f.state.promptInputs[1].memories[1].content, /后来讨论了光线/);
  assert.ok(!JSON.stringify(f.state.promptInputs[1]).includes("一起讨论过构图"));
  assert.ok(!JSON.stringify(f.state.promptInputs[1]).includes("GROUP_SECRET"));
  assert.deepEqual(f.memories, formalBefore);
  assert.equal(f.state.memoryWrites, 0);
});
