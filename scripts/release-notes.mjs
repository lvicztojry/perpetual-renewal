import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const releases = read("../src/lib/release-notes.json");
assert(releases.length > 0, "A release entry is required");
assert.equal(releases[0].version, read("../native/package.json").version, "Add release notes for the current native version");
assert.equal(new Set(releases.map(r => r.id)).size, releases.length, "Release IDs must be unique");
for (const [index, r] of releases.entries()) {
  assert(r.id && r.title && /^\d{4}-\d{2}-\d{2}$/.test(r.date), "Release metadata is incomplete");
  assert(r.sections.length && r.sections.every(s => s.title && s.items.length && s.items.every(item => typeof item === "string" && item.trim())), "Describe each change");
  if (index) assert(releases[index - 1].date >= r.date, "Newest release must come first");
}
const output = "# 开发与版本更新日志\n\n此文件由 `src/lib/release-notes.json` 生成，与客户端公告共用一份记录。\n\n每次发布先新增记录，并同步原生版本号和构建号；运行 `npm run release:notes` 更新日志，`npm run release:check` 检查同步情况。历史记录保留，修复构建也应使用独立 ID。\n\n" + releases.map(r => `## ${r.version} · ${r.date} · ${r.title}\n\n记录 ID：\`${r.id}\`\n\n` + r.sections.map(s => `### ${s.title}\n\n` + s.items.map(item => `- ${item}\n`).join("")).join("\n")).join("\n");
const document = new URL("../docs/DEVELOPMENT_LOG.md", import.meta.url);
if (process.argv.includes("--write")) writeFileSync(document, output);
else assert.equal(readFileSync(document, "utf8").replaceAll("\r\n", "\n"), output, "Run npm run release:notes to update the development log");
console.log("Release notes and native version are consistent.");
