import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/relationship/proactive-quality.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
});
const exports = {};
// No require, provider, process, or network available to the implementation.
vm.runInNewContext(`(function(exports) { ${compiled.outputText}\n})`, {})(exports);
const evaluate = (text, history = [], range = { minChars: 5, maxChars: 200 }) =>
  JSON.parse(JSON.stringify(exports.evaluateProactiveQuality(text, history, range)));
const passes = (text, history, range) => assert.deepEqual(evaluate(text, history, range), { ok: true, issues: [] });
const fails = (text, history, expected, range) => {
  const result = evaluate(text, history, range);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes(expected)), JSON.stringify(result));
};

test("empty, format-only and grossly short output fails; natural short phrases survive", () => {
  for (const text of ["", " \n\t", "**。。。**", "```text\n\n```", "# \n---"]) fails(text, [], "为空");
  fails("嗯。", [], "过短");
  for (const text of ["晚安好梦", "想你了呀", "早点休息", "Hi", "👋晚安好梦"]) {
    passes(text, [], text === "Hi" ? { minChars: 0, maxChars: 10 } : undefined);
  }
});

test("exact maximum and unicode characters", () => {
  passes("晚安好梦！", [], { minChars: 5, maxChars: 5 });
  fails("晚安好梦！！", [], "上限", { minChars: 5, maxChars: 5 });
  passes("𠮷野晚安", [], { minChars: 5, maxChars: 4 });
  fails("今晚看星", [], "过短", { minChars: 30, maxChars: 100 });
});

test("short targets allow natural phrases and retain the three-character floor", () => {
  passes("想你啦", [], { minChars: 5, maxChars: 20 });
  passes("晚安好梦", [], { minChars: 9, maxChars: 20 });
  fails("晚安", [], "过短", { minChars: 5, maxChars: 20 });
});

test("medium and long minimums allow slack but enforce meaningful length", () => {
  const topic = "昨晚看到你发来的星空照片我又翻出了那本天文图册里面标着我们上次没找到的几颗星等周末天气晴朗的时候可以带着望远镜去山顶看看顺便试试新买的镜头能不能拍清楚月面的环形山你觉得从哪一片星区开始比较有趣";
  // Fixed boundaries document the 60% slack, including rounding up at min=26.
  for (const [minChars, boundary] of [[10, 6], [25, 15], [26, 16], [70, 42], [120, 72]]) {
    const range = { minChars, maxChars: 200 };
    fails(topic.slice(0, boundary - 1), [], "过短", range);
    passes(topic.slice(0, boundary), [], range);
    passes(topic.slice(0, boundary + 3), [], range);
  }
  // Formatting and punctuation cannot pad an under-target message.
  fails("**今晚想和你一起看星星**！！！！！！", [], "过短", { minChars: 25, maxChars: 100 });
});

test("the same ten-character message passes short mode but fails medium and long modes", () => {
  const text = "今晚想和你一起看星星";
  assert.equal(Array.from(text).length, 10);
  passes(text, [], { minChars: 5, maxChars: 20 });
  for (const minChars of [25, 70, 120]) {
    fails(text, [], "过短", { minChars, maxChars: 200 });
  }
  passes(text, [], { minChars: 5, maxChars: 20 });
});

test("punctuation, markdown links, casing and compatibility forms normalize", () => {
  fails("# **今晚**，去[看星星](https://example.invalid/private)！", ["今晚去看星星。"], "重复");
  fails("ＨＥＬＬＯ，Ｍｏｏｎ！", ["hello moon"], "重复");
  fails("```text\n晚安好梦\n```", ["晚安，好梦！"], "重复");
  passes("**晚安好梦**", [], { minChars: 5, maxChars: 4 });
});

