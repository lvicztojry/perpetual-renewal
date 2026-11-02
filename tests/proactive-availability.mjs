import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const routeFile = "app/api/companions/[companionId]/proactive-drafts/route.ts";
const old = "2020-01-01T00:00:00.000Z";
const plain = (value) => JSON.parse(JSON.stringify(value));

// Run the real route, planner, safety, frequency and private response helpers.
// Only session, persistence and personalization are doubles; no env files or I/O.
function fixture(options = {}) {
  const profiles = [false, true].map((enabled, index) => ({
    id: `fixture-user-${index}`, email: `fixture-${index}@example.invalid`,
    proactiveMessagesEnabled: enabled, proactiveFrequencyHours: 24,
    privateMarker: `fixture-profile-private-${index}`
  }));
  const companions = profiles.map((profile, index) => ({
    id: `fixture-companion-${index}`, userId: profile.id,
    conversationId: `fixture-conversation-${index}`, name: "Fixture companion",
    relationshipKind: "FRIEND", personality: ["温柔"], speakingStyle: "自然",
    immersionEnabled: true, proactiveMessagesEnabled: true,
    proactiveFrequencyPreset: "1m", proactiveFrequencyMinutes: 1, createdAt: old,
    relationshipState: {
      id: `fixture-state-${index}`, companionId: `fixture-companion-${index}`,
      familiarityScore: 20, closenessScore: 20, importantEvents: [], lastInteractionAt: old
    }
  }));
  Object.assign(profiles[0], options.profile);
  Object.assign(companions[0], options.companion);
  const calls = [];
  const stored = companions.map((companion, index) => ({
    id: `fixture-draft-${index}`, companionId: companion.id, userId: companion.userId,
    kind: "DAILY_GREETING", content: `fixture-content-${index}`, reason: "fixture reason",
    safety: { result: { action: "allow" } }, status: "draft", scheduledAt: old,
    createdAt: old, updatedAt: old, privateMarker: `fixture-record-private-${index}`
  }));
  let userId = profiles[0].id;
  let bothReads;
  const readsReady = new Promise((resolve) => { bothReads = resolve; });
  const readStarted = new Set();
  async function readGate(kind) {
    readStarted.add(kind);
    if (readStarted.size === 2) bothReads();
    if (options.parallelReads) await readsReady;
  }
  const repository = {
    persistence: "fixture",
    async getCompanion(owner, id) {
      calls.push(["companion", owner, id]);
      await readGate("companion");
      if (options.companionError) throw options.companionError;
      return companions.find((item) => item.userId === owner && item.id === id) ?? null;
    },
    async listProactiveMessages(owner, id) {
      calls.push(["list", owner, id]);
      return stored.filter((item) => item.userId === owner && item.companionId === id);
    },
    async listMessages(owner, id) {
      calls.push(["history", owner, id]);
      assert.ok(companions.some((item) => item.userId === owner && item.conversationId === id));
      return [{ role: "user", content: "今天看到了星星", createdAt: old }];
    },
    async createProactiveMessage(owner, id, input) {
      calls.push(["create", owner, id, plain(input)]);
      assert.ok(companions.some((item) => item.userId === owner && item.id === id));
      const record = { id: `fixture-created-${stored.length}`, userId: owner,
        companionId: id, ...plain(input), createdAt: old, updatedAt: old };
      stored.push(record);
      return record;
    },
    async deliverProactiveMessage(owner, id, input) {
      calls.push(["deliver", owner, id, plain(input)]);
      const record = stored.find((item) => item.userId === owner && item.id === id);
      assert.ok(record);
      assert.equal(input.automatic, true);
      return { proactiveMessage: { ...record, status: "sent" },
        message: { id: "fixture-delivered", content: record.content, role: "assistant" } };
    }
  };
  const context = vm.createContext({ Date, Error, Response, Headers,
    process: { env: { DATABASE_URL: "fixture", RENEWAL_REPOSITORY: "prisma" } } });
  const cache = new Map();
  const stubs = {
    "node:crypto": { createHash },
    "next/server": { NextResponse: Response },
    "@/lib/auth/session": { async getCurrentSession() {
      if (options.unauthenticated) throw new (load("lib/auth/errors.ts").AuthenticationRequiredError)();
      return { userId };
    } },
    "@/lib/users/profile": { async getUserProfile(owner) {
      calls.push(["profile", owner]);
      await readGate("profile");
      if (options.profileError) throw options.profileError;
      return profiles.find((item) => item.id === owner);
    } },
    "@/lib/renewal/repository": { createRenewalRepository: () => repository },
    "@/lib/relationship/proactive-model": { async personalizeProactiveDraft(companion, draft, history) {
      calls.push(["personalize", companion.id, history.length]);
      return { draft: { ...draft, content: "fixture personalized greeting" }, source: "fixture" };
    } }
  };
  const modules = {
    "@/lib/http/private-response": "lib/http/private-response.ts",
    "@/lib/http/json": "lib/http/json.ts",
    "@/lib/http/persistence-errors": "lib/http/persistence-errors.ts",
    "@/lib/auth/errors": "lib/auth/errors.ts",
    "./private-response": "lib/http/private-response.ts",
    "./proactive-frequency": "lib/relationship/proactive-frequency.ts",
    "./safety": "lib/relationship/safety.ts",
    "@/lib/http/response-safety": "lib/http/response-safety.ts",
    "@/lib/logging/sanitize": "lib/logging/sanitize.ts"
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const { outputText } = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    });
    function require(name) {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name === "@/lib/relationship") return {
        ...load("lib/relationship/proactive.ts"), ...load("lib/relationship/proactive-frequency.ts"),
        ...load("lib/relationship/safety.ts")
      };
      assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
      return load(modules[name]);
    }
    new vm.Script(`(function(exports, require) {${outputText}\n})`, { filename: file })
      .runInContext(context)(exports, require);
    return exports;
  }
  const route = load(routeFile);
  const preferences = () => JSON.stringify({ profiles, companions });
  const initialPreferences = preferences();
  return {
    calls, stored, profiles, companions,
    setUser: (id) => { userId = id; },
    assertPreferencesUnchanged: () => assert.equal(preferences(), initialPreferences),
    async request(method, body = {}, id = companions[0].id) {
      const request = new Request("https://fixture.example.invalid/proactive", {
        method, ...(method === "POST" ? { body: JSON.stringify(body) } : {})
      });
      const response = await route[method](request, { params: Promise.resolve({ companionId: id }) });
      assert.match(response.headers.get("Cache-Control"), /private, no-store/);
      assert.match(response.headers.get("Vary"), /Cookie/);
      assert.match(response.headers.get("Vary"), /Authorization/);
      return { status: response.status, body: await response.json() };
    }
  };
}

