import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const filename = new URL("../src/lib/groups/reply-quality.ts", import.meta.url);
const source = readFileSync(filename, "utf8");
const compiled = ts.transpileModule(source, {
  fileName: filename.pathname,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
// No require, process, fetch, providers, database, or other external capabilities.
const sandbox = vm.createContext({ exports: {} });
new vm.Script(compiled.outputText, { filename: filename.pathname }).runInContext(sandbox);
const { assessGroupReply } = sandbox.exports;
const message = (content, speakerId = "peer", id = "m1") => ({ id, speakerId, content });
const assess = (content, history, options) => assessGroupReply(content, history, "self", options);
const issue = (content, history, kind, options) => {
  const result = assess(content, history, options);
  assert.equal(result?.kind, kind);
  assert.ok(history.some(item => item.id === result.sourceMessageId));
};

test("Chinese and English peer tails embedded in new text, including copy plus filler", () => {
  for (const [prior, tail] of [
    ["今天走了好远。回家的路上记得看看晚霞。", "回家的路上记得看看晚霞"],
    ["It was a long walk. Remember to watch the sunset on your way home.", "Remember to watch the sunset on your way home"],
  ]) {
    const history = [message(prior)];
    issue(`嗯，${tail}。哈哈，是的。`, history, "copied-fragment");
    issue(`My thought: ${tail}! That sounds good.`, history, "copied-fragment");
  }
});

test("normalizes punctuation, width, whitespace and case; supports supplementary Han", () => {
  issue("我想说：回 家 的 路 上，记 得 看 看 晚 霞！", [message("回家的路上记得看看晚霞。")], "copied-fragment");
  issue("REMEMBER, to watch the sunset on your way home!", [message("Remember to watch the sunset on your way home.")], "near-duplicate");
  issue("嗯，𠀀𠀁𠀂𠀃𠀄𠀅𠀆𠀇。哈哈", [message("这是前文。𠀀𠀁𠀂𠀃𠀄𠀅𠀆𠀇。")], "copied-fragment");
  issue("Ｔｈｅ sunset is beautiful over the distant mountain range.", [message("The sunset is beautiful over the distant mountain range.")], "near-duplicate");
});

test("exact and near duplicates from either speaker", () => {
  for (const speaker of ["self", "peer"]) {
    const history = [message("We could take the quiet path around the lake and stop at the old stone bridge before dinner.", speaker)];
    issue(history[0].content, history, "near-duplicate");
    issue("We could take the quiet path around the lake and stop at the old stone bridge before supper.", history, "near-duplicate");
    issue("明天我们沿着湖边慢慢散步，然后到桥边看看落日，再去街角的小店吃晚饭。", [message("明天我们沿着湖边慢慢散步，然后到桥边看看落日，再去街角的小店吃晚餐。", speaker)], "near-duplicate");
    issue("周末我想去河边看看落日。", [message("周末我想去河边看看落叶。", speaker)], "near-duplicate");
  }
});

test("long self opening requires two recent occurrences, and permits new endings", () => {
  const opening = "听起来今天你经历了不少事情。";
  const history = [message(`${opening}要不要先吃点东西再休息？`, "self", "s1"), message(`${opening}我们可以周末再去公园。`, "self", "s2")];
  const reply = `${opening}我刚才在书店发现一本画册。`;
  assert.equal(assess(reply, history.slice(0, 1)), null);
  issue(reply, history, "repeated-opening");
  assert.equal(assess("今天在书店发现一本画册，里面有你喜欢的风景。", history), null);
  assert.equal(assess("好呀。我们到图书馆见面吧。", [message("好呀。先去吃饭。", "self", "a"), message("好呀。明天下午。", "self", "b")]), null);
  issue("听起来今天你经历了不少事情，我刚发现一本画册。", [
    message("听起来今天你经历了不少事情，先吃点东西吧。", "self", "c1"),
    message("听起来今天你经历了不少事情，要不要一起散步？", "self", "c2"),
  ], "repeated-opening");
});

test("normal tiny acknowledgments are allowed; proactive exact tiny repeats are rejected", () => {
  for (const tiny of ["嗯", "好", "哈哈", "yes", "OK!"]) {
    const history = [message(tiny)];
    assert.equal(assess(tiny, history), null);
    issue(tiny, history, "near-duplicate", { proactive: true });
  }
  assert.equal(assess("嗯", [message("好")], { proactive: true }), null);
});

test("explicit quotations with substantive own reaction are allowed", () => {
  const zh = "回家的路上记得看看晚霞";
  const en = "Remember to watch the sunset on your way home";
  for (const [quote, reaction] of [
    [`“${zh}”`, "这句话让我想起小时候外婆家的阳台，我想周末回去看看。"],
    [`「${zh}」`, "我打算带上相机，到河边拍一组照片。"],
    [`\"${en}\"`, "I would rather bring my camera and photograph the river reflections tonight."],
  ]) {
    assert.equal(assess(`${quote}。${reaction}`, [message(`${zh}。${en}.`)]), null);
  }
  issue(`“${zh}”，嗯，好，哈哈。`, [message(`前面说了很多。${zh}。`)], "copied-fragment");
  const quotedReply = `“${zh}”，我准备带上相机去河边拍照。`;
  issue(quotedReply, [message(quotedReply, "self")], "near-duplicate");
});

test("shared names, facts, short responses and genuinely new responses remain allowed", () => {
  const history = [message("小明和张老师约在北京大学见面。集合时间是下午三点。")];
  for (const reply of ["小明到了吗？", "北京大学附近哪家面馆好吃？", "下午三点", "那我先去借本书，你们到了打电话。", "好的", ""]) {
    assert.equal(assess(reply, history), null);
  }
  assert.equal(assess("The train arrives at six, so I will buy dinner beforehand.", [message("The train arrives at six. I will walk home afterwards.")]), null);
  assert.equal(assess("Alpha beta gamma delta epsilon has a completely different ending now.", [message("Alpha beta gamma delta epsilon was only the title of that book.")]), null);
});

test("only latest peer tail and last twelve supplied messages are inspected", () => {
  const old = message("回家的路上记得看看晚霞", "peer", "old");
  const recent = Array.from({ length: 12 }, (_, i) => message(`独立的其他内容编号${i}`, "peer", `r${i}`));
  assert.equal(assess(old.content, [old, ...recent]), null);
  issue(old.content, [old, ...recent.slice(0, 11)], "near-duplicate");
  assert.equal(assess(`嗯，${old.content}，好呀。`, [old, message("嗯", "peer", "latest")]), null);
  assert.equal(assess(old.content, [message(old.content, null)]), null);
});

test("allowEcho bypasses every repetition category, including proactive tiny output", () => {
  for (const proactive of [false, true]) {
    for (const content of ["yes", "回家的路上记得看看晚霞"]) {
      assert.equal(assess(content, [message(content)], { allowEcho: true, proactive }), null);
    }
  }
  const history = [message("听起来今天你经历了不少事情。先吃饭。", "self", "s1"), message("听起来今天你经历了不少事情。先休息。", "self", "s2")];
  assert.equal(assess("听起来今天你经历了不少事情。明天去爬山。", history, { allowEcho: true }), null);
});

test("deterministic, immutable inputs and exact exported API", () => {
  const history = Object.freeze([Object.freeze(message("回家的路上记得看看晚霞"))]);
  const options = Object.freeze({ proactive: true });
  const before = JSON.stringify(history);
  const first = assess("好呀，回家的路上记得看看晚霞。", history, options);
  for (let i = 0; i < 5; i++) assert.deepEqual(assess("好呀，回家的路上记得看看晚霞。", history, options), first);
  assert.equal(JSON.stringify(history), before);
  assert.deepEqual(Object.keys(sandbox.exports), ["assessGroupReply"]);
});
