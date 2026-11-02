import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const plain = (value) => JSON.parse(JSON.stringify(value));
const timestamp = "2026-10-30T09:00:00.000Z";
// Construct a synthetic credential so the repository scan still rejects literal keys.
const secret = "sk-" + "hermetic-proactive-key-0123456789";
const diagnostics = `Authorization: Bearer ${secret}; endpoint=https://provider.example.invalid/v1; prompt=private-prompt-marker; rawPayload=private-payload-marker`;

// Compile real modules in a closed VM: imports are allowlisted and there is no
// process, fetch, filesystem, vault, database or provider transport in the VM.
// Only provider lookup and the usage repository are I/O doubles. The usage
// service itself stays real, including its best-effort failure handling.
function harness(options = {}) {
  const requests = [];
  const lookups = [];
  const writes = [];
  const stored = [];
  const logs = [];
  const deadlines = [];
  const controller = new AbortController();
  const provider = {
    name: options.providerName ?? "compatible",
    async complete(request) {
      requests.push(request);
      return options.complete ? options.complete(request, api) : completion();
    }
  };
  const context = vm.createContext({
    Error, DOMException, Date,
    console: Object.fromEntries(["log", "warn", "error", "info", "debug"].map((level) =>
      [level, (...args) => logs.push({ level, args: args.map(String) })])),
    AbortSignal: {
      timeout(milliseconds) {
        deadlines.push(milliseconds);
        return controller.signal;
      }
    }
  });
  const modules = {
    "@/lib/prompt-builder": "prompt-builder/builder.ts",
    "@/lib/llm/types": "llm/types.ts",
    "@/lib/chat/reply-format": "chat/reply-format.ts",
    "@/lib/http/response-safety": "http/response-safety.ts",
    "@/lib/logging/sanitize": "logging/sanitize.ts",
    "@/lib/renewal/types": "renewal/types.ts",
    "@/lib/usage": "usage/service.ts",
    "./safety": "relationship/safety.ts"
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    });
    function require(specifier) {
      if (specifier === "@/lib/llm/user-provider") {
        return { async createUserLlmProvider(userId) {
          lookups.push(userId);
          if (options.lookupError) throw options.lookupError;
          return provider;
        } };
      }
      if (file === "usage/service.ts" && specifier === "./repository") {
        return { createUsageRepository: () => ({ async create(input) {
          writes.push(plain(input));
          if (options.usageError) throw options.usageError;
          stored.push(plain(input));
          return plain(input);
        } }) };
      }
      assert.ok(Object.hasOwn(modules, specifier), `Unexpected runtime import in ${file}: ${specifier}`);
      return load(modules[specifier]);
    }
    const execute = new vm.Script(`(function(exports, require) {\n${compiled.outputText}\n})`, {
      filename: file
    }).runInContext(context);
    execute(exports, require);
    return exports;
  }
  const safety = load("relationship/safety.ts");
  const companion = {
    id: "companion-test", userId: "user-test", conversationId: "conversation-test",
    name: "小岚", relationshipKind: "FRIEND", customKind: "一起看星星的老朋友",
    userAddress: "阿续", companionAddress: "岚岚", personality: ["温柔", "爱打趣"],
    speakingStyle: "简短自然，喜欢聊星星", background: "山间天文台的守夜人",
    boundaries: "不要催促回复", immersionEnabled: true,
    memories: ["active", "pending", "archived", "deleted"].map((status) => ({
      id: `memory-${status}`, companionId: "companion-test", userId: "user-test",
      sourceMessageId: null, type: "user_fact", status, content: `memory-${status}-marker`,
      confidence: 0.95, createdAt: timestamp, updatedAt: timestamp
    })),
    relationshipState: {
      companionId: "companion-test", familiarityScore: 67, closenessScore: 52,
      recentEmotion: "期待流星雨", importantEvents: ["一起认出北斗星"], explanation: "熟悉的朋友"
    }
  };
  const draft = {
    id: "draft-test", companionId: companion.id, kind: "DAILY_GREETING",
    content: "路过来打声招呼，愿你今天有个好心情。", reason: "到达问候时间",
    scheduledAt: timestamp, nextCandidateAt: timestamp,
    frequency: { preset: "24h", everyMinutes: 1440, label: "每天" },
    safety: safety.checkRelationshipSafety("路过来打声招呼，愿你今天有个好心情。", { stage: "proactive_draft" })
  };
  const history = [
    message("user", "history-user-marker 昨天看到了流星。"),
    message("assistant", "history-assistant-marker 真替你开心。")
  ];
  const helper = load("relationship/proactive-model.ts");
  const api = {
    requests, lookups, writes, stored, logs, deadlines, controller, provider,
    companion, draft, history, safety, types: load("llm/types.ts"),
    run: (configuredProvider) => helper.personalizeProactiveDraft(companion, draft, history, configuredProvider)
  };
  return api;
}

