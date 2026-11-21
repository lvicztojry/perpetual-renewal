import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });
const stage = mkdtempSync(join(dist, "cloud-package-"));
const entries = [
  "package.json", "package-lock.json", "next.config.ts", "next-env.d.ts", "tsconfig.json", ".dockerignore",
  "src", "public", "prisma/schema.prisma", "prisma/migrations",
  "scripts/prisma-command.mjs", "scripts/database-url.mjs", "scripts/load-local-env.mjs", "scripts/env-readiness.mjs",
  "deploy/Dockerfile", "deploy/compose.yaml", "deploy/Caddyfile", "deploy/start.mjs", "deploy/scheduler.mjs", "deploy/init.mjs",
  "docs/CLOUD_SHARING.md"
];
const manifest = [];
function copy(path) {
  const from = join(root, path);
  const info = lstatSync(from);
  if (info.isSymbolicLink()) throw new Error("Refusing symbolic links in deployment source.");
  if (info.isDirectory()) {
    for (const name of readdirSync(from).sort()) copy(join(path, name));
  } else if (info.isFile()) {
    if (/(^|[\\/])\.env|\.(?:pem|key|log|db|dump|bak)$/i.test(path)) throw new Error("Refusing private file in deployment source.");
    const to = join(stage, path);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    manifest.push({ file: relative(root, from).replaceAll("\\", "/"), sha256: createHash("sha256").update(readFileSync(from)).digest("hex") });
  }
}
try {
  for (const entry of entries) {
    if (!existsSync(join(root, entry))) throw new Error(`Missing package input: ${entry}`);
    copy(entry);
  }
  writeFileSync(join(stage, "MANIFEST.json"), JSON.stringify({ format: 1, files: manifest }, null, 2) + "\n");
  copyFileSync(join(root, "docs/CLOUD_SHARING.md"), join(stage, "README.md"));
  const artifact = resolve(dist, "renewal-cloud.tar.gz");
  const result = spawnSync("tar", ["-czf", artifact, "-C", stage, "."], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error("Archive creation failed; ensure tar is installed.");
  console.log(`Cloud source package created: ${relative(root, artifact)} (${manifest.length} reviewed source files; no local env or database).`);
} finally {
  // This directory is created above by mkdtemp within this task's dist directory.
  rmSync(stage, { recursive: true, force: true });
}
