import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Modules enter an isolated VM with explicit dependencies: no app, DB or network.
function compile(name, globals = {}, imports = {}, directory = "lib/client-sync") {
  const source = readFileSync(new URL(`../src/${directory}/${name}.ts`, import.meta.url), "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true
  });
  assert.equal(result.diagnostics.length, 0);
  const compiledModule = { exports: {} };
  const context = vm.createContext({ AbortController, ...globals });
  const run = new vm.Script(`(function(exports, require, module) {${result.outputText}\n})`).runInContext(context);
  run(compiledModule.exports, specifier => {
    if (Object.hasOwn(imports, specifier)) return imports[specifier];
    throw new Error(`Unexpected import: ${specifier}`);
  }, compiledModule);
  return compiledModule.exports;
}
const { startForegroundPoll } = compile("poll");
const { reconcileMessageSnapshot } = compile("messages");
const readModule = compile("read");
const { acknowledgeReadMessages } = readModule;

test("LAN HTTP correlation IDs work without randomUUID and retain UUID version/variant bits", () => {
  let calls = 0;
  const { createClientId } = compile("id", { crypto: { getRandomValues(bytes) { calls++; bytes.fill(255); return bytes; } } });
  assert.equal(createClientId(), "ffffffff-ffff-4fff-bfff-ffffffffffff");
  assert.equal(calls, 1);
});
test("native randomUUID retains its receiver and is preferred when available", () => {
  const source = { randomUUID() { assert.equal(this, source); return "native-id"; }, getRandomValues() { assert.fail("Unexpected fallback"); } };
  assert.equal(compile("id", { crypto: source }).createClientId(), "native-id");
});
test("missing browser randomness fails explicitly rather than using weak IDs", () => {
  assert.throws(() => compile("id").createClientId(), /浏览器不支持/);
});
const plain = value => JSON.parse(JSON.stringify(value));
const ids = rows => Array.from(rows, row => row.id);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
// Drain promise continuations, without advancing the fake clock.
async function settle() { for (let n = 0; n < 6; n++) await Promise.resolve(); }
function clockHost() {
  let now = 0, next = 0, visible = true;
  const timers = new Map(), listeners = new Set();
  const host = {
    visible: () => visible,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    schedule(run, delay) { const id = ++next; timers.set(id, { run, at: now + delay }); return id; },
    cancel(id) { timers.delete(id); }
  };
  return {
    host, timers, listeners,
    setVisible(value) { visible = value; },
    wake() { for (const fn of [...listeners]) fn(); },
    delays() { return [...timers.values()].map(t => t.at - now).sort((a, b) => a - b); },
    async advance(ms) {
      const end = now + ms;
      for (let guard = 0; guard < 100; guard++) {
        const item = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!item) { now = end; await settle(); return; }
        const [id, timer] = item;
        now = timer.at; timers.delete(id); timer.run(); await settle();
      }
      assert.fail("Fake timer loop did not quiesce");
    }
  };
}
function polling(t, options = {}) {
  const clock = clockHost(), requests = [];
  let active = 0, maximum = 0;
  const dispose = startForegroundPoll(clock.host, signal => {
    const gate = deferred();
    active++; maximum = Math.max(maximum, active);
    requests.push({ ...gate, signal });
    return gate.promise.finally(() => { active--; });
  }, options.interval);
  t.after(dispose);
  return { ...clock, requests, dispose, maximum: () => maximum };
}

test("hidden initial load and hidden timer do not fetch; visible wake resumes", async t => {
  const f = polling(t);
  f.setVisible(false);
  await f.advance(0);
  f.wake(); f.wake();
  assert.equal(f.requests.length, 0);
  f.setVisible(true); f.wake();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve(); await settle();
  f.setVisible(false); await f.advance(7000);
  assert.equal(f.requests.length, 1);
  f.setVisible(true); f.wake();
  assert.equal(f.requests.length, 2);
});