for (const accountEnabled of [false, true]) {
  for (const companionEnabled of [false, true]) {
    test(`GET persisted switches: account=${accountEnabled}, companion=${companionEnabled}`, async () => {
      const f = fixture({ profile: { proactiveMessagesEnabled: accountEnabled },
        companion: { proactiveMessagesEnabled: companionEnabled }, parallelReads: true });
      const { status, body } = await f.request("GET");
      assert.equal(status, 200);
      assert.deepEqual(body.availability, { accountEnabled, companionEnabled,
        effectiveEnabled: accountEnabled && companionEnabled, frequencyMinutes: 1, mode: "foreground" });
      assert.equal(body.data[0].content, "fixture-content-0");
      assert.equal(body.persistence, "fixture");
      assert.doesNotMatch(JSON.stringify(body), /fixture-profile-private|fixture-record-private|fixture-content-1|email/);
      assert.deepEqual(f.calls.map((call) => call[0]), ["companion", "profile", "list"]);
      f.assertPreferencesUnchanged();
    });
  }
}

test("GET frequency follows persisted preset/custom interval with profile fallback", async () => {
  for (const [companion, expected] of [
    [{ proactiveFrequencyPreset: "6h", proactiveFrequencyMinutes: 1 }, 360],
    [{ proactiveFrequencyPreset: "custom", proactiveFrequencyMinutes: 7 }, 7],
    [{ proactiveFrequencyPreset: undefined, proactiveFrequencyMinutes: undefined }, 120]
  ]) {
    const f = fixture({ companion, profile: { proactiveFrequencyHours: 2 } });
    assert.equal((await f.request("GET")).body.availability.frequencyMinutes, expected);
  }
});

