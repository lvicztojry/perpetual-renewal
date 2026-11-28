import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { validateDocumentationContract } from "../scripts/lib/documentation-contract.mjs";

const script = readFileSync(new URL("../scripts/docs-consistency.mjs", import.meta.url), "utf8");
const rule = script.slice(script.indexOf("function checkCurrentStatusSource()"), script.indexOf("function checkDocsText("));
assert.ok(rule.includes("function checkCurrentStatusSource"));
const files = ["README.md", "docs/README.md", "docs/PHASE-1.5.md", "docs/QA.md", "docs/RELEASE_HANDOFF.md", "docs/PR_DRAFT.md"];
const valid = Object.fromEntries(files.map((file) => [file, "[当前状态](MVP_STATUS.md)"]));
valid["docs/MVP_STATUS.md"] = "更新：2026-11-09\n## 当前任务快照\n## 验收记录\n## 当前施工顺序\nMVP_STATUS_HISTORY.md QA.md TASKBOOK.md";
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

const json = file => JSON.parse(readFileSync(new URL("../" + file, import.meta.url), "utf8"));
const documentPaths = ["README.md", "docs/MVP_STATUS.md", "docs/TASKBOOK.md", "docs/TASKBOOK_HISTORY.md", "docs/QA.md", "docs/QA_HISTORY.md", "docs/RELEASE_HANDOFF.md", "docs/RELEASE_HANDOFF_HISTORY.md"];
const contract = {
  documents: Object.fromEntries(documentPaths.map(file => [file, readFileSync(new URL("../" + file, import.meta.url), "utf8")])),
  versions: { native: json("native/package.json").version, application: json("package.json").version, tauri: json("native/src-tauri/tauri.conf.json").version, announcement: json("src/lib/release-notes.json")[0].version },
  site: json("site/site.json"),
  netlify: readFileSync(new URL("../netlify.toml", import.meta.url), "utf8")
};
assert.deepEqual(validateDocumentationContract(contract), [], "actual repository documentation must satisfy its contract");
function rejectsMutation(change, pattern) {
  const changed = structuredClone(contract);
  change(changed);
  assert(validateDocumentationContract(changed).some(finding => pattern.test(finding)), String(pattern));
}
rejectsMutation(data => { data.versions.announcement = "0.0.0"; }, /Version drift/);
rejectsMutation(data => { data.documents["docs/MVP_STATUS.md"] = data.documents["docs/MVP_STATUS.md"].replace(/^应用版本：`[^`]+`/m, "应用版本：`0.0.0`"); }, /application version differs/);
rejectsMutation(data => { data.documents["docs/TASKBOOK.md"] += "\n## 当前任务快照\n"; }, /duplicates the current task snapshot/);
rejectsMutation(data => { data.documents["docs/MVP_STATUS.md"] += "\n## 当前任务快照\n"; }, /exactly one current task snapshot/);
rejectsMutation(data => { data.documents["docs/MVP_STATUS.md"] = data.documents["docs/MVP_STATUS.md"].replace(/\| DOC-1 ([^|]+)\| completed \|/, "| DOC-1 $1| integrated |"); }, /invalid status/);
rejectsMutation(data => { data.documents["docs/QA.md"] = "No history link"; }, /history archive/);
rejectsMutation(data => { data.documents["docs/TASKBOOK.md"] = data.documents["docs/TASKBOOK.md"].replace("### DOC-1 ", "### LOST-1 "); }, /no Taskbook definition/);
rejectsMutation(data => { data.site.downloads.android.sha256 = "invalid"; }, /SHA-256/);
rejectsMutation(data => { data.site.downloads.windows.url = data.site.downloads.windows.url.replace(/\/releases\/download\/[^/]+\//, "/releases/download/v0.0.0/"); }, /tag version drift/);
rejectsMutation(data => { data.site.downloads.web.url = data.site.url; }, /Introduction site must not/);
rejectsMutation(data => { data.site.url = "https://changed.example.invalid"; }, /Root README introduction URL/);
rejectsMutation(data => { data.netlify = data.netlify.replace('publish = "site/dist"', 'publish = ".next"'); }, /standalone introduction site/);
console.log("Documentation ownership guard passed: real files plus version, status, archive, download and deployment-boundary counterexamples.");

const boundary = readFileSync(new URL("../scripts/git-boundary-check.mjs", import.meta.url), "utf8");
const patterns = boundary.slice(boundary.indexOf("const forbiddenPathPatterns"), boundary.indexOf("const requiredProjectFiles"));
const predicate = boundary.slice(boundary.indexOf("function checkForbiddenFiles("), boundary.indexOf("function checkRequiredFiles("));
function forbidden(file) {
  const findings = [];
  vm.runInNewContext(patterns + predicate + '\ncheckForbiddenFiles("fixture", [file]);', { file, findings });
  return findings.length > 0;
}
for (const file of [".netlify-token", "native/.env.local", ".env.production", "deploy/site.env", "deploy/.secrets/key", ".netlify/state.json", ".release-keys/android/signing.p12", ".build-tools/cargo/cache.crate", "logs/current/trace.json", ".tmp-apkcheck/x/classes.dex", "site/dist/index.html", "native/dist/index.html", "native/src-tauri/gen/android/app.apk", "native/src-tauri/target/release/client.exe"]) assert(forbidden(file), file);
for (const file of [".env.example", "netlify.toml", "site/site.json", "site/assets/icon.svg", "native/src/runtime/codec.ts", "design/previews/2026-11-23/journey-windows.png", "docs/TASKBOOK_HISTORY.md"]) assert(!forbidden(file), file);
console.log("Generated/private path guard passed: force-added credentials/caches rejected; public source and historical evidence retained.");