test("focus/visibility/online bursts coalesce to one follow-up with no overlap", async t => {
  const f = polling(t);
  await f.advance(0);
  for (let i = 0; i < 12; i++) f.wake();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve(); await settle();
  assert.deepEqual(f.delays(), [0]);
  await f.advance(0);
  assert.equal(f.requests.length, 2);
  assert.equal(f.maximum(), 1);
  f.requests[1].resolve(); await settle();
  assert.deepEqual(f.delays(), [7000]);
  await f.advance(6999);
  assert.equal(f.requests.length, 2);
  await f.advance(1);
  assert.equal(f.requests.length, 3);
});

test("a visible wake cancels the old interval instead of adding another poll", async t => {
  const f = polling(t);
  await f.advance(0); f.requests[0].resolve(); await settle();
  await f.advance(6999); f.wake();
  assert.equal(f.requests.length, 2);
  await f.advance(1);
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve(); await settle();
  assert.deepEqual(f.delays(), [7000]);
});

test("rejection recovers on the configured inbox interval and then on wake", async t => {
  const f = polling(t, { interval: 15000 });
  await f.advance(0);
  f.requests[0].reject(new Error("synthetic transport failure")); await settle();
  assert.deepEqual(f.delays(), [15000]);
  await f.advance(15000);
  f.wake(); f.requests[1].reject(new Error("still offline")); await settle();
  await f.advance(0);
  assert.equal(f.requests.length, 3);
  f.requests[2].resolve(); await settle();
  assert.deepEqual(f.delays(), [15000]);
  assert.equal(f.maximum(), 1);
});

test("synchronous transport throws also leave a usable retry timer", async t => {
  const f = clockHost();
  let calls = 0;
  const dispose = startForegroundPoll(f.host, () => { calls++; throw new Error("synthetic"); });
  t.after(dispose);
  await f.advance(0); await f.advance(7000);
  assert.equal(calls, 2);
  assert.deepEqual(f.delays(), [7000]);
});

test("deadline aborts the in-flight request and rejection allows recovery", async t => {
  const f = polling(t);
  await f.advance(0); await f.advance(19999);
  assert.equal(f.requests[0].signal.aborted, false);
  await f.advance(1);
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests[0].reject(new Error("aborted")); await settle();
  assert.deepEqual(f.delays(), [7000]);
  await f.advance(7000);
  assert.equal(f.requests.length, 2);
});

for (const outcome of ["resolve", "reject"]) {
  test(`dispose aborts old scope; late ${outcome} cannot schedule or disturb a new scope`, async t => {
    const old = polling(t);
    await old.advance(0); old.wake(); old.dispose(); old.dispose();
    assert.equal(old.requests[0].signal.aborted, true);
    assert.equal(old.listeners.size, 0);
    const fresh = polling(t);
    await fresh.advance(0);
    old.requests[0][outcome](outcome === "reject" ? new Error("late old scope") : undefined);
    await settle(); old.wake(); await old.advance(60000);
    assert.equal(old.requests.length, 1);
    assert.equal(old.timers.size, 0);
    assert.equal(fresh.requests[0].signal.aborted, false);
    fresh.requests[0].resolve(); await settle();
    assert.deepEqual(fresh.delays(), [7000]);
  });
}