test("near repeats include natural paraphrases in CJK and Latin", () => {
  fails("你昨天提到的面试准备得怎么样，今晚要不要一起练练自我介绍？",
    ["昨天你提到的面试准备得怎么样，今晚我们一起练练自我介绍吧。"], "重复");
  fails("我惦记着你昨天说的论文答辩，准备得还顺利吗？",
    ["我还在想你上次提到的论文答辩，准备得怎么样？"], "重复");
  fails("How is your telescope repair going today?", ["How is your telescope repair going tonight?"], "重复");
});

test("distinct short phrases, questions and shared openings are not repetition", () => {
  passes("晚安好梦", ["早点休息", "想你了呀", "今晚看星"]);
  passes("面试如何", ["面试加油"]);
  passes("你昨天说的蓝莓蛋糕做好了吗？", ["你昨天说的山地自行车修好了吗？"]);
  passes("今晚看星", ["今晚看星的话记得带上外套，山顶风大，顺便试试新买的望远镜。"]);
});

test("paired generic comfort is rejected even without history, including paraphrases", () => {
  for (const text of [
    "我还在想你刚刚说的，不想说也没关系，我一直在这里陪你。",
    "刚才那些话我还记得，你暂时不想开口也不要紧，我会静静地陪着你。",
    "我仍然惦记着你之前提到的那些事，不必勉强回复，我始终在你身边。",
    "不想聊也没关系，我会一直在这里陪你。"
  ]) fails(text, [], "空泛");
});

test("specific empathy, relevant questions and affection survive paired comfort detection", () => {
  for (const text of [
    "我还在想你刚刚说的妈妈住院的事，不想说也没关系，我一直在这里陪你。",
    "论文答辩明天就到了，紧张的话我可以陪你练一遍开场。",
    "我还记得你说的橘猫手术，不想聊也没关系，我在这里陪你。",
    "你昨天说的牙疼好些了吗？",
    "胃疼，不想说也没关系，我一直在这里陪你。",
    "我还记得你的面试，不想聊也没关系，我会陪着你。",
    "想你了，看到路边的桂花开了，好想和你一起闻闻。",
    "给你一个抱抱，今天也辛苦啦。"
  ]) passes(text);
});

test("occasional comfort ending passes but repeated ending families fail", () => {
  const history = ["妈妈的复查安排在周三，我一直在这里陪你。", "答辩的投影片改完了吧，我会静静地陪着你。"];
  passes("新买的吉他到了吗？我在这里陪你。", [history[0]]);
  passes("新买的吉他到了吗？弹一首试试吧。", history);
  fails("新买的吉他到了吗？我在这里陪你。", history, "收尾");
  fails("窗边的薄荷又长高了，今天也要照顾好自己。",
    ["今早的云很漂亮，记得好好照顾自己。", "周末去逛书店吧。早点休息。"], "收尾");
  passes("窗边的薄荷又长高了，今天也要照顾好自己。", ["今早的云很漂亮，记得好好照顾自己。"]);
});

test("only last twelve slots count, nonstrings are ignored and inputs stay untouched", () => {
  const text = "午后的桂花开了，一起出去走走吗？";
  const history = [text, ...Array.from({ length: 12 }, (_, i) => `今天第${i}份报告完成了`)];
  passes(text, history);
  fails(text, [...history, text], "重复");
  const mixed = Object.freeze([null, 42, {}, undefined, "晚安好梦"]);
  passes("今晚看星", mixed);
  fails("晚安好梦", mixed, "重复");
  passes("今晚看星", ["无".repeat(100_000)]);
});

test("all feedback is fixed Chinese instructions without private excerpts", () => {
  const privateText = "私密标记9876我还在想你刚刚说的，不想说也没关系，我一直在这里陪你。";
  const result = evaluate(privateText, [privateText], { minChars: 5, maxChars: 10 });
  assert.equal(result.ok, false);
  assert.ok(result.issues.length >= 2);
  assert.ok(result.issues.every((issue) => /^[\p{Script=Han}，。]+$/u.test(issue)));
  assert.ok(!JSON.stringify(result).includes("9876"));
});
