import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as ts from "typescript";

const source = await readFile(new URL("../src/lib/import/transcript.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: "transcript.ts",
  reportDiagnostics: true
});
assert.equal(transpiled.diagnostics.length, 0);
const sandbox = { exports: {}, require(specifier) { throw new Error(`Unexpected require: ${specifier}`); } };
vm.createContext(sandbox);
new vm.Script(transpiled.outputText, { filename: "transcript.js" }).runInContext(sandbox);
const { parseTranscript, transcriptLimits } = sandbox.exports;
const plain = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, run) {
  try { run(); passed++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}
const check = (input, expected) => assert.deepEqual(plain(parseTranscript(input).messages), expected);

test("Chinese, ASCII separators, multiline and aggregation", () => {
  const result = plain(parseTranscript("\uFEFF 小 明 ：你好\r\n第二行\r\n\r\n第三行\r\n小红: 好呀\r\n小   明: 再见"));
  assert.deepEqual(result.messages, [
    { speaker: "小 明", content: "你好\n第二行\n\n第三行" },
    { speaker: "小红", content: "好呀" },
    { speaker: "小 明", content: "再见" }
  ]);
  assert.deepEqual(result.participants, [{ name: "小 明", count: 2 }, { name: "小红", count: 1 }]);
  assert.equal(result.totalMessages, 3);
  assert.deepEqual(result.warnings, []);
});
test("URLs and times remain body text", () => {
  check("https://example.org\n12:30 开始\n不明来源\n阿明: 链接\nhttps://example.org/a:b\n12:30:00 到达\nhttps: example\n乙: 收到", [
    { speaker: "阿明", content: "链接\nhttps://example.org/a:b\n12:30:00 到达\nhttps: example" },
    { speaker: "乙", content: "收到" }
  ]);
  assert.match(parseTranscript("https://example.org\n12:30 开始\n不明来源").warnings.join(), /忽略 3 行/);
});
test("QQ account headers and WeChat timestamp headers", () => {
  check("2025-01-02 09:08:07 张 三(123456)\n你好\n续行\n2025-01-02 09:09:00 李四(a@example.org)\n再见\n[2025-01-03 10:00:00] 小王:微信消息", [
    { speaker: "张 三", content: "你好\n续行", timestamp: "2025-01-02 09:08:07" },
    { speaker: "李四", content: "再见", timestamp: "2025-01-02 09:09:00" },
    { speaker: "小王", content: "微信消息", timestamp: "2025-01-03 10:00:00" }
  ]);
});
test("date, name and body variants", () => {
  check("2025/1/2 9:08 小王 正文\n2025-01-03 10:00:00 小李：第二条\n2025-01-04 11:00:00\n小陈\n第三条\n2025-01-05\n小吴\n第四条", [
    { speaker: "小王", content: "正文", timestamp: "2025/1/2 9:08" },
    { speaker: "小李", content: "第二条", timestamp: "2025-01-03 10:00:00" },
    { speaker: "小陈", content: "第三条", timestamp: "2025-01-04 11:00:00" },
    { speaker: "小吴", content: "第四条", timestamp: "2025-01-05" }
  ]);
});
test("JSON aliases, roles, timestamps and missing speaker", () => {
  const rows = [
    { speaker: " 阿 明 ", content: "第一行\n第二行", timestamp: "2025-01-01" },
    { sender: "阿 明", text: "再见" }, { name: "乙", message: "你好" },
    { from: "丙", content: "好", time: "12:30" },
    { role: "user", content: "提问" }, { role: "assistant", content: "回答" },
    { content: "无说话者" }, { role: "system", content: "规则" },
    { speaker: " ", content: "缺少名字" }, { speaker: "甲", content: { text: "不可强转" } },
    null, 42, { speaker: "甲", content: "[图片]" }, { speaker: "系统消息", content: "通知" }
  ];
  const result = plain(parseTranscript(JSON.stringify(rows)));
  assert.equal(result.totalMessages, 6);
  assert.equal(result.messages[0].content, "第一行\n第二行");
  assert.equal(result.messages[0].timestamp, "2025-01-01");
  assert.equal(result.messages[3].timestamp, "12:30");
  assert.deepEqual(result.participants[0], { name: "阿 明", count: 2 });
  assert.match(result.warnings.join(), /忽略 8 条记录/);
  assert.deepEqual(plain(parseTranscript(JSON.stringify({ messages: rows })).messages), result.messages);
});
test("JSONL parses each row and counts invalid rows", () => {
  const input = '{"sender":"甲","text":"一"}\n{"bad":\n{"content":"匿名"}\n{"role":"assistant","message":"二"}\n垃圾\n';
  const result = parseTranscript(input);
  assert.equal(result.totalMessages, 2);
  assert.equal(result.messages[1].speaker, "assistant");
  assert.match(result.warnings.join(), /忽略 3 行/);
  const valid = parseTranscript('{"sender":"甲","text":"一"}\n{"role":"user","content":"二"}');
  assert.equal(valid.totalMessages, 2);
  assert.deepEqual(plain(valid.warnings), []);
});
test("date-only inline exports, account colons and Chinese dates", () => {
  check("2025-01-01 甲 正文\n[2025年1月2日 12:30] 乙: 中文日期\n2025-01-03 09:00:00 甲(123)：再次", [
    { speaker: "甲", content: "正文", timestamp: "2025-01-01" },
    { speaker: "乙", content: "中文日期", timestamp: "2025年1月2日 12:30" },
    { speaker: "甲", content: "再次", timestamp: "2025-01-03 09:00:00" }
  ]);
});
test("standalone attachment lines and prefixed times do not create speakers", () => {
  const result = parseTranscript("甲: 开始\n[图片]\n[语音]\n下午12:30 到达\nwss://example.com\n乙: 结束");
  assert.deepEqual(plain(result.messages), [
    { speaker: "甲", content: "开始\n下午12:30 到达\nwss://example.com" },
    { speaker: "乙", content: "结束" }
  ]);
  assert.match(result.warnings.join(), /忽略 2 行/);
});
test("bad JSON never turns property names into speakers", () => {
  for (const input of ['{\n"speaker": "甲",\n"content": "错误"', '[{"speaker":"甲",}]', '{"a": invalid}']) {
    assert.equal(parseTranscript(input).totalMessages, 0);
    assert.ok(parseTranscript(input).warnings.length);
  }
  check('甲: 前文\n{"speaker": broken}\n无归属\n乙: 后文', [
    { speaker: "甲", content: "前文" }, { speaker: "乙", content: "后文" }
  ]);
});
test("empty, malformed and unsupported binary inputs", () => {
  for (const input of ["", " \n\t", "无说话者的原文", "[]", '{"messages":[]}', "null"]) {
    assert.equal(parseTranscript(input).totalMessages, 0);
    assert.ok(parseTranscript(input).warnings.length);
  }
  for (const input of ["SQLite format 3\u0000xxxxx", "abc\u0000abc", "PK\u0003\u0004xxx"]) {
    const result = parseTranscript(input);
    assert.equal(result.totalMessages, 0);
    assert.match(result.warnings.join(), /unsupported/);
  }
  assert.throws(() => parseTranscript(null), /文本/);
});
test("system, attachments, empty messages and ignored line totals", () => {
  const result = parseTranscript("孤立原文\n系统: 通知\n甲:\n乙: [图片]\n丙: [文件]\n丁: 有用\n你撤回了一条消息\n无法归属\n戊: 最后");
  assert.deepEqual(plain(result.messages), [{ speaker: "丁", content: "有用" }, { speaker: "戊", content: "最后" }]);
  assert.match(result.warnings.join(), /忽略 7 行/);
  check("甲: [图片] 这张照片有说明", [{ speaker: "甲", content: "[图片] 这张照片有说明" }]);
});
test("character limit accepts boundary and rejects excess without truncation", () => {
  assert.deepEqual(plain(transcriptLimits), { maxChars: 200_000, maxMessages: 4000 });
  assert.equal(parseTranscript("甲:" + "字".repeat(199998)).messages[0].content.length, 199998);
  assert.throws(() => parseTranscript("甲:" + "字".repeat(199999)), /200,000.*拆分/);
});
test("message limit covers text, JSON and JSONL", () => {
  for (const encode of [
    n => Array.from({ length: n }, () => "甲: 一").join("\n"),
    n => JSON.stringify(Array.from({ length: n }, () => ({ name: "甲", text: "一" }))),
    n => Array.from({ length: n }, () => '{"from":"甲","text":"一"}').join("\n")
  ]) {
    assert.equal(parseTranscript(encode(4000)).totalMessages, 4000);
    assert.throws(() => parseTranscript(encode(4001)), /4000.*拆分/);
  }
});
test("speaker and participant limits apply after normalization", () => {
  assert.equal(parseTranscript("名".repeat(100) + ":正文").totalMessages, 1);
  assert.throws(() => parseTranscript("名".repeat(101) + ":正文"), /姓名.*100/);
  assert.throws(() => parseTranscript(JSON.stringify([{ name: "名".repeat(101), text: "正文" }])), /姓名.*100/);
  const input = n => Array.from({ length: n }, (_, i) => `用户${i}: 正文`).join("\n");
  assert.equal(parseTranscript(input(100)).participants.length, 100);
  assert.throws(() => parseTranscript(input(101)), /参与者.*100/);
  assert.equal(parseTranscript(input(100) + "\n 用户0 : 再次").participants[0].count, 2);
});

console.log(`Transcript import passed: ${passed} test groups.`);