test("dispose before startup and during idle cancels scheduled work", async t => {
  for (const started of [false, true]) {
    const f = polling(t);
    if (started) { await f.advance(0); f.requests[0].resolve(); await settle(); }
    f.dispose(); await f.advance(60000); f.wake();
    assert.equal(f.requests.length, started ? 1 : 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
  }
});

function message(id, minute, metadata = null, conversationId = "a") {
  return { id, conversationId, role: "user", content: id, metadata,
    createdAt: `2026-11-17T00:${String(minute).padStart(2, "0")}:00.000Z` };
}
test("successive authoritative snapshots remove remote deletions while retaining only delivery overlays", () => {
  // The second argument is exclusively pending/in-flight overlays, never prior history.
  const local = [message("sending", 2, { clientMessageId: "send", localStatus: "sending" }),
    message("failed", 3, { clientMessageId: "fail", localStatus: "unconfirmed" })];
  assert.deepEqual(ids(reconcileMessageSnapshot([message("deleted", 0), message("kept", 1)], local, "a")),
    ["deleted", "kept", "sending", "failed"]);
  assert.deepEqual(ids(reconcileMessageSnapshot([message("kept", 1)], local, "a")), ["kept", "sending", "failed"]);
  assert.deepEqual(ids(reconcileMessageSnapshot([], local, "a")), ["sending", "failed"]);
});

test("server clientMessageId confirmation replaces optimistic IDs and metadata", () => {
  const optimistic = message("local-x", 0, { clientMessageId: "x", localStatus: "sending" });
  const failed = message("local-y", 2, { clientMessageId: "y", localStatus: "unconfirmed" });
  const canonical = message("server-x", 1, { clientMessageId: "x" });
  const result = reconcileMessageSnapshot([canonical], [optimistic, optimistic, failed], "a");
  assert.deepEqual(ids(result), ["server-x", "local-y"]);
  assert.deepEqual(plain(result[0]), canonical);
});

test("scope filtering precedes correlation; foreign client IDs cannot erase local overlays", () => {
  const pending = message("local", 2, { clientMessageId: "shared", localStatus: "sending" });
  const server = [message("foreign", 0, { clientMessageId: "shared" }, "b"), message("ours", 1)];
  const local = [message("foreign-local", 0, { localStatus: "unconfirmed" }, "b"), pending];
  const before = plain({ server, local });
  assert.deepEqual(ids(reconcileMessageSnapshot(server, local, "a")), ["ours", "local"]);
  assert.deepEqual(plain({ server, local }), before);
});

test("same-ID canonical content wins; results are chronological and inputs stay immutable", () => {
  const server = [message("later", 4), { ...message("same", 1), content: "canonical" }];
  const local = [{ ...message("same", 0, { localStatus: "sending" }), content: "optimistic" },
    message("failed", 3, { localStatus: "unconfirmed" })];
  const before = plain({ server, local });
  const result = reconcileMessageSnapshot(server, local, "a");
  assert.deepEqual(ids(result), ["same", "failed", "later"]);
  assert.equal(result[0].content, "canonical");
  assert.deepEqual(plain({ server, local }), before);
});

test("read batches use unique loaded IDs, cap at 200, and accept idempotent zero counts", async () => {
  const acknowledged = new Set(["old"]), batches = [];
  let updates = 0;
  const messageIds = ["old", ...Array.from({ length: 401 }, (_, i) => `m${i}`), "m0"];
  await acknowledgeReadMessages({ messageIds, acknowledged, signal: new AbortController().signal,
    canRead: () => true, post: async batch => { batches.push(Array.from(batch)); return { markedCount: 0 }; },
    updated: () => updates++ });
  assert.deepEqual(batches.map(batch => batch.length), [200, 200, 1]);
  assert.equal(acknowledged.size, 402);
  assert.equal(updates, 3);
});

test("a partial receipt refreshes immediately and a cancelled batch remains retryable", async () => {
  const controller = new AbortController(), acknowledged = new Set();
  let posts = 0, updates = 0;
  const messageIds = Array.from({ length: 201 }, (_, i) => `m${i}`);
  await acknowledgeReadMessages({ messageIds, acknowledged, signal: controller.signal, canRead: () => true,
    post: async batch => {
      if (++posts === 2) { assert.equal(updates, 1); controller.abort(); }
      return { markedCount: batch.length };
    }, updated: () => updates++ });
  assert.equal(acknowledged.size, 200);
  assert.equal(updates, 2);
  await acknowledgeReadMessages({ messageIds, acknowledged, signal: new AbortController().signal, canRead: () => true,
    post: async batch => { assert.deepEqual(Array.from(batch), ["m200"]); return { markedCount: 0 }; },
    updated: () => updates++ });
  assert.equal(acknowledged.size, 201);
});

for (const result of [null, { markedCount: -1 }, { markedCount: 2 }, { markedCount: 0.5 }]) {
  test(`failed or malformed read response stays retryable: ${JSON.stringify(result)}`, async () => {
    const acknowledged = new Set();
    let updates = 0;
    await acknowledgeReadMessages({ messageIds: ["incoming"], acknowledged, signal: new AbortController().signal,
      canRead: () => true, post: async () => { if (!result) throw new Error("offline"); return result; },
      updated: () => updates++ });
    assert.equal(acknowledged.size, 0);
    assert.equal(updates, 1);
  });
}

// Exercise the actual hooks and poller with a minimal effect host and fake fetch.
// Requests resolve only when a test says so; no browser, server or model is used.
function unreadHooks(t) {
  const clock = clockHost(), slots = [], requests = [];
  let cursor = 0, effects = [], dirty = true, output;
  let props = { userId: "u", threadId: "a", messageIds: ["m1"], enabled: true, canRead: true };
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const react = {
    useRef(value) { const i = cursor++; slots[i] ??= { current: value }; return slots[i]; },
    useState(value) {
      const i = cursor++; slots[i] ??= { value };
      return [slots[i].value, next => {
        const value = typeof next === "function" ? next(slots[i].value) : next;
        if (!Object.is(slots[i].value, value)) { slots[i].value = value; dirty = true; }
      }];
    },
    useMemo(factory, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) slots[i] = { value: factory(), deps };
      return slots[i].value;
    },
    useEffect(effect, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: effect() };
      });
    }
  };
  const document = Object.assign(new EventTarget(), { visibilityState: "visible", hasFocus: () => false });
  const window = new EventTarget();
  const globals = { document, window, Event, setTimeout: clock.host.schedule, clearTimeout: clock.host.cancel,
    fetch(url, options = {}) {
      const gate = deferred();
      requests.push({ url, ...options, ...gate, reply(data, status = 200) {
        gate.resolve({ status, ok: status >= 200 && status < 300, json: async () => data });
      } });
      return gate.promise;
    } };
  const foreground = compile("use-foreground-poll", globals, { react, "@/lib/client-sync/poll": { startForegroundPoll } }, "components");
  const hooks = compile("use-inbox-sync", globals, { react, "./use-foreground-poll": foreground, "@/lib/client-sync/read": readModule }, "components");
  function render() {
    cursor = 0; effects = []; dirty = false;
    output = hooks.useInboxSync(props.userId);
    hooks.useReadMessages(props.userId, "private", props.threadId, props.messageIds,
      props.enabled && output.state === "ready", () => props.canRead, props.viewKey);
    for (const effect of effects) effect();
  }
  async function flush() {
    for (let i = 0; i < 20; i++) {
      await settle();
      if (dirty) render();
      await clock.advance(0);
    }
  }
  const inbox = (count, threadId = props.threadId) => ({ userId: props.userId, threads: [{ scope: "private", threadId, unreadCount: count }] });
  render();
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); });
  return { ...clock, requests, document, window, flush, inbox,
    get output() { return output; },
    set(next) { props = { ...props, ...next }; dirty = true; },
    async ready(count = 1) { await flush(); requests[0].reply(inbox(count)); await flush(); }
  };
}

