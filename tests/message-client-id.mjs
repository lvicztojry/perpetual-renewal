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

function fixture({ failReply = false } = {}) {
  const messages = [{
    id: "existing", conversationId: "conversation", role: "user", content: "Earlier",
    metadata: { important: true, source: "existing" }
  }];
  const state = { writes: 0, providerCalls: 0, replies: 0, usage: [] };
  const repo = {
    async getConversation(userId, conversationId) {
      assert.equal(userId, "user");
      assert.equal(conversationId, "conversation");
      return { companionId: "companion" };
    },
    async getCompanion(userId, companionId) {
      assert.equal(userId, "user");
      assert.equal(companionId, "companion");
      return { id: companionId, name: "Fixture", relationshipKind: "FRIEND", memories: [] };
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
    async createPendingMemory() { state.writes++; return { id: "pending" }; },
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
  const serviceModule = compile("../src/lib/renewal/service.ts", {
    "./types": types,
    "./repository": { createRenewalRepository: () => repo },
    "@/lib/llm/types": { LlmProviderError: class extends Error {} },
    "@/lib/chat": { async generateCompanionReply() {
      state.replies++;
      if (failReply) throw new Error("Offline failure");
      return completion;
    } },
    "@/lib/memory/extractor": { extractMemoryCandidates() { throw new Error("Unexpected extraction"); } },
    "@/lib/http/response-safety": { redactSensitiveResponseText: (value) => value },
    "@/lib/usage": { async recordModelUsage(entry) { state.usage.push(plain(entry)); } },
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
    state, messages,
    service: new serviceModule.RenewalService(repo, "user"),
    MessageValidationError: serviceModule.MessageValidationError,
    post: (body) => route.POST(new Request("http://offline/messages", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }), context),
    get: () => route.GET(new Request("http://offline/messages"), context)
  };
}

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
  assert.deepEqual(result.pendingMemory, { id: "pending" });
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
