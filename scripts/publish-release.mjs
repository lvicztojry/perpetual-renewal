import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 把 dist/installers 下的安装包发布到 GitHub Releases。
 * 从 git credential helper 取 token，不落盘、不打印。
 * 用法：node scripts/publish-release.mjs [--tag v0.1.3] [--dry-run]
 */

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const arg = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dryRun = args.includes("--dry-run");

const repo = readJson("package.json").repository ?? "https://github.com/lvicztojry/perpetual-renewal";
const slug = repo.replace(/^.*github\.com[/:]/, "").replace(/\.git$/, "");
const version = readJson("native/package.json").version;
const tag = arg("--tag") ?? `v${version}`;
const installerDir = join(root, "dist/installers");

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function token() {
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  });
  const match = /^password=(.+)$/m.exec(out);
  if (!match) throw new Error("git credential helper 没有返回 GitHub token");
  return match[1].trim();
}

async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token()}`,
      "x-github-api-version": "2022-11-28",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const files = {
  windows: join(installerDir, `renewal-${version}-windows-x64-setup.exe`),
  android: join(installerDir, `renewal-${version}-arm64.apk`)
};

for (const [platform, file] of Object.entries(files)) {
  if (!existsSync(file)) throw new Error(`缺少 ${platform} 安装包：${file}`);
}

const sha = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const checksums = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, sha(f)]));

const expected = join(installerDir, "SHA256SUMS.txt");
const notes = readFileSync(expected, "utf8").trim();
for (const [platform, digest] of Object.entries(checksums)) {
  if (!notes.includes(digest)) throw new Error(`${platform} 的 sha256 与 SHA256SUMS.txt 不一致，先重新生成校验值`);
}

const body = [
  `生生不息 ${version} 测试版。`,
  "",
  "| 平台 | 文件 | SHA-256 |",
  "| --- | --- | --- |",
  `| Windows x64 | \`renewal-${version}-windows-x64-setup.exe\` | \`${checksums.windows}\` |`,
  `| Android ARM64 | \`renewal-${version}-arm64.apk\` | \`${checksums.android}\` |`,
  "",
  "当前仍是测试版本，功能与数据格式可能继续调整；升级前建议先在客户端内导出一次备份。",
  "Windows 安装包未做 Authenticode 签名，首次运行 SmartScreen 可能提示。",
  "",
  "---",
  "",
  readFileSync(join(root, "dist/installers/VALIDATION-0.1.3.json"), "utf8").includes(version)
    ? "验证记录见仓库 `dist/installers/VALIDATION-*.json`（该目录不进 Git）。"
    : ""
].filter(Boolean).join("\n");

if (dryRun) {
  console.log(JSON.stringify({ slug, tag, title: `生生不息 ${version}`, body, files, checksums }, null, 2));
  process.exit(0);
}

const releases = await api(`/repos/${slug}/releases`);
const existing = releases.find(r => r.tag_name === tag);

let release = existing;
if (!release) {
  release = await api(`/repos/${slug}/releases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: `生生不息 ${version}`,
      body,
      draft: false,
      prerelease: true,
      target_commitish: "codex/mvp-release-candidate"
    })
  });
  console.log(`已创建 Release ${tag}`);
} else {
  console.log(`Release ${tag} 已存在，补充附件`);
}

for (const [platform, file] of Object.entries(files)) {
  const name = basename(file);
  const already = release.assets.find(a => a.name === name);
  if (already) {
    console.log(`跳过已存在的附件 ${name}`);
    continue;
  }
  const uploadUrl = `https://uploads.github.com/repos/${slug}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/octet-stream",
      "content-length": String(readFileSync(file).length)
    },
    body: readFileSync(file)
  });
  if (!response.ok) throw new Error(`上传 ${name} 失败 ${response.status} ${(await response.text()).slice(0, 300)}`);
  const asset = await response.json();
  console.log(`已上传 ${platform}: ${asset.name} ${(asset.size / 1048576).toFixed(1)}MB`);
  console.log(`  下载地址 ${asset.browser_download_url}`);
}

console.log(`\nRelease 页面：${release.html_url}`);