test("visible mobile chat clears unread without document focus; old GET cannot restore badge", async t => {
  const f = unreadHooks(t);
  await f.ready();
  const receipt = f.requests.find(r => r.method === "POST");
  assert.ok(receipt, "visible mobile chat sends its receipt despite hasFocus=false");
  assert.deepEqual(JSON.parse(receipt.body).messageIds, ["m1"]);
  f.window.dispatchEvent(new Event("focus")); await f.flush();
  const stale = f.requests.filter(r => r.url === "/api/sync/inbox").at(-1);
  receipt.reply({ markedCount: 1 }); await f.flush();
  assert.equal(stale.signal.aborted, true);
  const fresh = f.requests.filter(r => r.url === "/api/sync/inbox").at(-1);
  assert.notEqual(fresh, stale, "fresh inbox fetch starts without waiting for stale GET");
  fresh.reply(f.inbox(0)); await f.flush();
  stale.reply(f.inbox(1)); await f.flush();
  assert.equal(f.output.count("private", "a"), 0);
});

test("new incoming IDs queue behind a pending receipt without cancelling it", async t => {
  const f = unreadHooks(t);
  await f.ready();
  const first = f.requests.find(r => r.method === "POST");
  f.set({ messageIds: ["m1", "m2"] }); await f.flush();
  assert.equal(first.signal.aborted, false);
  assert.equal(f.requests.filter(r => r.method === "POST").length, 1);
  first.reply({ markedCount: 1 }); await f.flush();
  const posts = f.requests.filter(r => r.method === "POST");
  assert.equal(posts.length, 2);
  assert.deepEqual(JSON.parse(posts[1].body).messageIds, ["m2"]);
});

