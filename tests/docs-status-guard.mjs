import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync(new URL("../scripts/docs-consistency.mjs", import.meta.url), "utf8");
const rule = script.slice(script.indexOf("function checkCurrentStatusSource()"), script.indexOf("function checkDocsText("));
assert.ok(rule.includes("function checkCurrentStatusSource"));
const files = ["README.md", "docs/README.md", "docs/PHASE-1.5.md", "docs/QA.md", "docs/RELEASE_HANDOFF.md", "docs/PR_DRAFT.md"];
const valid = Object.fromEntries(files.map((file) => [file, "[当前状态](MVP_STATUS.md)"]));
valid["docs/MVP_STATUS.md"] = "更新：2026-11-09\n## 验收记录\n## 当前施工顺序\nMVP_STATUS_HISTORY.md QA.md TASKBOOK.md";
function check(overrides = {}) {
  const content = { ...valid, ...overrides };
  const findings = [];
  vm.runInNewContext(`${rule}\ncheckCurrentStatusSource();`, { readText: (file) => content[file], findings });
  return findings;
}
assert.equal(check().length, 0);
assert.ok(check({ "README.md": "MVP_STATUS.md\n当前自动验收：旧状态" }).some((item) => item.includes("duplicates")));
assert.ok(check({ "docs/QA.md": "只有复制的测试数字" }).some((item) => item.includes("must link")));
assert.ok(check({ "docs/MVP_STATUS.md": "## 当前结论" }).some((item) => item.includes("Current status missing")));
console.log("Current-status guard passed: valid source, duplicate rejection, required links and evidence headings.");
