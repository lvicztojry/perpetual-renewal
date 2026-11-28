import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function load(file) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const exports = {};
  new Function("exports", outputText)(exports);
  return exports;
}
const catalog = load("../src/lib/ability-catalog.ts");
const events = load("../src/lib/ability-events.ts");

test("only renewal sees; other registered and future factory captions hear", () => {
  assert.deepEqual(Object.keys(catalog.ABILITY_CATALOG), ["renewal", "dream"]);
  assert.equal(catalog.ABILITY_CATALOG.renewal.caption, "我看到了【生生不息】的激荡");
  assert.equal(catalog.ABILITY_CATALOG.dream.caption, "我听到了【入梦】的回响");
  assert.equal(catalog.createHeardAbility("测试能力", "仅测试").caption, "我听到了【测试能力】的回响");
  for (const invalid of ["toString", "__proto__", "future", null, 0]) assert.equal(catalog.isAbilityKind(invalid), false);
  for (const kind of Object.keys(catalog.ABILITY_CATALOG)) assert.equal(catalog.isAbilityKind(kind), true);
});

test("burst reserves the active scene before rendering and preserves every request in FIFO order", () => {
  const queue = events.createAbilityIntroQueue();
  const first = { kind: "renewal", autoPlay: true };
  const dream = { kind: "dream", companionName: "测试", short: true };
  assert.equal(queue.enqueue(first), first);
  assert.equal(queue.pendingCount, 0);
  assert.equal(queue.enqueue(dream), undefined);
  assert.equal(queue.enqueue(first), undefined);
  assert.equal(queue.pendingCount, 2);
  assert.equal(queue.next(), dream);
  assert.equal(queue.pendingCount, 1);
  assert.equal(queue.next(), first);
  assert.equal(queue.next(), undefined);
  assert.equal(queue.enqueue(dream), dream);
  queue.enqueue(first);
  queue.clear();
  assert.equal(queue.pendingCount, 0);
  assert.equal(queue.next(), undefined);
  assert.equal(queue.enqueue(first), first);
});

test("server imports and legacy event names remain safe and compatible", () => {
  assert.equal(events.ABILITY_INTRO_EVENT, "renewal:ability-intro");
  assert.equal(events.ABILITY_INTRO_STATE_EVENT, "renewal:ability-state");
  assert.equal(events.dispatchAbilityIntro, events.playAbilityIntro);
  assert.doesNotThrow(() => events.playAbilityIntro({ kind: "dream" }));
  assert.doesNotThrow(() => events.publishAbilityIntroState(false));
});