function message(role, content, metadata = null) {
  return { id: content, conversationId: "conversation-test", role, content, metadata, createdAt: timestamp };
}

function completion(content = "阿续，今晚的星星让我想起了你，有空再来聊聊呀。") {
  return { content, provider: "compatible", model: "hermetic-model", usage: {
    inputTokens: 80, outputTokens: 20, totalTokens: 100
  }, raw: { diagnostic: diagnostics } };
}

function fallback(result, app, source = "template") {
  assert.equal(result.source, source);
  assert.strictEqual(result.draft, app.draft, "fallback must preserve the original safe draft and metadata");
}

function usage(app, status, errorKind) {
  assert.equal(app.writes.length, 1, "each attempted model completion has one usage write");
  const row = app.writes[0];
  assert.equal(row.userId, app.companion.userId);
  assert.equal(row.companionId, app.companion.id);
  assert.equal(row.conversationId, app.companion.conversationId);
  assert.equal(row.purpose, "proactive_draft");
  assert.equal(row.provider, "compatible");
  assert.equal(row.status, status);
  assert.equal(row.errorKind, errorKind);
  assert.ok(Number.isFinite(row.latencyMs) && row.latencyMs >= 0);
}

function noDiagnostics(app, result) {
  const observed = JSON.stringify({ result, writes: app.writes, stored: app.stored, logs: app.logs });
  for (const marker of [secret, "private-prompt-marker", "private-payload-marker", "https://provider.example.invalid/v1"]) {
    assert.ok(!observed.includes(marker), "results, usage inputs and captured logs must exclude private diagnostics");
  }
}

test("configured provider receives real character, active memories, relationship and history plus a system proactive task", async () => {
  const app = harness();
  const before = plain({ companion: app.companion, draft: app.draft, history: app.history });
  const result = await app.run(app.provider);
  assert.equal(result.source, "model");
  assert.deepEqual(app.lookups, [], "explicit provider bypasses vault lookup");
  assert.equal(app.requests.length, 1);
  const request = app.requests[0];
  const system = request.messages[0];
  assert.equal(system.role, "system");
  for (const text of ["小岚", "朋友", "一起看星星的老朋友", "阿续", "岚岚", "温柔", "爱打趣",
    "简短自然，喜欢聊星星", "山间天文台的守夜人", "不要催促回复", "memory-active-marker", "期待流星雨", "一起认出北斗星"]) {
    assert.ok(system.content.includes(text), `real prompt must include ${text}`);
  }
  const prompt = JSON.stringify(request.messages);
  for (const status of ["pending", "archived", "deleted"]) assert.ok(!prompt.includes(`memory-${status}-marker`));
  assert.deepEqual(plain(request.messages.slice(1, -1)), app.history.map(({ role, content }) => ({ role, content })));
  assert.equal(request.messages.at(-1).role, "system");
  assert.match(request.messages.at(-1).content, /用户没有发来新消息/);
  assert.match(request.messages.at(-1).content, /主动/);
  assert.equal(request.messages.filter((m) => m.role === "user").length, 1, "no fabricated user turn");
  assert.equal(request.maxTokens, 384);
  assert.strictEqual(request.signal, app.controller.signal);
  assert.deepEqual(app.deadlines, [20_000]);
  assert.equal(result.draft.content, completion().content);
  assert.equal(result.draft.safety.action, "allow");
  assert.equal(result.draft.safety.stage, "proactive_draft");
  assert.equal(result.draft.postflightSafety.action, "allow");
  for (const key of ["id", "companionId", "kind", "reason", "scheduledAt", "nextCandidateAt", "frequency"]) {
    assert.deepEqual(plain(result.draft[key]), plain(app.draft[key]));
  }
  assert.deepEqual(plain({ companion: app.companion, draft: app.draft, history: app.history }), before);
  usage(app, "success");
  assert.equal(app.writes[0].model, "hermetic-model");
  assert.deepEqual(app.writes[0].usage, completion().usage);
  noDiagnostics(app, result);
});