test("opening the same selected mobile chat immediately acknowledges loaded IDs without focus or a timer", async t => {
  const f = unreadHooks(t);
  f.set({ canRead: false, viewKey: "contacts" }); await f.ready();
  assert.equal(f.requests.filter(r => r.method === "POST").length, 0);
  assert.equal(f.document.hasFocus(), false);
  // Identity, enabled and IDs stay unchanged. Only the view becomes readable.
  f.set({ canRead: true, viewKey: "conversation" }); await f.flush();
  const posts = f.requests.filter(r => r.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].body).messageIds, ["m1"]);
});

test("a mobile view change cannot acknowledge loaded IDs while the document is hidden", async t => {
  const f = unreadHooks(t);
  f.set({ canRead: false, viewKey: "contacts" }); await f.ready();
  f.document.visibilityState = "hidden";
  f.set({ canRead: true, viewKey: "conversation" }); await f.flush();
  assert.equal(f.requests.filter(r => r.method === "POST").length, 0);
  f.document.visibilityState = "visible";
  f.document.dispatchEvent(new Event("visibilitychange")); await f.flush();
  assert.equal(f.requests.filter(r => r.method === "POST").length, 1);
});

test("view changes queue behind an active receipt without cancelling or resending it", async t => {
  const f = unreadHooks(t);
  f.set({ viewKey: "conversation" }); await f.ready();
  const first = f.requests.find(r => r.method === "POST");
  f.set({ canRead: false, viewKey: "contacts" }); await f.flush();
  f.set({ canRead: true, viewKey: "conversation" }); await f.flush();
  assert.equal(first.signal.aborted, false);
  assert.equal(f.requests.filter(r => r.method === "POST").length, 1);
  first.reply({ markedCount: 1 }); await f.flush();
  assert.equal(f.requests.filter(r => r.method === "POST").length, 1);
});

test("scroll/viewport gate and hidden document block receipts until readable", async t => {
  const f = unreadHooks(t);
  f.set({ enabled: false }); await f.ready();
  assert.equal(f.requests.filter(r => r.method === "POST").length, 0);
  f.set({ enabled: true, canRead: false }); await f.flush();
  assert.equal(f.requests.filter(r => r.method === "POST").length, 0);
  f.document.visibilityState = "hidden";
  f.set({ canRead: true }); f.document.dispatchEvent(new Event("visibilitychange")); await f.advance(15000); await f.flush();
  assert.equal(f.requests.filter(r => r.method === "POST").length, 0);
  f.document.visibilityState = "visible";
  f.document.dispatchEvent(new Event("visibilitychange")); await f.flush();
  assert.equal(f.requests.filter(r => r.method === "POST").length, 1);
});

test("late old-thread receipt cannot suppress IDs in the current thread", async t => {
  const f = unreadHooks(t);
  await f.ready();
  const first = f.requests.find(r => r.method === "POST");
  f.set({ threadId: "b" }); await f.flush();
  assert.equal(first.signal.aborted, true);
  const second = f.requests.filter(r => r.method === "POST").at(-1);
  assert.equal(JSON.parse(second.body).threadId, "b");
  first.reply({ markedCount: 1 }); await f.flush();
  second.reply({ markedCount: 1 }); await f.flush();
  f.set({ threadId: "a" }); await f.flush();
  const retry = f.requests.filter(r => r.method === "POST").at(-1);
  assert.equal(JSON.parse(retry.body).threadId, "a");
  assert.deepEqual(JSON.parse(retry.body).messageIds, ["m1"]);
});