for (const [accountEnabled, companionEnabled] of [[false, true], [true, false], [false, false]]) {
  for (const overrides of [{}, { force: true }, { frequencyHours: 0 }, { frequencyMinutes: 0 }]) {
    test(`POST disabled ${accountEnabled}/${companionEnabled} with ${JSON.stringify(overrides)}`, async () => {
      const f = fixture({ profile: { proactiveMessagesEnabled: accountEnabled },
        companion: { proactiveMessagesEnabled: companionEnabled } });
      const before = JSON.stringify(f.stored);
      const { status, body } = await f.request("POST", { ...overrides, proactiveMessagesEnabled: true });
      assert.equal(status, 200);
      assert.deepEqual(body.availability, { accountEnabled, companionEnabled, effectiveEnabled: false,
        frequencyMinutes: 1, mode: "foreground" });
      assert.equal(body.skippedReason, "主动回响已关闭。");
      assert.deepEqual(body.data, []);
      assert.equal(body.savedCount, 0);
      assert.equal(body.generatedCount, 0);
      assert.equal(body.deliveredCount, 0);
      assert.ok(!f.calls.some(([kind]) => ["create", "deliver", "personalize"].includes(kind)));
      assert.equal(JSON.stringify(f.stored), before);
      f.assertPreferencesUnchanged();
    });
  }
}

test("POST request opt-out keeps persisted availability and authoritative skippedReason", async () => {
  const f = fixture({ profile: { proactiveMessagesEnabled: true } });
  const { body } = await f.request("POST", { proactiveMessagesEnabled: false, force: true });
  assert.equal(body.availability.effectiveEnabled, true);
  assert.equal(body.skippedReason, "主动回响已关闭。");
  assert.equal(body.savedCount, 0);
  assert.ok(!f.calls.some(([kind]) => ["create", "deliver", "personalize"].includes(kind)));
  f.assertPreferencesUnchanged();
});

test("POST enabled due path personalizes one draft and automatically delivers with scoped identity", async () => {
  const f = fixture({ profile: { proactiveMessagesEnabled: true } });
  const { body } = await f.request("POST");
  assert.equal(body.availability.effectiveEnabled, true);
  assert.equal(body.skippedReason, null);
  assert.equal(body.schedule.due, true);
  assert.equal(body.status, "sent");
  assert.equal(body.savedCount, 1);
  assert.equal(body.deliveredCount, 1);
  assert.equal(body.draftLimitReached, true);
  assert.equal(body.data[0].content, "fixture personalized greeting");
  assert.equal(body.data[0].status, "sent");
  const create = f.calls.find(([kind]) => kind === "create");
  assert.deepEqual(create.slice(1, 3), ["fixture-user-0", "fixture-companion-0"]);
  assert.equal(create[3].deliveryKey,
    createHash("sha256").update(`fixture-companion-0:${body.schedule.candidateAt}`).digest("hex"));
  assert.equal(f.calls.filter(([kind]) => kind === "personalize").length, 1);
  assert.equal(f.calls.filter(([kind]) => kind === "deliver").length, 1);
  f.assertPreferencesUnchanged();
});

