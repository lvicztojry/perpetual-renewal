import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/memory/extractor.ts", import.meta.url), "utf8");
const sandbox = { exports: {}, require() { throw new Error("Unexpected external dependency"); } };
vm.createContext(sandbox);
new vm.Script(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText).runInContext(sandbox);
const extract = content => JSON.parse(JSON.stringify(sandbox.exports.extractMemoryCandidates({ content, sourceMessageId: "source-user" })));

test("full explicit statements retain late negation, date and exact numbers beyond 96 chars", () => {
  const content = "我喜欢摄影，" + "细节还需要慢慢讨论，".repeat(13) + "但预算是八百不是一千，日期是11月30日";
  const result = extract(content);
  assert.ok(result.length > 0);
  for (const row of result) {
    assert.ok(row.content.endsWith(content));
    assert.equal(row.status, "PENDING");
    assert.equal(row.sourceMessageId, "source-user");
    assert.ok(row.content.length <= 500);
  }
});

test("identical long prefixes cannot collapse different factual endings", () => {
  const prefix = "我喜欢" + "认真讨论细节".repeat(22);
  const first = extract(prefix + "预算八百")[0];
  const second = extract(prefix + "预算一千")[0];
  assert.notEqual(first.content, second.content);
  assert.equal(extract(prefix + "预算八百。" + prefix + "预算一千").length, 2);
});

test("over-cap statements are skipped intact, not truncated into a different fact", () => {
  assert.deepEqual(extract("我喜欢" + "摄影".repeat(260) + "但不喜欢人像"), []);
  assert.ok(extract("我喜欢" + "景".repeat(480))[0].content.length <= 500);
});

test("hypothetical and quoted first-person facts never become user facts", () => {
  for (const content of ["如果我住在上海，明天会怎样？", "假设我叫阿青", "他说我住在上海", "朋友说：我喜欢下雨", "小说里我叫阿青，我住在北京", "请翻译：我住在北京", "If I live in Paris tomorrow, what changes?", "“我叫阿青。我住在北京”", "「我喜欢摄影；明天去上海」"]) {
    assert.deepEqual(extract(content), [], content);
  }
});

test("quotation masking preserves later real self-statements and UTF-16 boundaries", () => {
  const result = extract("朋友说：“我叫阿青😀。我住在北京”。我住在杭州");
  assert.equal(result.length, 1);
  assert.equal(result[0].content, "用户事实：我住在杭州");
});

test("real preferences about fiction and quoted titles are not discarded", () => {
  assert.ok(extract("我喜欢小说《十日终焉》").some(row => row.type === "EMOTIONAL_PREFERENCE"));
  assert.ok(extract('我喜欢“如果云知道”这首歌').some(row => row.type === "EMOTIONAL_PREFERENCE"));
});

test("new employment and changed preferences remain pending, with original temporal wording", () => {
  for (const content of ["我已经入职了，之前的面试结束了", "我不再喜欢喝咖啡，最近想喝茶", "我以前喜欢跑步，现在更喜欢散步"]) {
    const result = extract(content);
    assert.ok(result.length > 0, content);
    assert.ok(result.every(row => row.status === "PENDING" && row.content.endsWith(content)));
  }
});

test("newlines separate complete facts without concatenating them", () => {
  assert.deepEqual(extract("我叫小林\n我住在杭州").map(row => row.content), ["用户事实：我叫小林", "用户事实：我住在杭州"]);
  assert.deepEqual(extract("   "), []);
});