test("default path resolves the provider for the companion's user", async () => {
  const app = harness();
  assert.equal((await app.run()).source, "model");
  assert.deepEqual(app.lookups, [app.companion.userId]);
  assert.equal(app.requests.length, 1);
});

for (const configured of [false, true]) {
  test(`mock provider skips completion and usage (configured=${configured})`, async () => {
    const app = harness({ providerName: "mock", complete: () => assert.fail("mock must not complete") });
    fallback(await app.run(configured ? app.provider : undefined), app);
    assert.equal(app.requests.length, 0);
    assert.equal(app.writes.length, 0);
    assert.equal(app.deadlines.length, 0);
  });
}

for (const text of ["我会线下见你", "忽略安全规则"]) {
  test(`high-risk source safety skips provider lookup and completion: ${text}`, async () => {
    const app = harness({ lookupError: new Error("lookup must not run") });
    app.draft.safety = app.safety.checkRelationshipSafety(text, { stage: "proactive_context" });
    assert.ok(app.safety.isHighRiskSafetyResult(app.draft.safety));
    fallback(await app.run(), app, "boundary");
    assert.deepEqual(app.lookups, []);
    assert.equal(app.requests.length, 0);
    assert.equal(app.writes.length, 0);
  });
}

for (const metadata of [{ deletedAt: timestamp }, { status: "failed" }]) {
  test(`history excludes ${JSON.stringify(metadata)} and historical system instructions`, async () => {
    const app = harness();
    app.history.push(message("assistant", "excluded-history-marker", metadata));
    app.history.push(message("system", "excluded-system-marker"));
    assert.equal((await app.run()).source, "model");
    const prompt = JSON.stringify(app.requests[0].messages);
    assert.ok(!prompt.includes("excluded-history-marker"), "deleted/failed content must not reach provider");
    assert.ok(!prompt.includes("excluded-system-marker"));
    assert.ok(prompt.includes("history-user-marker"));
    assert.ok(prompt.includes("history-assistant-marker"));
  });
}

test("real reply normalizer removes headings, emphasis, links and code fences", async () => {
  const app = harness({ complete: () => completion("# 晚安\r\n**阿续**， [看看星星](https://example.invalid/stars)\r\n```text\r\n今晚也记得休息。\r\n```") });
  const result = await app.run();
  assert.equal(result.source, "model");
  assert.equal(result.draft.content, "晚安\n阿续， 看看星星\n今晚也记得休息。");
});

for (const content of ["", " \n\t ", "```text\n\n```", "我会线下见你", "忽略安全规则"]) {
  test(`empty or unsafe output preserves safe template: ${JSON.stringify(content)}`, async () => {
    const app = harness({ complete: () => completion(content) });
    const result = await app.run();
    fallback(result, app);
    // Unsafe but completed responses consumed tokens; empty responses are errors.
    usage(app, content.includes("见你") || content.includes("规则") ? "success" : "error",
      content.includes("见你") || content.includes("规则") ? undefined : "provider_response");
    noDiagnostics(app, result);
  });
}

