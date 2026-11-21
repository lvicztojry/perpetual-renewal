import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifact = join(root, "dist/renewal-cloud.tar.gz");
const parent = join(root, ".tmp-cloud-build");
mkdirSync(parent, { recursive: true });
const stage = mkdtempSync(join(parent, "verify-"));
const modules = join(stage, "node_modules");
function tar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8", windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, "archive inspection/extraction must succeed");
  return result.stdout;
}
try {
  const entries = tar(["-tzf", artifact]).split(/\r?\n/).filter(Boolean).map(path => path.replace(/^\.\//, ""));
  for (const entry of entries) {
    assert(!entry.startsWith("/") && !entry.includes("..") && !entry.includes(":") && !entry.includes("\\"));
    assert(!/(^|\/)\.env|\.(?:pem|key|dump|db|bak|log)$/i.test(entry), "archive must not contain runtime credentials/data");
    assert(!/(^|\/)(?:node_modules|\.next|\.git|backups|\.secrets)(\/|$)/.test(entry));
  }
  tar(["-xzf", artifact, "-C", stage]);
  const manifest = JSON.parse(readFileSync(join(stage, "MANIFEST.json"), "utf8"));
  assert.equal(manifest.format, 1);
  const expected = new Set(["README.md", "MANIFEST.json", ...manifest.files.map(item => item.file)]);
  for (const path of entries.filter(path => path && !path.endsWith("/"))) assert(expected.has(path), `unexpected archive file: ${path}`);
  for (const { file, sha256 } of manifest.files) {
    assert.equal(createHash("sha256").update(readFileSync(join(stage, file))).digest("hex"), sha256);
  }
  assert(!existsSync(join(stage, ".env.local")));
  symlinkSync(join(root, "node_modules"), modules, process.platform === "win32" ? "junction" : "dir");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT"].includes(key.toUpperCase())
  ));
  Object.assign(env, { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" });
  const build = spawnSync(process.execPath, [join(modules, "next/dist/bin/next"), "build", "--webpack"], { cwd: stage, env, stdio: "inherit", windowsHide: true });
  assert.ifError(build.error);
  assert.equal(build.status, 0, "isolated production build must pass");
  const auth = spawnSync(process.execPath, [join(root, "tests/auth-access.mjs")], { cwd: stage, env, stdio: "inherit", windowsHide: true });
  assert.ifError(auth.error);
  assert.equal(auth.status, 0, "isolated production anonymous-access checks must pass");
  console.log(`Cloud package verified: ${manifest.files.length} file hashes, isolated production build and production auth access. Docker/cloud checks still required.`);
} finally {
  // Remove the junction itself before removing only this task's mkdtemp directory.
  if (existsSync(modules)) unlinkSync(modules);
  rmSync(stage, { recursive: true, force: true });
}