test("POST enabled force retains template drafts, maxDrafts and request frequency without changing preferences", async () => {
  const f = fixture({ profile: { proactiveMessagesEnabled: true } });
  const { body } = await f.request("POST", { force: true, frequencyMinutes: 7, maxDrafts: 2 });
  assert.equal(body.frequency.everyMinutes, 7);
  assert.equal(body.availability.frequencyMinutes, 1);
  assert.equal(body.savedCount, 2);
  assert.equal(body.maxDrafts, 2);
  assert.equal(body.deliveredCount, 0);
  assert.equal(body.status, "draft");
  assert.equal(body.skippedReason, null);
  assert.ok(!f.calls.some(([kind]) => ["personalize", "deliver"].includes(kind)));
  assert.ok(f.calls.filter(([kind]) => kind === "create").every((call) => call[3].deliveryKey === null));
  f.assertPreferencesUnchanged();
});

test("POST enabled not due retains schedule skippedReason and performs no generation", async () => {
  const f = fixture({ profile: { proactiveMessagesEnabled: true } });
  f.stored[0].createdAt = new Date().toISOString();
  const { body } = await f.request("POST");
  assert.equal(body.availability.effectiveEnabled, true);
  assert.equal(body.schedule.due, false);
  assert.equal(body.skippedReason, body.schedule.reason);
  assert.equal(body.savedCount, 0);
  assert.ok(!f.calls.some(([kind]) => ["create", "deliver", "personalize"].includes(kind)));
});

for (const method of ["GET", "POST"]) {
  test(`${method} foreign/missing companion is 404 and returns no private state`, async () => {
    const f = fixture();
    for (const id of ["fixture-companion-1", "fixture-missing"]) {
      const { status, body } = await f.request(method, { force: true, userId: "fixture-user-1" }, id);
      assert.equal(status, 404);
      assert.deepEqual(body, { error: "Companion not found." });
    }
    assert.ok(!f.calls.some(([kind]) => ["history", "create", "deliver", "personalize"].includes(kind)));
    assert.ok(f.calls.every((call) => call[1] === "fixture-user-0"));
    f.assertPreferencesUnchanged();
  });

  test(`${method} changing authenticated identity reads that user's profile and relation only`, async () => {
    const f = fixture();
    f.setUser("fixture-user-1");
    const { status, body } = await f.request(method, {}, "fixture-companion-1");
    assert.equal(status, 200);
    assert.equal(body.availability.accountEnabled, true);
    assert.equal(body.availability.effectiveEnabled, true);
    assert.ok(f.calls.filter(([kind]) => kind !== "personalize").every((call) => call[1] === "fixture-user-1"));
    assert.doesNotMatch(JSON.stringify(body), /fixture-content-0|fixture-profile-private|fixture-record-private/);
    f.assertPreferencesUnchanged();
  });

  test(`${method} unauthenticated access does not read persistence or expose availability`, async () => {
    const f = fixture({ unauthenticated: true });
    const { status, body } = await f.request(method);
    assert.equal(status, 401);
    assert.equal(body.errorType, "authentication_required");
    assert.equal(body.availability, undefined);
    assert.deepEqual(f.calls, []);
  });

  test(`${method} profile failure fails closed through existing persistence error response`, async () => {
    const f = fixture({ profileError: Object.assign(new Error("fixture failure"), { code: "P1001" }) });
    const { status, body } = await f.request(method);
    assert.equal(status, 503);
    assert.equal(body.errorType, "database_unavailable");
    assert.equal(body.availability, undefined);
    assert.ok(!f.calls.some(([kind]) => ["history", "create", "deliver", "personalize"].includes(kind)));
  });
}

test("GET observes concurrent companion/profile rejections without exposing partial state", async () => {
  const error = Object.assign(new Error("fixture failure"), { code: "P1001" });
  const f = fixture({ parallelReads: true, profileError: error, companionError: error });
  const { status, body } = await f.request("GET");
  assert.equal(status, 503);
  assert.equal(body.availability, undefined);
  assert.deepEqual(f.calls.map(([kind]) => kind), ["companion", "profile"]);
});