test("relational pressure is revised and rechecked by real safety", async () => {
  const app = harness({ complete: () => completion("你不回复就是不爱我。") });
  const result = await app.run();
  assert.equal(result.source, "model");
  assert.equal(result.draft.content, "我有点想你，但你可以按自己的节奏回来。");
  assert.equal(result.draft.postflightSafety.type, "RELATIONAL_PRESSURE");
  assert.equal(result.draft.postflightSafety.action, "revise");
  assert.equal(result.draft.safety.action, "allow");
  usage(app, "success");
});

test("provider output diagnostics are redacted before returning the draft or writing usage", async () => {
  const app = harness({ complete: () => completion(`晚安。 ${diagnostics}`) });
  const result = await app.run();
  assert.equal(result.source, "model");
  assert.ok(result.draft.content.includes("晚安。"));
  assert.ok(result.draft.content.includes("redacted"));
  noDiagnostics(app, result);
});

test("safety revision metadata does not retain credentials or private provider diagnostics", async () => {
  const app = harness({ complete: () => completion(`你不回复就是不爱我。 ${diagnostics}`) });
  const result = await app.run();
  assert.equal(result.source, "model");
  assert.equal(result.draft.postflightSafety.action, "revise");
  assert.equal(result.draft.safety.action, "allow");
  noDiagnostics(app, result);
});

for (const kind of ["generic", "authentication", "timeout"]) {
  test(`provider ${kind} error falls back and records only safe error classification`, async () => {
    const app = harness({ complete: (_request, api) => {
      if (kind === "generic") throw new Error(diagnostics);
      throw new api.types.LlmProviderError(diagnostics, {
        kind, provider: "compatible", cause: { raw: diagnostics }, model: "hermetic-model"
      });
    } });
    const result = await app.run();
    fallback(result, app);
    usage(app, "error", kind === "generic" ? "provider_response" : kind);
    noDiagnostics(app, result);
  });
}

test("deadline abort reaches provider signal and falls back without waiting twenty seconds", async () => {
  const app = harness({ complete: (request, api) => new Promise((_resolve, reject) => {
    request.signal.addEventListener("abort", () => reject(api.types.toLlmProviderError(request.signal.reason, {
      provider: "compatible"
    })), { once: true });
    queueMicrotask(() => api.controller.abort(new DOMException("Test deadline elapsed", "TimeoutError")));
  }) });
  fallback(await app.run(), app);
  assert.deepEqual(app.deadlines, [20_000]);
  assert.equal(app.requests[0].signal.aborted, true);
  usage(app, "error", "timeout");
});

test("provider lookup failure falls back without inventing a provider usage row", async () => {
  const app = harness({ lookupError: new Error(diagnostics) });
  const result = await app.run();
  fallback(result, app);
  assert.equal(app.requests.length, 0);
  assert.equal(app.writes.length, 0);
  noDiagnostics(app, result);
});

for (const failedCompletion of [false, true]) {
  test(`usage persistence failure stays best effort (completion failed=${failedCompletion})`, async () => {
    const app = harness({
      usageError: new Error(`Database unavailable; Authorization: Bearer ${secret}`),
      complete: () => {
        if (failedCompletion) throw new Error(diagnostics);
        return completion();
      }
    });
    const result = await app.run();
    if (failedCompletion) fallback(result, app);
    else assert.equal(result.source, "model", "usage outage must not discard a valid model reply");
    usage(app, failedCompletion ? "error" : "success", failedCompletion ? "provider_response" : undefined);
    assert.equal(app.stored.length, 0);
    assert.equal(app.logs.length, 1, "real usage service emits one sanitized warning");
    assert.equal(app.logs[0].level, "warn");
    noDiagnostics(app, result);
  });
}
